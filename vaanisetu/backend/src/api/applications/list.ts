import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent } from '../../utils/user-id.js';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const APPLICATIONS_TABLE = process.env.APPLICATIONS_TABLE || 'vaanisetu-applications';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const userId = getUserIdFromEvent(event);

    if (!userId) {
      return sendErrorResponse(401, 'Unauthorized');
    }

    const applicationId = (event.queryStringParameters?.id ?? event.queryStringParameters?.applicationId ?? '').trim();

    let items: any[] = [];
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: APPLICATIONS_TABLE,
        KeyConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: { ':uid': String(userId) },
        ScanIndexForward: false,
        Limit: 50,
      }));
      items = result.Items ?? [];
    } catch (dbError) {
      logger.warn('DynamoDB failed, using in-memory store for applications', { userId });
      const { IN_MEMORY_STORE } = await import('../../utils/local-store.js');
      items = IN_MEMORY_STORE.applications[userId] ?? [];
    }

    const jobDisplayStatus = (item: any) =>
      (item.application_type === 'job' && item.status === 'interested') ? 'submitted' : (item.status ?? 'submitted');

    if (applicationId) {
      const one = items.find((i: any) => String(i.application_id) === applicationId);
      if (!one) {
        return sendErrorResponse(404, 'Application not found');
      }
      return sendSuccessResponse({
        application: {
          application_id: one.application_id,
          application_type: one.application_type ?? 'scheme',
          scheme_id: one.scheme_id,
          scheme_name: one.scheme_name,
          scheme_code: one.scheme_code,
          job_id: one.job_id,
          job_title: one.job_title,
          company: one.company,
          status: jobDisplayStatus(one),
          created_at: one.created_at,
          updated_at: one.updated_at,
          missing_documents: one.missing_documents ?? [],
          profile_snapshot: one.profile_snapshot ?? {},
          documents_snapshot: one.documents_snapshot ?? [],
        },
      });
    }

    const applications = items.map((item: any) => ({
      application_id: item.application_id,
      application_type: item.application_type ?? 'scheme',
      scheme_id: item.scheme_id,
      scheme_name: item.scheme_name,
      scheme_code: item.scheme_code,
      job_id: item.job_id,
      job_title: item.job_title,
      company: item.company,
      status: jobDisplayStatus(item),
      created_at: item.created_at,
      updated_at: item.updated_at,
      missing_documents: item.missing_documents ?? [],
    })).sort((a: any, b: any) =>
      new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime()
    );

    return sendSuccessResponse({ applications });
  } catch (error) {
    logger.error('Error listing applications', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};
