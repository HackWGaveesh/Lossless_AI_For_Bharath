import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent } from '../../utils/user-id.js';
import { getLocalDocumentStore } from './upload.js';
import { getCurrentDocumentsByType, normalizeDocumentType, sortDocumentsNewestFirst } from '../../utils/document-selection.js';

const REGION = process.env.REGION || process.env.AWS_REGION || 'ap-south-1';
const dynamo = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(dynamo);

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents';
const USE_LOCAL_DOCUMENT_STORE = process.env.USE_LOCAL_DOCUMENT_STORE === 'true';

function toPublicDocument(item: Record<string, any>) {
    return {
        ...item,
        current_stage: item.current_stage,
        processing_steps: item.processing_steps,
        is_current: item.is_current ?? false,
        replaces_document_id: item.replaces_document_id ?? null,
        replacement_decision: item.replacement_decision ?? null,
    };
}

export const handler: APIGatewayProxyHandler = async (event) => {
    const userId = getUserIdFromEvent(event);

    if (!userId) {
        return sendErrorResponse(400, 'Missing userId');
    }

    try {
        let ddbDocs: any[] = [];
        // Try DynamoDB first
        try {
            const res = await doc.send(
                new QueryCommand({
                    TableName: DOCUMENTS_TABLE,
                    KeyConditionExpression: 'user_id = :uid',
                    ExpressionAttributeValues: { ':uid': userId },
                })
            );
            ddbDocs = res.Items || [];
        } catch (ddbErr) {
            logger.warn('DynamoDB unavailable for document list', { ddbErr });
        }

        if (!USE_LOCAL_DOCUMENT_STORE) {
            const sorted = sortDocumentsNewestFirst(ddbDocs);
            const currentMap = getCurrentDocumentsByType(sorted);
            return sendSuccessResponse({
                documents: sorted.map((item) => toPublicDocument({
                    ...item,
                    is_current: currentMap.get(normalizeDocumentType(item.document_type ?? item.documentType))?.document_id === item.document_id,
                })),
            });
        }

        const store = getLocalDocumentStore();
        const localDocs = Array.from(store.values()).filter(d => d.user_id === userId);
        const merged = [...ddbDocs, ...localDocs];
        const sorted = sortDocumentsNewestFirst(merged);
        const currentMap = getCurrentDocumentsByType(sorted);
        return sendSuccessResponse({
            documents: sorted.map((item) => toPublicDocument({
                ...item,
                is_current: currentMap.get(normalizeDocumentType(item.document_type ?? item.documentType))?.document_id === item.document_id,
            })),
        });
    } catch (error) {
        logger.error('Document list error', { error });
        return sendErrorResponse(500, 'Failed to list documents');
    }
};
