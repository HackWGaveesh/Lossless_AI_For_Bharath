#!/usr/bin/env node
/**
 * Fetches VaaniSetu CDK stack outputs and writes:
 *   - .env (root) with DB_CLUSTER_ARN, DB_SECRET_ARN, DOCUMENTS_BUCKET, etc.
 *   - frontend/.env with VITE_API_URL, VITE_USER_POOL_ID, VITE_USER_POOL_CLIENT_ID, VITE_AWS_REGION
 *
 * Prerequisites: AWS CLI configured, stack already deployed (npx cdk deploy).
 * Usage: node scripts/write-env-from-cdk.js [--stack-name VaaniSetuStack] [--region ap-south-1]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let stackName = 'VaaniSetuStack';
let region = 'ap-south-1';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--stack-name' && args[i + 1]) stackName = args[++i];
  else if (args[i] === '--region' && args[i + 1]) region = args[++i];
}

function getOutputs() {
  try {
    const out = execSync(
      `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --query "Stacks[0].Outputs" --output json`,
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
    const outputs = JSON.parse(out);
    const map = {};
    for (const o of outputs) {
      map[o.OutputKey] = o.OutputValue;
    }
    return map;
  } catch (e) {
    console.error('Failed to get stack outputs. Ensure the stack is deployed and AWS CLI is configured.');
    console.error(e.message || e);
    process.exit(1);
  }
}

const rootDir = path.resolve(__dirname, '..');
const outputs = getOutputs();

const apiUrl = outputs.APIEndpoint || '';
const cloudFrontUrl = outputs.CloudFrontURL || '';
const frontendBucket = outputs.FrontendBucketName || '';
const documentsBucket = outputs.DocumentsBucketName || '';
const dbClusterArn = outputs.DatabaseClusterArn || '';
const dbSecretArn = outputs.DatabaseSecretArn || '';
const userPoolId = outputs.UserPoolId || '';
const userPoolClientId = outputs.UserPoolClientId || '';
const notificationTopicArn = outputs.NotificationTopicArn || '';

// Root .env: merge CDK keys into existing .env or create
const rootEnvPath = path.join(rootDir, '.env');
const rootUpdates = {
  DB_CLUSTER_ARN: dbClusterArn,
  DB_SECRET_ARN: dbSecretArn,
  DOCUMENTS_BUCKET: documentsBucket,
  NOTIFICATION_TOPIC_ARN: notificationTopicArn,
  AWS_REGION: region,
};
let existingRoot = fs.existsSync(rootEnvPath) ? fs.readFileSync(rootEnvPath, 'utf8') : '';
const rootLines = existingRoot.split('\n');
const seen = new Set(Object.keys(rootUpdates));
const newLines = rootLines.map((line) => {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && rootUpdates[match[1]] !== undefined) {
    seen.delete(match[1]);
    return `${match[1]}=${rootUpdates[match[1]]}`;
  }
  return line;
});
Object.keys(rootUpdates).forEach((key) => {
  if (seen.has(key) && rootUpdates[key]) newLines.push(`${key}=${rootUpdates[key]}`);
});
if (seen.size < Object.keys(rootUpdates).size && newLines.length > 0 && !newLines[newLines.length - 1].startsWith('#')) {
  newLines.push('');
}
fs.writeFileSync(rootEnvPath, newLines.join('\n'), 'utf8');
console.log('Updated', rootEnvPath, 'with CDK outputs.');

// frontend/.env (overwrite so Vite picks up correct values)
const frontendEnv = [
  '# VaaniSetu frontend - filled from CDK outputs',
  `VITE_API_URL=${apiUrl}`,
  `VITE_USER_POOL_ID=${userPoolId}`,
  `VITE_USER_POOL_CLIENT_ID=${userPoolClientId}`,
  `VITE_AWS_REGION=${region}`,
  '',
].join('\n');

const frontendEnvPath = path.join(rootDir, 'frontend', '.env');
fs.writeFileSync(frontendEnvPath, frontendEnv, 'utf8');
console.log('Wrote', frontendEnvPath);

console.log('\n--- CDK outputs ---');
console.log('APIEndpoint (VITE_API_URL):', apiUrl);
console.log('CloudFrontURL:', cloudFrontUrl);
console.log('FrontendBucketName:', frontendBucket);
console.log('CloudFrontDistributionId:', outputs.CloudFrontDistributionId || '(see AWS Console)');
console.log('DatabaseClusterArn:', dbClusterArn ? '***set***' : '(missing)');
console.log('DatabaseSecretArn:', dbSecretArn ? '***set***' : '(missing)');
console.log('UserPoolId:', userPoolId ? '***set***' : '(missing)');
console.log('UserPoolClientId:', userPoolClientId ? '***set***' : '(missing)');
console.log('\nNext: npm run build (in frontend), then run scripts/deploy-frontend.sh or upload frontend/dist to S3 and invalidate CloudFront.');
