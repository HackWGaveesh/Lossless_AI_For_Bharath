import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent } from '../../utils/user-id.js';
import { getLocalDocumentStore } from './upload.js';

const REGION = process.env.REGION || process.env.AWS_REGION || 'ap-south-1';
const dynamo = new DynamoDBClient({ region: REGION });
const doc = DynamoDBDocumentClient.from(dynamo);

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents';
const USE_LOCAL_DOCUMENT_STORE = process.env.USE_LOCAL_DOCUMENT_STORE === 'true';

function docTimestamp(item: Record<string, any>): number {
    const processed = Date.parse(String(item.processed_at ?? item.processedAt ?? ''));
    const uploaded = Date.parse(String(item.uploaded_at ?? item.uploadedAt ?? ''));
    const p = Number.isNaN(processed) ? 0 : processed;
    const u = Number.isNaN(uploaded) ? 0 : uploaded;
    return Math.max(p, u);
}

function latestByType(items: any[]): any[] {
    const byType = new Map<string, any>();
    for (const item of items) {
        const key = String(item.document_type || item.documentType || 'unknown');
        const prev = byType.get(key);
        if (!prev || docTimestamp(item) >= docTimestamp(prev)) {
            byType.set(key, item);
        }
    }
    return Array.from(byType.values());
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
            return sendSuccessResponse({ documents: latestByType(ddbDocs) });
        }

        const store = getLocalDocumentStore();
        const localDocs = Array.from(store.values()).filter(d => d.user_id === userId);
        const merged = [...ddbDocs, ...localDocs];
        return sendSuccessResponse({ documents: latestByType(merged) });
    } catch (error) {
        logger.error('Document list error', { error });
        return sendErrorResponse(500, 'Failed to list documents');
    }
};
