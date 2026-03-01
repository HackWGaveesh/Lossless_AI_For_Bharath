import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

console.log("=== Creating Bedrock Guardrails ===");

const REGION = "ap-south-1";

const createCmd = [
    'aws bedrock create-guardrail',
    '--name "vaanisetu-responsi-ai-v2"', // using a slightly different name to avoid conflict
    '--description "VaaniSetu responsible AI guardrails"',
    '--topic-policy-config', '"{\\"topicsConfig\\":[{\\"name\\":\\"PoliticalContent\\",\\"definition\\":\\"Political opinions, party propaganda, or electoral content\\",\\"examples\\":[\\"Vote for BJP\\",\\"Congress is corrupt\\",\\"who should I vote for\\"],\\"type\\":\\"DENY\\"},{\\"name\\":\\"FinancialAdvice\\",\\"definition\\":\\"Specific investment advice or financial product recommendations beyond government schemes\\",\\"examples\\":[\\"buy these stocks\\",\\"invest in crypto\\",\\"which mutual fund\\"],\\"type\\":\\"DENY\\"},{\\"name\\":\\"MedicalAdvice\\",\\"definition\\":\\"Specific medical diagnoses or treatment recommendations\\",\\"examples\\":[\\"what medicine\\",\\"diagnose\\"],\\"type\\":\\"DENY\\"}]}"',
    '--content-policy-config', '"{\\"filtersConfig\\":[{\\"type\\":\\"SEXUAL\\",\\"inputStrength\\":\\"HIGH\\",\\"outputStrength\\":\\"HIGH\\"},{\\"type\\":\\"VIOLENCE\\",\\"inputStrength\\":\\"MEDIUM\\",\\"outputStrength\\":\\"HIGH\\"},{\\"type\\":\\"HATE\\",\\"inputStrength\\":\\"HIGH\\",\\"outputStrength\\":\\"HIGH\\"},{\\"type\\":\\"INSULTS\\",\\"inputStrength\\":\\"MEDIUM\\",\\"outputStrength\\":\\"HIGH\\"},{\\"type\\":\\"MISCONDUCT\\",\\"inputStrength\\":\\"HIGH\\",\\"outputStrength\\":\\"HIGH\\"}]}"',
    '--word-policy-config', '"{\\"managedWordListsConfig\\":[{\\"type\\":\\"PROFANITY\\"}]}"',
    '--sensitive-information-policy-config', '"{\\"piiEntitiesConfig\\":[{\\"type\\":\\"AADHAAR\\",\\"action\\":\\"ANONYMIZE\\"},{\\"type\\":\\"CREDIT_DEBIT_CARD_NUMBER\\",\\"action\\":\\"BLOCK\\"},{\\"type\\":\\"AWS_SECRET_KEY\\",\\"action\\":\\"BLOCK\\"},{\\"type\\":\\"PASSWORD\\",\\"action\\":\\"BLOCK\\"}]}"',
    '--blocked-inputs-messaging', '"I cannot help with that. Please ask about government schemes, jobs, or documents."',
    '--blocked-outputs-messaging', '"I cannot provide that information. Please ask about government schemes, jobs, or documents."',
    `--region ${REGION}`,
    '--output json'
].join(' ');

try {
    console.log("Creating Guardrail...");
    const res = execSync(createCmd, { encoding: 'utf8', env: { ...process.env, PAGER: '' } });
    const data = JSON.parse(res);
    const guardrailId = data.guardrailId;
    console.log(`Guardrail ID: ${guardrailId}`);

    console.log("Creating Guardrail Version...");
    execSync(`aws bedrock create-guardrail-version --guardrail-identifier ${guardrailId} --region ${REGION} --output json`, { encoding: 'utf8', env: { ...process.env, PAGER: '' } });

    const envPath = path.join(__dirname, '../.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    if (envContent.includes('BEDROCK_GUARDRAIL_ID=')) {
        envContent = envContent.replace(/BEDROCK_GUARDRAIL_ID=.*/, `BEDROCK_GUARDRAIL_ID=${guardrailId}`);
    } else {
        envContent += `\nBEDROCK_GUARDRAIL_ID=${guardrailId}\n`;
    }
    fs.writeFileSync(envPath, envContent.trim() + '\n');
    console.log("Guardrails configured in .env");
} catch (e: any) {
    console.error(e.message);
    if (e.stdout) console.error(e.stdout.toString());
    if (e.stderr) console.error(e.stderr.toString());
}
