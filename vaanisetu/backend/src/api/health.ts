import type { APIGatewayProxyHandler } from 'aws-lambda';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { logger } from '../utils/logger.js';
import { sendSuccessResponse } from '../utils/responses.js';

const rds = new RDSDataClient({ region: process.env.REGION });
const dynamo = new DynamoDBClient({ region: process.env.REGION });

export const handler: APIGatewayProxyHandler = async () => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let overall = 'ok';

  try {
    const dbStart = Date.now();
    await rds.send(
      new ExecuteStatementCommand({
        resourceArn: process.env.DB_CLUSTER_ARN!,
        secretArn: process.env.DB_SECRET_ARN!,
        database: process.env.DB_NAME!,
        sql: 'SELECT 1',
      })
    );
    checks.aurora = { status: 'up', latencyMs: Date.now() - dbStart };
  } catch (e) {
    checks.aurora = { status: 'down', error: String(e) };
    overall = 'degraded';
  }

  try {
    const ddbStart = Date.now();
    const tableName = process.env.USERS_TABLE ?? process.env.APPLICATIONS_TABLE;
    if (!tableName) throw new Error('No DynamoDB table configured for health check');
    await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
    checks.dynamodb = { status: 'up', latencyMs: Date.now() - ddbStart };
  } catch (e) {
    checks.dynamodb = { status: 'down', error: String(e) };
    overall = 'degraded';
  }

  logger.info('Health check', { overall, checks });

  return sendSuccessResponse({
    status: overall,
    service: 'vaanisetu-backend',
    checks,
    bedrockAgentId: process.env.BEDROCK_AGENT_ID ? 'configured' : null,
    bedrockAgentAlias: process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID',
    guardrailsEnabled: !!process.env.BEDROCK_GUARDRAIL_ID,
    model: 'us.amazon.nova-pro-v1:0',
    agentActions: ['getSchemesByProfile', 'createApplication', 'getApplicationStatus', 'getJobsByProfile'],
    kycPipeline: '10-step: structural→textract→rekognition→novaProFraud',
    awsServicesCount: 15,
  });
};
