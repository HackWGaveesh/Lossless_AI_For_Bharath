import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const APPLICATIONS_TABLE = process.env.APPLICATIONS_TABLE || 'vaanisetu-applications';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body);
    const schemeId = typeof body.schemeId === 'string' ? body.schemeId : undefined;
    const formData = (body.formData as Record<string, unknown> | undefined) ?? {};

    if (!userId || !schemeId) {
      return sendErrorResponse(400, 'Missing required fields: userId, schemeId');
    }

    const applicationId = `APP-${uuidv4().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    const item = {
      user_id: String(userId),
      application_id: applicationId,
      scheme_id: schemeId,
      form_data: formData,
      status: 'submitted',
      created_at: now,
      updated_at: now,
    };

    try {
      await docClient.send(new PutCommand({
        TableName: APPLICATIONS_TABLE,
        Item: item,
      }));
    } catch (dbError) {
      logger.warn('DynamoDB failed, using in-memory store for applications', { userId });
    }

    // Always update in-memory for local dev
    const { IN_MEMORY_STORE } = await import('../../utils/local-store.js');
    if (!IN_MEMORY_STORE.applications[userId]) IN_MEMORY_STORE.applications[userId] = [];
    IN_MEMORY_STORE.applications[userId].unshift(item);

    logger.info('Application created', { userId, applicationId, schemeId });

    return sendSuccessResponse({
      applicationId,
      status: 'submitted',
      message: 'Application submitted successfully.',
    });
  } catch (error) {
    logger.error('Error creating application', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};
