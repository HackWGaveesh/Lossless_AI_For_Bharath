/**
 * Deploy a thin Lambda forwarder in us-east-1 that proxies Bedrock Agent
 * action invocations to the real vaanisetu-agent-action Lambda in ap-south-1.
 * Uses Node's built-in zlib to create the zip without external deps.
 */
import {
    LambdaClient,
    CreateFunctionCommand,
    UpdateFunctionCodeCommand,
    AddPermissionCommand,
    GetFunctionCommand,
    waitUntilFunctionActive,
} from '@aws-sdk/client-lambda';
import { IAMClient, CreateRoleCommand, AttachRolePolicyCommand, GetRoleCommand } from '@aws-sdk/client-iam';
import { BedrockAgentClient, UpdateAgentActionGroupCommand, GetAgentActionGroupCommand, PrepareAgentCommand } from '@aws-sdk/client-bedrock-agent';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const REGION_AGENT = 'us-east-1';
const REGION_DATA = 'ap-south-1';
const ACCOUNT = '926442180893';
const AGENT_ID = 'OZCO37QYJF';
const AG_ID = 'MQOUGE1JBO';
const TARGET_LAMBDA = `arn:aws:lambda:${REGION_DATA}:${ACCOUNT}:function:vaanisetu-agent-action`;
const FORWARDER_NAME = 'vaanisetu-agent-forwarder';

const lambdaClient = new LambdaClient({ region: REGION_AGENT });
const iamClient = new IAMClient({ region: 'us-east-1' });
const agentClient = new BedrockAgentClient({ region: REGION_AGENT });

// Inline forwarder code
const FORWARDER_CODE = `
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const client = new LambdaClient({ region: '${REGION_DATA}' });
exports.handler = async (event) => {
  console.log('Forwarder received:', JSON.stringify(event).substring(0, 300));
  const result = await client.send(new InvokeCommand({
    FunctionName: '${TARGET_LAMBDA}',
    Payload: Buffer.from(JSON.stringify(event)),
  }));
  const payload = JSON.parse(Buffer.from(result.Payload).toString());
  console.log('Forwarded result:', JSON.stringify(payload).substring(0, 300));
  return payload;
};
`.trim();

function makeZip(filename: string, content: Buffer): Buffer {
    // Build a minimal ZIP file manually
    const enc = new TextEncoder();

    const nameBytes = Buffer.from(filename);
    const contentBytes = content;

    // Local file header
    const crc = crc32(contentBytes);
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed
    localHeader.writeUInt16LE(0, 6);          // flags
    localHeader.writeUInt16LE(0, 8);          // compression (stored)
    localHeader.writeUInt16LE(0, 10);         // mod time
    localHeader.writeUInt16LE(0, 12);         // mod date
    localHeader.writeInt32LE(crc, 14);        // crc32
    localHeader.writeUInt32LE(contentBytes.length, 18); // compressed size
    localHeader.writeUInt32LE(contentBytes.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);   // filename length
    localHeader.writeUInt16LE(0, 28);         // extra length
    nameBytes.copy(localHeader, 30);

    const offset = 0;

    // Central directory header
    const cdHeader = Buffer.alloc(46 + nameBytes.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4);         // version made
    cdHeader.writeUInt16LE(20, 6);         // version needed
    cdHeader.writeUInt16LE(0, 8);          // flags
    cdHeader.writeUInt16LE(0, 10);         // compression
    cdHeader.writeUInt16LE(0, 12);         // mod time
    cdHeader.writeUInt16LE(0, 14);         // mod date
    cdHeader.writeInt32LE(crc, 16);        // crc32
    cdHeader.writeUInt32LE(contentBytes.length, 20); // compressed
    cdHeader.writeUInt32LE(contentBytes.length, 24); // uncompressed
    cdHeader.writeUInt16LE(nameBytes.length, 28);    // filename length
    cdHeader.writeUInt16LE(0, 30);         // extra
    cdHeader.writeUInt16LE(0, 32);         // comment
    cdHeader.writeUInt16LE(0, 34);         // disk start
    cdHeader.writeUInt16LE(0, 36);         // internal attr
    cdHeader.writeUInt32LE(0, 38);         // external attr
    cdHeader.writeInt32LE(offset, 42);     // local header offset
    nameBytes.copy(cdHeader, 46);

    const cdOffset = localHeader.length + contentBytes.length;
    const cdSize = cdHeader.length;

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);   // signature
    eocd.writeUInt16LE(0, 4);            // disk number
    eocd.writeUInt16LE(0, 6);            // disk with cd
    eocd.writeUInt16LE(1, 8);            // entries on disk
    eocd.writeUInt16LE(1, 10);           // total entries
    eocd.writeUInt32LE(cdSize, 12);      // cd size
    eocd.writeUInt32LE(cdOffset, 16);    // cd offset
    eocd.writeUInt16LE(0, 20);           // comment length

    return Buffer.concat([localHeader, contentBytes, cdHeader, eocd]);
}

