import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent } from '../../utils/user-id.js';
import { getLocalDocumentStore } from './upload.js';

const dynamo = new DynamoDBClient({ region: process.env.REGION });
const doc = DynamoDBDocumentClient.from(dynamo);

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents';
const USE_LOCAL_DOCUMENT_STORE = process.env.USE_LOCAL_DOCUMENT_STORE === 'true';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = getUserIdFromEvent(event);
  const documentId = event.pathParameters?.id;

  if (!userId || !documentId) {
    return sendErrorResponse(400, 'Missing userId or documentId');
  }

  try {
    let item: any = null;
    if (USE_LOCAL_DOCUMENT_STORE) {
      try {
        const store = getLocalDocumentStore();
        item = store.get(`${userId}:${documentId}`) ?? null;
      } catch {}
    }

    if (!item) {
      const res = await doc.send(
        new QueryCommand({
          TableName: DOCUMENTS_TABLE,
          KeyConditionExpression: 'user_id = :uid AND document_id = :did',
          ExpressionAttributeValues: { ':uid': userId, ':did': documentId },
          Limit: 1,
        })
      );
      item = res.Items?.[0];
      if (!item) {
        logger.warn('Document not found in DynamoDB', { userId, documentId });
      }
    }

    if (!item) return sendErrorResponse(404, 'Document not found');

    return sendSuccessResponse({
      documentId: item.document_id,
      status: item.status ?? 'pending',
      structured_data: item.structured_data,
      processed_at: item.processed_at,
      error_message: item.error_message,
    });
  } catch (error) {
    logger.error('Document status error', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};
