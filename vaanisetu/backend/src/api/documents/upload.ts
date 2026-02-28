import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';

const REGION = process.env.REGION || process.env.AWS_REGION || 'ap-south-1';
const s3 = new S3Client({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(dynamo);
const USE_LOCAL_DOCUMENT_STORE = process.env.USE_LOCAL_DOCUMENT_STORE === 'true';
const localDocumentStore = new Map<string, Record<string, unknown>>();

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body);
    const documentType = typeof body.documentType === 'string' ? body.documentType : undefined;
    const fileName = typeof body.fileName === 'string' ? body.fileName : undefined;
    const contentType = typeof body.contentType === 'string' ? body.contentType : undefined;

    if (!userId || !documentType || !fileName) {
      return sendErrorResponse(400, 'Missing required fields: userId, documentType, fileName');
    }

    const documentId = uuidv4();
    const fileExtension = (fileName as string).split('.').pop() || 'bin';
    const key = `${userId}/${documentType}/${documentId}.${fileExtension}`;
    const now = new Date().toISOString();

    let uploadUrl = '';
    if (USE_LOCAL_DOCUMENT_STORE) {
      localDocumentStore.set(`${userId}:${documentId}`, {
        user_id: String(userId),
        document_id: documentId,
        document_type: String(documentType),
        s3_key: key,
        status: 'processing',
        uploaded_at: now,
      });
      uploadUrl = `http://localhost:3001/api/documents/mock-upload/${documentId}`;
    } else {
      const command = new PutObjectCommand({
        Bucket: process.env.DOCUMENTS_BUCKET!,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
        Metadata: {
          userId: String(userId),
          documentType: String(documentType),
          documentId,
        },
      });
      uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      await doc.send(new PutCommand({
        TableName: process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents',
        Item: {
          user_id: String(userId),
          document_id: documentId,
          document_type: String(documentType),
          s3_key: key,
          status: 'processing',
          uploaded_at: now,
        },
      }));
    }

    logger.info('Generated upload URL', { userId, documentId, key });

    return sendSuccessResponse({
      documentId,
      uploadUrl,
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    logger.error('Error generating upload URL', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};

export function getLocalDocumentStore() {
  return localDocumentStore;
}

export function getDocumentStore() {
  return localDocumentStore;
}

export function updateDocumentStore(key: string, value: Record<string, unknown>) {
  localDocumentStore.set(key, value);
}