function crc32(buf: Buffer): number {
    let crc = 0xFFFFFFFF;
    const table = makeCrc32Table();
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) | 0;
}

function makeCrc32Table(): number[] {
    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table.push(c);
    }
    return table;
}

async function getOrCreateRole(): Promise<string> {
    const roleName = 'vaanisetu-forwarder-role';
    try {
        const r = await iamClient.send(new GetRoleCommand({ RoleName: roleName }));
        console.log('Role exists:', r.Role!.Arn);
        return r.Role!.Arn!;
    } catch {
        console.log('Creating IAM role...');
        const r = await iamClient.send(new CreateRoleCommand({
            RoleName: roleName,
            AssumeRolePolicyDocument: JSON.stringify({
                Version: '2012-10-17',
                Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
            }),
        }));
        await iamClient.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' }));
        await iamClient.send(new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: 'arn:aws:iam::aws:policy/AWSLambda_FullAccess' }));
        console.log('Waiting 12s for role to propagate...');
        await new Promise(r => setTimeout(r, 12000));
        return r.Role!.Arn!;
    }
}

async function main() {
    console.log('=== Deploying Agent Forwarder Lambda in us-east-1 ===\n');

    const roleArn = await getOrCreateRole();
    const zipBuf = makeZip('index.js', Buffer.from(FORWARDER_CODE));
    console.log('Zip created, size:', zipBuf.length, 'bytes');

    let forwarderArn: string;
    try {
        const existing = await lambdaClient.send(new GetFunctionCommand({ FunctionName: FORWARDER_NAME }));
        forwarderArn = existing.Configuration!.FunctionArn!;
        console.log('Forwarder exists, updating code...');
        await lambdaClient.send(new UpdateFunctionCodeCommand({ FunctionName: FORWARDER_NAME, ZipFile: zipBuf }));
    } catch {
        console.log('Creating forwarder Lambda in us-east-1...');
        const created = await lambdaClient.send(new CreateFunctionCommand({
            FunctionName: FORWARDER_NAME,
            Runtime: 'nodejs20.x' as any,
            Role: roleArn,
            Handler: 'index.handler',
            Code: { ZipFile: zipBuf },
            Timeout: 60,
            MemorySize: 256,
            Description: 'VaaniSetu Agent Action Forwarder (us-east-1 → ap-south-1)',
        }));
        forwarderArn = created.FunctionArn!;
    }
    console.log('Forwarder ARN:', forwarderArn);

    console.log('Waiting for Lambda to be active...');
    await waitUntilFunctionActive({ client: lambdaClient, maxWaitTime: 60 }, { FunctionName: FORWARDER_NAME });
    console.log('Lambda active!');

    // Bedrock permission
    try {
        await lambdaClient.send(new AddPermissionCommand({
            FunctionName: FORWARDER_NAME,
            StatementId: 'allow-bedrock-agent-invoke',
            Action: 'lambda:InvokeFunction',
            Principal: 'bedrock.amazonaws.com',
            SourceArn: `arn:aws:bedrock:${REGION_AGENT}:${ACCOUNT}:agent/${AGENT_ID}`,
        }));
        console.log('Bedrock invoke permission added');
    } catch (e: any) {
        if (e.name === 'ResourceConflictException') console.log('Bedrock permission already exists');
        else console.warn('Permission warning:', e.message);
    }

    // Update the agent action group executor
    console.log('\nUpdating agent action group to use forwarder...');
    const cur = await agentClient.send(new GetAgentActionGroupCommand({ agentId: AGENT_ID, agentVersion: 'DRAFT', actionGroupId: AG_ID }));
    const ag = cur.agentActionGroup!;
    await agentClient.send(new UpdateAgentActionGroupCommand({
        agentId: AGENT_ID,
        agentVersion: 'DRAFT',
        actionGroupId: AG_ID,
        actionGroupName: ag.actionGroupName,
        description: ag.description,
        actionGroupExecutor: { lambda: forwarderArn },
        functionSchema: ag.functionSchema,
        actionGroupState: 'ENABLED',
    }));
    console.log('Action group updated!');

    // Re-prepare agent
    await new Promise(r => setTimeout(r, 5000));
    const prep = await agentClient.send(new PrepareAgentCommand({ agentId: AGENT_ID }));
    console.log('Agent status:', prep.agentStatus);

    console.log('\n=== All done! ===');
    console.log('Forwarder Lambda (us-east-1):', forwarderArn);
    console.log('Calls → ap-south-1:', TARGET_LAMBDA);
}

main().catch(e => { console.error('Script failed:', e.message); process.exit(1); });
