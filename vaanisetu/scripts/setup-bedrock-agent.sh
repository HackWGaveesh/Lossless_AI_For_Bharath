#!/bin/bash
set -e
echo "=== VaaniSetu Bedrock Agent Setup ==="

# Load .env
set -a; source .env; set +a

REGION="ap-south-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Get CDK stack outputs
get_output() {
  aws cloudformation describe-stacks \
    --stack-name VaaniSetuStack \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text --region $REGION
}

AGENT_LAMBDA_ARN=$(get_output AgentActionLambdaArn)
KB_BUCKET=$(get_output KnowledgeBaseBucketName)
BEDROCK_ROLE_ARN=$(get_output BedrockAgentRoleArn)

echo "Lambda: $AGENT_LAMBDA_ARN"
echo "KB Bucket: $KB_BUCKET"
echo "Bedrock Role: $BEDROCK_ROLE_ARN"

# Generate KB documents
echo "Generating KB documents..."
node scripts/generate-kb-docs.js
aws s3 sync /tmp/vaanisetu-kb/ s3://$KB_BUCKET/knowledge/ --region $REGION
echo "Uploaded KB documents to s3://$KB_BUCKET/knowledge/"

# Create Knowledge Base (using S3 as data source, OpenSearch for vector store)
echo "Creating Knowledge Base..."
KB_RESPONSE=$(aws bedrock-agent create-knowledge-base \
  --name "vaanisetu-schemes-kb" \
  --description "Government schemes and jobs knowledge base for VaaniSetu" \
  --role-arn "$BEDROCK_ROLE_ARN" \
  --knowledge-base-configuration '{
    "type": "VECTOR",
    "vectorKnowledgeBaseConfiguration": {
      "embeddingModelArn": "arn:aws:bedrock:ap-south-1::foundation-model/amazon.titan-embed-text-v2:0"
    }
  }' \
  --storage-configuration '{
    "type": "OPENSEARCH_SERVERLESS",
    "opensearchServerlessConfiguration": {
      "collectionArn": "PLACEHOLDER",
      "vectorIndexName": "vaanisetu-index",
      "fieldMapping": {
        "vectorField": "embedding",
        "textField": "AMAZON_BEDROCK_TEXT",
        "metadataField": "AMAZON_BEDROCK_METADATA"
      }
    }
  }' \
  --region $REGION 2>&1 || true)

KB_ID=$(echo "$KB_RESPONSE" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('knowledgeBase',{}).get('knowledgeBaseId',''))" 2>/dev/null || echo "")

echo "Knowledge Base ID: $KB_ID"

