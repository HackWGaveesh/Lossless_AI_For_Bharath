import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { resolve } from 'path';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env') });

const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
console.log('Using Token:', token ? 'YES (starts with ' + token.substring(0, 5) + ')' : 'NO');

const bedrock = new BedrockRuntimeClient({
    region: 'us-east-1',
    token: token ? {
        token: token,
        expiration: new Date(Date.now() + 3600000)
    } : undefined
});

async function test() {
    try {
        console.log('Testing Nova Pro with ConverseCommand...');
        const response = await bedrock.send(new ConverseCommand({
            modelId: 'us.amazon.nova-pro-v1:0',
            messages: [{ role: 'user', content: [{ text: 'Hello, are you there?' }] }]
        }));
        console.log('Success!');
        console.log('Response:', response.output?.message?.content?.[0]?.text);
    } catch (err: any) {
        console.error('FAILED:', err.name, err.message);
        if (err.stack) console.error(err.stack);
    }
}

test();
