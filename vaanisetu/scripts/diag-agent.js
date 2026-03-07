const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const client = new BedrockAgentRuntimeClient({ region: 'us-east-1' });
const agentId = process.env.BEDROCK_AGENT_ID || 'OZCO37QYJF';
const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';

(async () => {
    const cmd = new InvokeAgentCommand({
        agentId,
        agentAliasId,
        sessionId: 'diag-' + Date.now(),
        inputText: 'say hello',
        enableTrace: true,
    });
    try {
        const resp = await client.send(cmd);
        let text = '';
        const traces = [];
        for await (const ev of resp.completion) {
            if (ev.chunk?.bytes) text += Buffer.from(ev.chunk.bytes).toString('utf-8');
            if (ev.trace) traces.push(JSON.stringify(ev.trace).substring(0, 300));
        }
        console.log('RESPONSE:', text.substring(0, 300));
        traces.forEach(t => console.log('TRACE:', t));
    } catch (e) {
        console.error('ERR class:', e.constructor.name);
        console.error('ERR msg:', e.message.substring(0, 400));
        const raw = e['$response'];
        if (raw) console.error('HTTP status:', raw.statusCode);
    }
})();
