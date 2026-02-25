import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const APPLICATIONS_TABLE = process.env.APPLICATIONS_TABLE || 'vaanisetu-applications';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const userId = event.queryStringParameters?.userId ?? event.requestContext?.authorizer?.claims?.sub;

    if (!userId) {
      return sendErrorResponse(400, 'Missing userId (query param or auth)');
    }

    const result = await docClient.send(new QueryCommand({
      TableName: APPLICATIONS_TABLE,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: { ':uid': String(userId) },
      ScanIndexForward: false,
      Limit: 50,
    }));

    const applications = (result.Items ?? []).map((item) => ({
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
