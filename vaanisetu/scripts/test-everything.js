// Full end-to-end test of the entire VaaniSetu agent pipeline
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const https = require('https');

const lambdaClient = new LambdaClient({ region: 'ap-south-1' });
const agentClient = new BedrockAgentRuntimeClient({ region: 'us-east-1' });
const agentId = process.env.BEDROCK_AGENT_ID || 'OZCO37QYJF';
const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';
const voiceApiUrl = process.env.VAANISETU_API_URL || 'https://3yd9hhw2g2.execute-api.ap-south-1.amazonaws.com/prod/voice/query';

function httpPost(url, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
        });
        req.on('error', reject);
        req.write(JSON.stringify(body)); req.end();
    });
}

async function testLambdaDirect(funcName, params) {
    const event = { actionGroup: 'vaanisetu-actions', function: funcName, parameters: params };
    const r = await lambdaClient.send(new InvokeCommand({ FunctionName: 'vaanisetu-agent-action', Payload: Buffer.from(JSON.stringify(event)) }));
    return JSON.parse(Buffer.from(r.Payload).toString());
}

async function testAgent(text, sessionId) {
    const cmd = new InvokeAgentCommand({ agentId, agentAliasId, sessionId, inputText: text });
    const resp = await agentClient.send(cmd);
    let out = '';
    for await (const ev of resp.completion) { if (ev.chunk?.bytes) out += Buffer.from(ev.chunk.bytes).toString('utf-8'); }
    return out;
}

(async () => {
    let pass = 0, fail = 0;

    // ─── TEST 1: Lambda getSchemesByProfile ────────────
    console.log('\n=== TEST 1: Lambda - getSchemesByProfile ===');
    try {
        const r = await testLambdaDirect('getSchemesByProfile', [
            { name: 'age', value: '40' }, { name: 'occupation', value: 'farmer' }, { name: 'state', value: 'Bihar' }
        ]);
        const body = JSON.parse(r.response.functionResponse.responseBody.TEXT.body);
        if (body.schemes && body.schemes.length > 0 && body.topScheme) {
            console.log('✅ PASS - Found', body.totalFound, 'schemes. Top:', body.topScheme, '₹' + body.topBenefit);
            pass++;
        } else { console.log('❌ FAIL -', JSON.stringify(body).substring(0, 200)); fail++; }
    } catch (e) { console.log('❌ FAIL -', e.message); fail++; }

    // ─── TEST 2: Lambda getJobsByProfile ────────────
    console.log('\n=== TEST 2: Lambda - getJobsByProfile ===');
    try {
        const r = await testLambdaDirect('getJobsByProfile', [{ name: 'state', value: 'Bihar' }]);
        const body = JSON.parse(r.response.functionResponse.responseBody.TEXT.body);
        if (body.jobs && body.jobs.length > 0) {
            console.log('✅ PASS - Found', body.totalFound, 'jobs. First:', body.jobs[0].title);
            pass++;
        } else { console.log('❌ FAIL -', JSON.stringify(body).substring(0, 200)); fail++; }
    } catch (e) { console.log('❌ FAIL -', e.message); fail++; }

    // ─── TEST 3: Lambda createApplication ────────────
    console.log('\n=== TEST 3: Lambda - createApplication ===');
    try {
        const r = await testLambdaDirect('createApplication', [
            { name: 'userId', value: 'test-user' },
            { name: 'schemeId', value: 'SCHEME-001' },
            { name: 'schemeName', value: 'PM-KISAN' },
            { name: 'confirm', value: 'true' },
        ]);
        const body = JSON.parse(r.response.functionResponse.responseBody.TEXT.body);
        if (body.success && body.applicationId) {
            console.log('✅ PASS - Application ID:', body.applicationId);
            pass++;
        } else { console.log('❌ FAIL -', JSON.stringify(body).substring(0, 200)); fail++; }
    } catch (e) { console.log('❌ FAIL -', e.message); fail++; }

    // ─── TEST 4: Lambda getApplicationStatus ────────────
    console.log('\n=== TEST 4: Lambda - getApplicationStatus ===');
    try {
        const r = await testLambdaDirect('getApplicationStatus', [{ name: 'applicationId', value: 'VS-TEST-1234' }]);
        const body = JSON.parse(r.response.functionResponse.responseBody.TEXT.body);
        if (body.status === 'under_review') {
            console.log('✅ PASS - Status:', body.status, '-', body.message);
            pass++;
        } else { console.log('❌ FAIL -', JSON.stringify(body).substring(0, 200)); fail++; }
    } catch (e) { console.log('❌ FAIL -', e.message); fail++; }

    // ─── TEST 5: Bedrock Agent - greeting ────────────
    console.log('\n=== TEST 5: Bedrock Agent - greeting ===');
    try {
        const r = await testAgent('Hello, I need help with government schemes', 'test-greet-' + Date.now());
        if (r && r.length > 10) {
            console.log('✅ PASS - Agent said:', r.substring(0, 150));
            pass++;
        } else { console.log('❌ FAIL - Empty response'); fail++; }
    } catch (e) { console.log('❌ FAIL -', e.message.substring(0, 150)); fail++; }

    // ─── TEST 6: API endpoint /voice/query ────────────
    console.log('\n=== TEST 6: API /voice/query ===');
    try {
        const r = await httpPost(voiceApiUrl, {
            transcript: 'What schemes are available for farmers?', language: 'en', sessionId: 'api-test-' + Date.now()
        });
        if (r.status === 200 && r.data.success && r.data.data.responseText) {
            console.log('✅ PASS - API returned:', r.data.data.responseText.substring(0, 150));
            pass++;
        } else { console.log('❌ FAIL - Status:', r.status, JSON.stringify(r.data).substring(0, 200)); fail++; }
    } catch (e) { console.log('❌ FAIL -', e.message); fail++; }

    // ─── SUMMARY ────────────
    console.log('\n' + '='.repeat(50));
    console.log(`RESULTS: ${pass}/${pass + fail} passed, ${fail} failed`);
    console.log('='.repeat(50));
    process.exit(fail > 0 ? 1 : 0);
})();
