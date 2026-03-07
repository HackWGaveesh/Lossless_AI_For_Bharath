import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';
import { getCurrentDocumentsByType, normalizeDocumentType, sortDocumentsNewestFirst } from '../../utils/document-selection.js';

const dynamo = new DynamoDBClient({ region: process.env.REGION });
const doc = DynamoDBDocumentClient.from(dynamo, {
  marshallOptions: { removeUndefinedValues: true },
});
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents';

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = getUserIdFromEvent(event);
  const documentId = event.pathParameters?.id;
  const body = parseJsonBody(event);
  const keepPrevious = body.keepPrevious !== false;

  if (!userId || !documentId) {
    return sendErrorResponse(400, 'Missing userId or documentId');
  }

  try {
    const failedResult = await doc.send(
      new GetCommand({
        TableName: DOCUMENTS_TABLE,
        Key: { user_id: String(userId), document_id: documentId },
      }),
    );
    const failedDoc = failedResult.Item as Record<string, any> | undefined;

    if (!failedDoc) {
      return sendErrorResponse(404, 'Document not found');
    }
    if (String(failedDoc.status || '') !== 'failed') {
      return sendErrorResponse(400, 'Only failed replacement documents can be resolved');
    }

    const now = new Date().toISOString();
    const replacedDocumentId = String(failedDoc.replaces_document_id ?? '');

    if (keepPrevious) {
      await doc.send(new PutCommand({
        TableName: DOCUMENTS_TABLE,
        Item: {
          ...failedDoc,
          replacement_decision: 'keep_previous',
          updated_at: now,
        },
      }));
    } else {
      if (replacedDocumentId) {
        const previous = await doc.send(new GetCommand({
          TableName: DOCUMENTS_TABLE,
          Key: { user_id: String(userId), document_id: replacedDocumentId },
        }));
        if (previous.Item) {
          await doc.send(new PutCommand({
            TableName: DOCUMENTS_TABLE,
            Item: {
              ...previous.Item,
              is_current: false,
              updated_at: now,
            },
          }));
        }
      }

      await doc.send(new PutCommand({
        TableName: DOCUMENTS_TABLE,
        Item: {
          ...failedDoc,
          replacement_decision: 'discard_previous',
          updated_at: now,
        },
      }));
    }

    const docsResult = await doc.send(new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: { ':uid': String(userId) },
      ScanIndexForward: false,
      Limit: 100,
    }));
    const sortedDocs = sortDocumentsNewestFirst((docsResult.Items ?? []) as Record<string, any>[]);
    const currentDocs = getCurrentDocumentsByType(sortedDocs);
    const currentForType = currentDocs.get(normalizeDocumentType(failedDoc.document_type ?? failedDoc.documentType));

    return sendSuccessResponse({
      documentId,
      resolved: true,
      keepPrevious,
      currentDocumentId: currentForType?.document_id ?? currentForType?.documentId ?? null,
      currentDocumentStatus: currentForType?.status ?? null,
    });
  } catch (error) {
    logger.error('Failed to resolve replacement decision', { userId, documentId, error });
    return sendErrorResponse(500, 'Failed to resolve replacement decision');
  }
};
