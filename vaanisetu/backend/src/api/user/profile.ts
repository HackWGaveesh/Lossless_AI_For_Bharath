import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const dynamo = new DynamoDBClient({ region: process.env.REGION });
const doc = DynamoDBDocumentClient.from(dynamo);
const USERS_TABLE = process.env.USERS_TABLE ?? 'vaanisetu-users';

const PROFILE_KEYS = [
  'name', 'phone', 'state', 'district', 'age', 'occupation', 'annual_income',
  'caste_category', 'preferred_language', 'family_members', 'gender', 'email',
] as const;

export const handler: APIGatewayProxyHandler = async (event) => {
  const userId = event.requestContext?.authorizer?.claims?.sub;
  if (!userId) {
    return sendErrorResponse(401, 'Unauthorized');
  }

  try {
    if (event.httpMethod === 'GET') {
      const res = await doc.send(
        new GetCommand({
          TableName: USERS_TABLE,
          Key: { user_id: userId },
        })
      );
      const profile = res.Item ?? {};
      const publicProfile = Object.fromEntries(
        PROFILE_KEYS.filter((k) => profile[k] != null).map((k) => [k, profile[k]])
      );
      return sendSuccessResponse({ profile: publicProfile });
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body ?? '{}');
      const updates: Record<string, unknown> = {};
      for (const k of PROFILE_KEYS) {
        if (body[k] !== undefined) updates[k] = body[k];
      }
      const updatedAt = new Date().toISOString();
      await doc.send(
        new PutCommand({
          TableName: USERS_TABLE,
          Item: {
            user_id: userId,
            ...updates,
            updated_at: updatedAt,
          },
        })
      );
      return sendSuccessResponse({ profile: updates, updated_at: updatedAt });
    }

    return sendErrorResponse(405, 'Method not allowed');
  } catch (error) {
    logger.error('Profile error', { error });
    return sendErrorResponse(500, 'Failed to update profile');
  }
};
