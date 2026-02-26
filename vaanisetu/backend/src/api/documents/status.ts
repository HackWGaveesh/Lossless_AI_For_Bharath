import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const dynamo = new DynamoDBClient({ region: process.env.REGION });
const doc = DynamoDBDocumentClient.from(dynamo);

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext?.authorizer?.claims?.sub ?? event.queryStringParameters?.userId;
  const documentId = event.pathParameters?.id;

  if (!userId || !documentId) {
    return sendErrorResponse(400, 'Missing userId or documentId');
  }

  try {
    const res = await doc.send(
      new QueryCommand({
        TableName: DOCUMENTS_TABLE,
        KeyConditionExpression: 'user_id = :uid AND document_id = :did',
        ExpressionAttributeValues: { ':uid': userId, ':did': documentId },
        Limit: 1,
      })
    );

    const item = res.Items?.[0];
    if (!item) return sendErrorResponse(404, 'Document not found');

    return sendSuccessResponse({
      documentId: item.document_id,
      status: item.status ?? 'pending',
      structured_data: item.structured_data,
      processed_at: item.processed_at,
    });
  } catch (error) {
    logger.error('Document status error', { error });
    return sendErrorResponse(500, 'Failed to get document status');
  }
};
