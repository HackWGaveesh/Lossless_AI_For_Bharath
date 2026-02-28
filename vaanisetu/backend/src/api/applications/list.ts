import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent } from '../../utils/user-id.js';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const APPLICATIONS_TABLE = process.env.APPLICATIONS_TABLE || 'vaanisetu-applications';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const userId = getUserIdFromEvent(event);

    if (!userId) {
      return sendErrorResponse(401, 'Unauthorized');
    }

    let items = [];
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: APPLICATIONS_TABLE,
        KeyConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: { ':uid': String(userId) },
        ScanIndexForward: false,
        Limit: 50,
      }));
      items = result.Items ?? [];
    } catch (dbError) {
      logger.warn('DynamoDB failed, using in-memory store for applications', { userId });
      const { IN_MEMORY_STORE } = await import('../../utils/local-store.js');
      items = IN_MEMORY_STORE.applications[userId] ?? [];
    }

    const applications = items.map((item: any) => ({
      application_id: item.application_id,
      scheme_id: item.scheme_id,
      status: item.status,
      created_at: item.created_at,
    }));

    return sendSuccessResponse({ applications });
  } catch (error) {
    logger.error('Error listing applications', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};