# Create Bedrock Agent with Nova Pro
echo "Creating Bedrock Agent..."
AGENT_RESPONSE=$(aws bedrock-agent create-agent \
  --agent-name "vaanisetu-orchestrator" \
  --description "VaaniSetu multi-agent orchestrator for rural citizen services" \
  --agent-resource-role-arn "$BEDROCK_ROLE_ARN" \
  --foundation-model "us.amazon.nova-pro-v1:0" \
  --instruction "You are the VaaniSetu AI Orchestrator helping rural Indian citizens access government services.

CAPABILITIES:
- getSchemesByProfile: Find government schemes user is eligible for
- createApplication: Submit a scheme application on behalf of the user
- getApplicationStatus: Check status of submitted application
- getJobsByProfile: Find employment opportunities matching user profile

RULES:
1. Always respond in the user's language (Hindi/Tamil/Telugu/Kannada/Marathi/English)
2. When user asks about schemes, CALL getSchemesByProfile with their details
3. When user wants to apply, CALL createApplication
4. When user asks about jobs, CALL getJobsByProfile
5. Keep responses concise — max 3 sentences. Rural users have limited time.
6. Always mention the benefit amount (Rs X per year) when discussing schemes.
7. Be warm and encouraging. Many users have never accessed government services before." \
  --region $REGION)

AGENT_ID=$(echo "$AGENT_RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['agent']['agentId'])")
echo "Agent ID: $AGENT_ID"

sleep 5

# Add Action Group
echo "Adding Action Group to Agent..."
aws bedrock-agent create-agent-action-group \
  --agent-id "$AGENT_ID" \
  --agent-version "DRAFT" \
  --action-group-name "vaanisetu-actions" \
  --description "Core actions: scheme lookup, apply, job matching" \
  --action-group-executor "{\"lambda\": \"$AGENT_LAMBDA_ARN\"}" \
  --function-schema '{
    "functions": [
      {
        "name": "getSchemesByProfile",
        "description": "Retrieve government schemes matching user eligibility profile. Always call this when user asks about which schemes they qualify for.",
        "parameters": {
          "age": {"type": "integer", "description": "User age in years", "required": false},
          "annualIncome": {"type": "integer", "description": "Annual household income in rupees", "required": false},
          "gender": {"type": "string", "description": "male, female, or other", "required": false},
          "state": {"type": "string", "description": "Indian state name in English", "required": false},
          "occupation": {"type": "string", "description": "farmer, self_employed, student, salaried, unemployed, homemaker", "required": false},
          "casteCategory": {"type": "string", "description": "general, obc, sc, st", "required": false}
        }
      },
      {
        "name": "createApplication",
        "description": "Submit a government scheme application for the user. Call when user explicitly says they want to apply.",
        "parameters": {
          "userId": {"type": "string", "description": "The user ID", "required": true},
          "schemeId": {"type": "string", "description": "The scheme ID (e.g. SCHEME-001)", "required": true},
          "schemeName": {"type": "string", "description": "Human-readable scheme name", "required": false}
        }
      },
      {
        "name": "getApplicationStatus",
        "description": "Check the status of a submitted application.",
        "parameters": {
          "applicationId": {"type": "string", "description": "Application reference number", "required": true}
        }
      },
      {
        "name": "getJobsByProfile",
        "description": "Find job and employment opportunities matching user profile. Call when user asks about jobs or work.",
        "parameters": {
          "state": {"type": "string", "description": "User state", "required": false},
          "occupation": {"type": "string", "description": "User skills or occupation", "required": false},
          "salaryMin": {"type": "integer", "description": "Minimum expected salary", "required": false}
        }
      }
    ]
  }' \
  --region $REGION

echo "Action group added."

# Grant Bedrock permission to invoke Lambda
aws lambda add-permission \
  --function-name "$AGENT_LAMBDA_ARN" \
  --statement-id "allow-bedrock-agent-$AGENT_ID" \
  --action "lambda:InvokeFunction" \
  --principal "bedrock.amazonaws.com" \
  --source-arn "arn:aws:bedrock:$REGION:$ACCOUNT_ID:agent/$AGENT_ID" \
  --region $REGION 2>/dev/null || echo "Permission may already exist"

# Associate Knowledge Base if created
if [ -n "$KB_ID" ] && [ "$KB_ID" != "" ]; then
  echo "Associating Knowledge Base $KB_ID..."
  aws bedrock-agent associate-agent-knowledge-base \
    --agent-id "$AGENT_ID" \
    --agent-version "DRAFT" \
    --knowledge-base-id "$KB_ID" \
    --description "Government schemes and jobs reference database" \
    --knowledge-base-state "ENABLED" \
    --region $REGION 2>/dev/null || echo "KB association failed - continuing without KB"
fi

# Prepare agent
echo "Preparing agent for deployment..."
aws bedrock-agent prepare-agent --agent-id "$AGENT_ID" --region $REGION
sleep 20

# Create alias
echo "Creating production alias..."
ALIAS_RESPONSE=$(aws bedrock-agent create-agent-alias \
  --agent-id "$AGENT_ID" \
  --agent-alias-name "v1" \
  --region $REGION)

ALIAS_ID=$(echo "$ALIAS_RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['agentAlias']['agentAliasId'])")

echo ""
echo "================================================="
echo "  BEDROCK AGENT READY"
echo "  Agent ID:  $AGENT_ID"
echo "  Alias ID:  $ALIAS_ID"
echo "================================================="

# Patch .env
if grep -q "BEDROCK_AGENT_ID=" .env; then
  sed -i "s/BEDROCK_AGENT_ID=.*/BEDROCK_AGENT_ID=$AGENT_ID/" .env
else
  echo "BEDROCK_AGENT_ID=$AGENT_ID" >> .env
fi
if grep -q "BEDROCK_AGENT_ALIAS_ID=" .env; then
  sed -i "s/BEDROCK_AGENT_ALIAS_ID=.*/BEDROCK_AGENT_ALIAS_ID=$ALIAS_ID/" .env
else
  echo "BEDROCK_AGENT_ALIAS_ID=$ALIAS_ID" >> .env
fi

echo ".env updated. Now rebuild and redeploy."
