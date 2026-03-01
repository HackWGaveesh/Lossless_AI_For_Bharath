#!/bin/bash
set -e
echo "=== Creating Bedrock Guardrails ==="

REGION="ap-south-1"

GUARDRAIL_RESPONSE=$(aws bedrock create-guardrail \
  --name "vaanisetu-responsible-ai" \
  --description "VaaniSetu responsible AI guardrails - prevents misuse, protects users" \
  --topic-policy-config '{
    "topicsConfig": [
      {
        "name": "PoliticalContent",
        "definition": "Political opinions, party propaganda, or electoral content",
        "examples": ["Vote for BJP", "Congress is corrupt", "who should I vote for"],
        "type": "DENY"
      },
      {
        "name": "FinancialAdvice",
        "definition": "Specific investment advice or financial product recommendations beyond government schemes",
        "examples": ["buy these stocks", "invest in crypto", "which mutual fund"],
        "type": "DENY"
      },
      {
        "name": "MedicalAdvice",
        "definition": "Specific medical diagnoses or treatment recommendations",
        "examples": ["what medicine should I take", "diagnose my symptoms"],
        "type": "DENY"
      }
    ]
  }' \
  --content-policy-config '{
    "filtersConfig": [
      {"type": "SEXUAL", "inputStrength": "HIGH", "outputStrength": "HIGH"},
      {"type": "VIOLENCE", "inputStrength": "MEDIUM", "outputStrength": "HIGH"},
      {"type": "HATE", "inputStrength": "HIGH", "outputStrength": "HIGH"},
      {"type": "INSULTS", "inputStrength": "MEDIUM", "outputStrength": "HIGH"},
      {"type": "MISCONDUCT", "inputStrength": "HIGH", "outputStrength": "HIGH"}
    ]
  }' \
  --word-policy-config '{
    "managedWordListsConfig": [
      {"type": "PROFANITY"}
    ]
  }' \
  --sensitive-information-policy-config '{
    "piiEntitiesConfig": [
      {"type": "AADHAAR", "action": "ANONYMIZE"},
      {"type": "CREDIT_DEBIT_CARD_NUMBER", "action": "BLOCK"},
      {"type": "AWS_SECRET_KEY", "action": "BLOCK"},
      {"type": "PASSWORD", "action": "BLOCK"}
    ]
  }' \
  --blocked-inputs-messaging "I cannot help with that. Please ask about government schemes, jobs, or documents." \
  --blocked-outputs-messaging "I cannot provide that information. Please ask about government schemes, jobs, or documents." \
  --region $REGION)

GUARDRAIL_ID=$(echo "$GUARDRAIL_RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['guardrailId'])")
GUARDRAIL_ARN=$(echo "$GUARDRAIL_RESPONSE" | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['guardrailArn'])")

echo "Guardrail ID: $GUARDRAIL_ID"

# Create version
aws bedrock create-guardrail-version --guardrail-identifier $GUARDRAIL_ID --region $REGION

# Update .env
if grep -q "BEDROCK_GUARDRAIL_ID=" .env; then
  sed -i "s/BEDROCK_GUARDRAIL_ID=.*/BEDROCK_GUARDRAIL_ID=$GUARDRAIL_ID/" .env
else
  echo "BEDROCK_GUARDRAIL_ID=$GUARDRAIL_ID" >> .env
fi

echo "Guardrails configured. ID: $GUARDRAIL_ID"
