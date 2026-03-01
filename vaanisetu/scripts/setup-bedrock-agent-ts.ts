import { BedrockAgentClient, CreateKnowledgeBaseCommand, CreateAgentCommand, CreateAgentActionGroupCommand, AssociateAgentKnowledgeBaseCommand, PrepareAgentCommand, CreateAgentAliasCommand } from '@aws-sdk/client-bedrock-agent';
import { LambdaClient, AddPermissionCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import * as fs from 'fs';
import * as path from 'path';

const REGION = 'ap-south-1';
const agentClient = new BedrockAgentClient({ region: REGION });
const lambdaClient = new LambdaClient({ region: REGION });
const cfnClient = new CloudFormationClient({ region: REGION });

async function getOutput(key: string): Promise<string> {
    const res = await cfnClient.send(new DescribeStacksCommand({ StackName: 'VaaniSetuStack' }));
    const outputs = res.Stacks?.[0]?.Outputs || [];
    return outputs.find(o => o.OutputKey === key)?.OutputValue || '';
}

async function uploadToS3(bucket: string, dir: string) {
    const s3 = new S3Client({ region: REGION });
    const files = fs.readdirSync(dir);
    for (const f of files) {
        if (!f.endsWith('.txt')) continue;
        const body = fs.readFileSync(path.join(dir, f));
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: `knowledge/${f}`,
            Body: body,
            ContentType: 'text/plain'
        }));
    }
}

async function main() {
    console.log('=== VaaniSetu Bedrock Agent Setup ===');

    try {
        const agentLambdaArn = await getOutput('AgentActionLambdaArn');
        const kbBucket = await getOutput('KnowledgeBaseBucketName');
        const bedrockRoleArn = await getOutput('BedrockAgentRoleArn');

        console.log(`Lambda: ${agentLambdaArn}`);
        console.log(`KB Bucket: ${kbBucket}`);
        console.log(`Role: ${bedrockRoleArn}`);

        console.log('Generating KB documents...');
        const scriptsDir = path.join(__dirname, '../scripts');
        require(path.join(scriptsDir, 'generate-kb-docs.js'));
        await uploadToS3(kbBucket, '/tmp/vaanisetu-kb');
        console.log('Uploaded KB to S3.');

        console.log('Creating Bedrock Agent...');
        const agentResp = await agentClient.send(new CreateAgentCommand({
            agentName: 'vaanisetu-orchestrator-v4',
            description: 'VaaniSetu multi-agent orchestrator for rural citizen services',
            agentResourceRoleArn: bedrockRoleArn,
            foundationModel: 'us.amazon.nova-pro-v1:0',
            instruction: `You are the VaaniSetu AI Orchestrator helping rural Indian citizens access government services.

CAPABILITIES:
- getSchemesByProfile: Find government schemes user is eligible for
- createApplication: Submit a scheme application 
- getApplicationStatus: Check status of submitted application
- getJobsByProfile: Find employment opportunities

RULES:
1. Always respond in the user's language (Hindi/Tamil/Telugu/Kannada/Marathi/English)
2. When user asks about schemes, CALL getSchemesByProfile
3. When user wants to apply, CALL createApplication
4. When user asks about jobs, CALL getJobsByProfile
5. Keep responses concise — max 3 sentences. Rural users have limited time.
6. Always mention the benefit amount (Rs X per year) when discussing schemes.
7. Be warm and encouraging.`
        }));

        const agentId = agentResp.agent?.agentId!;
        console.log(`Agent ID: ${agentId}`);

        await new Promise(r => setTimeout(r, 5000));

        console.log('Adding Action Group...');
        await agentClient.send(new CreateAgentActionGroupCommand({
            agentId,
            agentVersion: 'DRAFT',
            actionGroupName: 'vaanisetu-actions',
            description: 'Core actions for VaaniSetu',
            actionGroupExecutor: { lambda: agentLambdaArn },
            functionSchema: {
                functions: [
                    {
                        name: 'getSchemesByProfile',
                        description: 'Find schemes user qualifies for based on demographics',
                        parameters: {
                            age: { type: 'integer', description: 'User age', required: false },
                            annualIncome: { type: 'integer', description: 'Annual household income Rs', required: false },
                            gender: { type: 'string', description: 'male/female/other', required: false },
                            state: { type: 'string', description: 'State name', required: false },
                            occupation: { type: 'string', description: 'farmer, student, salaried, unemployed', required: false }
                        }
                    },
                    {
                        name: 'createApplication',
                        description: 'Submit an application',
                        parameters: {
                            userId: { type: 'string', description: 'User ID', required: true },
                            schemeId: { type: 'string', description: 'Scheme ID', required: true },
                            schemeName: { type: 'string', description: 'Scheme Name', required: false }
                        }
                    },
                    {
                        name: 'getApplicationStatus',
                        description: 'Check status of application',
                        parameters: {
                            applicationId: { type: 'string', description: 'App Reference Number', required: true }
                        }
                    },
                    {
                        name: 'getJobsByProfile',
                        description: 'Find jobs by profile',
                        parameters: {
                            state: { type: 'string', description: 'State', required: false },
                            occupation: { type: 'string', description: 'Occupation', required: false }
                        }
                    }
                ]
            }
        }));

        try {
            console.log('Adding Lambda Permission...');
            const parts = agentLambdaArn.split(':');
            const accountId = parts[4];
            await lambdaClient.send(new AddPermissionCommand({
                FunctionName: agentLambdaArn,
                StatementId: `allow-bedrock-agent-${agentId}`,
                Action: 'lambda:InvokeFunction',
                Principal: 'bedrock.amazonaws.com',
                SourceArn: `arn:aws:bedrock:${REGION}:${accountId}:agent/${agentId}`
            }));
        } catch (e: any) {
            if (e.name !== 'ResourceConflictException') throw e;
        }

        console.log('Preparing agent...');
        await agentClient.send(new PrepareAgentCommand({ agentId }));

        await new Promise(r => setTimeout(r, 10000));

        console.log('Creating production alias...');
        const aliasResp = await agentClient.send(new CreateAgentAliasCommand({
            agentId,
            agentAliasName: 'v1'
        }));
        const aliasId = aliasResp.agentAlias?.agentAliasId!;
        console.log(`Alias ID: ${aliasId}`);

        const envPath = path.join(__dirname, '../.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (envContent.includes('BEDROCK_AGENT_ID=')) {
            envContent = envContent.replace(/BEDROCK_AGENT_ID=.*/, `BEDROCK_AGENT_ID=${agentId}`);
            envContent = envContent.replace(/BEDROCK_AGENT_ALIAS_ID=.*/, `BEDROCK_AGENT_ALIAS_ID=${aliasId}`);
        } else {
            envContent += `\nBEDROCK_AGENT_ID=${agentId}\nBEDROCK_AGENT_ALIAS_ID=${aliasId}\n`;
        }
        fs.writeFileSync(envPath, envContent.trim() + '\n');

        console.log('Setup Complete!');

    } catch (e: any) {
        console.error('Agent setup failed:', e.message, JSON.stringify(e, null, 2));
    }
}

main();
