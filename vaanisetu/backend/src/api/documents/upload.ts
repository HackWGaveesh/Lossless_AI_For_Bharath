import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';
import { createDocumentProcessingSteps } from '../../utils/document-processing.js';
import { getCurrentDocumentsByType, normalizeDocumentType } from '../../utils/document-selection.js';

const REGION = process.env.REGION || process.env.AWS_REGION || 'ap-south-1';
const s3 = new S3Client({ region: REGION });
const dynamo = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(dynamo, {
  marshallOptions: { removeUndefinedValues: true },
});
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
    const processingSteps = createDocumentProcessingSteps(now);
    let existingCurrentDocumentId = '';

    if (USE_LOCAL_DOCUMENT_STORE) {
      const localDocs = Array.from(localDocumentStore.values()).filter((item) => String(item.user_id) === String(userId));
      const currentDocs = getCurrentDocumentsByType(localDocs as Record<string, unknown>[]);
      existingCurrentDocumentId = String(
        currentDocs.get(normalizeDocumentType(documentType))?.document_id
        ?? currentDocs.get(normalizeDocumentType(documentType))?.documentId
        ?? '',
      );
    } else {
      try {
        const result = await doc.send(new QueryCommand({
          TableName: process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents',
          KeyConditionExpression: 'user_id = :uid',
          ExpressionAttributeValues: { ':uid': String(userId) },
          ScanIndexForward: false,
          Limit: 100,
        }));
        const currentDocs = getCurrentDocumentsByType((result.Items ?? []) as Record<string, unknown>[]);
        existingCurrentDocumentId = String(
          currentDocs.get(normalizeDocumentType(documentType))?.document_id
          ?? currentDocs.get(normalizeDocumentType(documentType))?.documentId
          ?? '',
        );
      } catch (queryError) {
        logger.warn('Could not query existing documents before upload', { userId, documentType, queryError });
      }
    }

    const documentsBucket = process.env.DOCUMENTS_BUCKET;
    const documentsTable = process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents';

    if (!USE_LOCAL_DOCUMENT_STORE && !documentsBucket) {
      logger.error('DOCUMENTS_BUCKET is not set');
      return sendErrorResponse(503, 'Document upload is not configured (DOCUMENTS_BUCKET missing).');
    }

    let uploadUrl = '';
    if (USE_LOCAL_DOCUMENT_STORE) {
      localDocumentStore.set(`${userId}:${documentId}`, {
        user_id: String(userId),
        document_id: documentId,
        document_type: String(documentType),
        s3_key: key,
        status: 'processing',
        uploaded_at: now,
        current_stage: 'upload',
        processing_steps: processingSteps,
        is_current: false,
        replaces_document_id: existingCurrentDocumentId || undefined,
        replacement_decision: existingCurrentDocumentId ? 'pending' : undefined,
      });
      uploadUrl = `http://localhost:3001/api/documents/mock-upload/${documentId}`;
    } else {
      const command = new PutObjectCommand({
        Bucket: documentsBucket,
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
        TableName: documentsTable,
        Item: {
          user_id: String(userId),
          document_id: documentId,
          document_type: String(documentType),
          s3_key: key,
          status: 'processing',
          uploaded_at: now,
          current_stage: 'upload',
          processing_steps: processingSteps,
          is_current: false,
          replaces_document_id: existingCurrentDocumentId || undefined,
          replacement_decision: existingCurrentDocumentId ? 'pending' : undefined,
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
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logger.error('Error generating upload URL', { errorMessage: errMsg, errorStack: errStack, DOCUMENTS_BUCKET: process.env.DOCUMENTS_BUCKET ?? 'NOT_SET', DOCUMENTS_TABLE: process.env.DOCUMENTS_TABLE ?? 'NOT_SET' });
    return sendErrorResponse(500, `Upload URL generation failed: ${errMsg}`);
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
