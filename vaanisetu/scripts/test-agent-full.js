const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const client = new BedrockAgentRuntimeClient({ region: 'us-east-1' });
const agentId = process.env.BEDROCK_AGENT_ID || 'OZCO37QYJF';
const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';

async function query(text, sessionId) {
    const cmd = new InvokeAgentCommand({
        agentId,
        agentAliasId,
        sessionId,
        inputText: text,
        enableTrace: false,
    });
    const resp = await client.send(cmd);
    let output = '';
    for await (const ev of resp.completion) {
        if (ev.chunk?.bytes) output += Buffer.from(ev.chunk.bytes).toString('utf-8');
    }
    return output;
}

(async () => {
    console.log('=== TEST 1: Simple greeting ===');
    console.log(await query('What schemes can a farmer in Bihar get?', 'test-1'));

    console.log('\n=== TEST 2: Jobs ===');
    console.log(await query('Show me jobs near Bihar', 'test-2'));

    console.log('\n=== TEST 3: Apply ===');
    console.log(await query('I want to apply for PM-KISAN', 'test-3'));
})().catch(e => console.error('ERROR:', e.message));
