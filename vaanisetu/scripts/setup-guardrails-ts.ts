import { BedrockClient, CreateGuardrailCommand, CreateGuardrailVersionCommand } from '@aws-sdk/client-bedrock';
import * as fs from 'fs';
import * as path from 'path';

const REGION = 'us-east-1';
const client = new BedrockClient({ region: REGION });

async function main() {
    console.log('=== Creating Bedrock Guardrails ===');

    try {
        console.log('Creating Guardrail...');
        const createResp = await client.send(new CreateGuardrailCommand({
            name: 'vaanisetu-responsible-ai-v3',
            description: 'VaaniSetu responsible AI guardrails',
            blockedInputMessaging: 'I cannot help with that. Please ask about government schemes, jobs, or documents.',
            blockedOutputsMessaging: 'I cannot provide that information. Please ask about government schemes, jobs, or documents.',
            contentPolicyConfig: {
                filtersConfig: [
                    { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'VIOLENCE', inputStrength: 'MEDIUM', outputStrength: 'HIGH' },
                    { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
                    { type: 'INSULTS', inputStrength: 'MEDIUM', outputStrength: 'HIGH' },
                    { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' }
                ]
            },
            topicPolicyConfig: {
                topicsConfig: [
                    {
                        name: 'PoliticalContent',
                        definition: 'Political opinions, party propaganda, or electoral content',
                        examples: ['Vote for BJP', 'Congress is corrupt', 'who should I vote for'],
                        type: 'DENY'
                    },
                    {
                        name: 'FinancialAdvice',
                        definition: 'Specific investment advice or financial product recommendations',
                        examples: ['buy these stocks', 'invest in crypto'],
                        type: 'DENY'
                    },
                    {
                        name: 'MedicalAdvice',
                        definition: 'Specific medical diagnoses',
                        examples: ['what medicine should I take', 'diagnose my symptoms'],
                        type: 'DENY'
                    }
                ]
            },
            wordPolicyConfig: {
                managedWordListsConfig: [{ type: 'PROFANITY' }]
            },
            sensitiveInformationPolicyConfig: {
                piiEntitiesConfig: [
                    { type: 'CREDIT_DEBIT_CARD_NUMBER', action: 'BLOCK' },
                    { type: 'AWS_SECRET_KEY', action: 'BLOCK' },
                    { type: 'PASSWORD', action: 'BLOCK' },
                    { type: 'EMAIL', action: 'ANONYMIZE' }
                ],
                regexesConfig: [
                    {
                        name: 'AADHAAR_NUMBER',
                        description: 'Indian Aadhaar Number format',
                        pattern: '\\b[2-9]{1}[0-9]{3}\\s*[0-9]{4}\\s*[0-9]{4}\\b',
                        action: 'ANONYMIZE'
                    }
                ]
            }
        }));

        const guardrailId = createResp.guardrailId!;
        console.log(`Guardrail ID: ${guardrailId}`);

        console.log('Creating Guardrail Version...');
        await client.send(new CreateGuardrailVersionCommand({
            guardrailIdentifier: guardrailId,
        }));

        const envPath = path.join(__dirname, '../.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
        if (envContent.includes('BEDROCK_GUARDRAIL_ID=')) {
            envContent = envContent.replace(/BEDROCK_GUARDRAIL_ID=.*/, `BEDROCK_GUARDRAIL_ID=${guardrailId}`);
        } else {
            envContent += `\nBEDROCK_GUARDRAIL_ID=${guardrailId}\n`;
        }
        fs.writeFileSync(envPath, envContent.trim() + '\n');
        console.log('Guardrails configured in .env');
    } catch (err: any) {
        console.error('Failed to create guardrails:', err.message);
    }
}

main();
