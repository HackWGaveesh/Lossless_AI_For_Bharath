import type { APIGatewayProxyHandler } from 'aws-lambda';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { logger } from '../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../utils/responses.js';

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
    await dynamo.send(new ListTablesCommand({ Limit: 1 }));
    checks.dynamodb = { status: 'up', latencyMs: Date.now() - ddbStart };
  } catch (e) {
    checks.dynamodb = { status: 'down', error: String(e) };
    overall = 'degraded';
  }

  logger.info('Health check', { overall, checks });

  if (overall === 'ok') {
    return sendSuccessResponse({ status: 'ok', service: 'vaanisetu-backend', checks });
  }
  return sendErrorResponse(503, 'Service degraded', { status: overall, checks });
};
