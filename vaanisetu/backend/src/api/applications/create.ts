import type { APIGatewayProxyHandler } from 'aws-lambda';
import crypto from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';
import { executeAgentAction } from '../agent/action-handler.js';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION || 'ap-south-1' }));
const APPLICATIONS_TABLE = process.env.APPLICATIONS_TABLE || 'vaanisetu-applications';
const USERS_TABLE = process.env.USERS_TABLE || 'vaanisetu-users';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body);
    const schemeId = typeof body.schemeId === 'string' ? body.schemeId.trim() : '';
    const schemeName = typeof body.schemeName === 'string' ? body.schemeName.trim() : '';
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
    const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim() : '';
    const company = typeof body.company === 'string' ? body.company.trim() : '';
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const confirmationToken = typeof body.confirmationToken === 'string' ? body.confirmationToken.trim() : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const effectiveIdempotencyKey = idempotencyKey || deriveIdempotencyKeyFromToken(confirmationToken);
    const confirm = body.confirm === false ? false : true;

    if (!userId || (!schemeId && !schemeName && !query && !confirmationToken && !jobId && !jobTitle)) {
      return sendErrorResponse(400, 'Missing required fields: userId and scheme reference');
    }

    if (jobId || jobTitle) {
      const profileRes = await dynamo.send(new GetCommand({
        TableName: USERS_TABLE,
        Key: { user_id: String(userId) },
      })).catch(() => ({ Item: {} } as any));
      const profile = (profileRes.Item ?? {}) as Record<string, unknown>;

      const state = String(profile.state ?? profile.State ?? '').trim();
      const occupation = String(profile.occupation ?? profile.Occupation ?? '').trim();
      if (!state || !occupation) {
        return sendErrorResponse(400, 'Please complete your profile (state, occupation) before applying for jobs.');
      }

      const existingRes = await dynamo.send(new QueryCommand({
        TableName: APPLICATIONS_TABLE,
        KeyConditionExpression: 'user_id = :uid',
        ExpressionAttributeValues: { ':uid': String(userId) },
        Limit: 100,
      })).catch(() => ({ Items: [] } as any));
      const existing = (existingRes.Items ?? []).find((i: any) => {
        if (jobId) return String(i.job_id || '') === jobId;
        if (jobTitle) return String(i.job_title || '') === jobTitle;
        return false;
      });
      if (existing) {
        return sendSuccessResponse({
          applicationId: existing.application_id,
          applicationType: 'job',
          status: existing.status ?? 'submitted',
          alreadyApplied: true,
          message: 'You have already applied for this job.',
        });
      }

      const now = new Date().toISOString();
      const applicationId = `JOB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const profileSnapshot = profile;

      await dynamo.send(new PutCommand({
        TableName: APPLICATIONS_TABLE,
        Item: {
          user_id: String(userId),
          application_id: applicationId,
          application_type: 'job',
          job_id: jobId || null,
          job_title: jobTitle || null,
          company: company || null,
          scheme_id: '',
          scheme_name: jobTitle || company || 'Job application',
          scheme_code: jobId || '',
          status: 'submitted',
          created_at: now,
          updated_at: now,
          source: 'jobs_page',
          idempotency_key: effectiveIdempotencyKey || null,
          missing_documents: [],
          profile_snapshot: profileSnapshot,
          documents_snapshot: [],
        },
      }));

      return sendSuccessResponse({
        applicationId,
        applicationType: 'job',
        status: 'submitted',
        message: `Job application request created for ${jobTitle || company || 'this job'}.`,
      });
    }

    if (!confirm) {
      const prepared = await executeAgentAction({
        actionGroup: 'vaanisetu-actions',
        function: 'prepareApplication',
        userId,
        sessionAttributes: { userId },
        parameters: [
          { name: 'userId', value: String(userId) },
          { name: 'schemeId', value: schemeId },
          { name: 'schemeName', value: schemeName },
          { name: 'query', value: query || schemeName || schemeId },
        ],
      });

      if (prepared?.code === 'DATA_UNAVAILABLE') {
        return sendErrorResponse(503, prepared?.message || 'Live application data is temporarily unavailable');
      }

      return sendSuccessResponse({
        needsConfirmation: prepared?.code === 'NEEDS_CONFIRMATION',
        confirmationToken: prepared.confirmationToken ?? null,
        scheme: prepared.scheme ?? null,
        missingDocuments: prepared.missingDocuments ?? [],
        message: prepared.message ?? 'Please confirm application before submission.',
        code: prepared.code ?? 'NEEDS_CONFIRMATION',
        options: prepared.options ?? [],
      });
    }

    const submitted = await executeAgentAction({
      actionGroup: 'vaanisetu-actions',
      function: 'submitApplication',
      userId,
      sessionAttributes: { userId },
      parameters: [
        { name: 'userId', value: String(userId) },
        { name: 'confirm', value: 'true' },
        { name: 'schemeId', value: schemeId },
        { name: 'schemeName', value: schemeName },
        { name: 'query', value: query || schemeName || schemeId },
        { name: 'confirmationToken', value: confirmationToken },
        { name: 'idempotencyKey', value: effectiveIdempotencyKey },
      ],
    });

    if (submitted?.code === 'DATA_UNAVAILABLE') {
      return sendErrorResponse(503, submitted?.message || 'Live application data is temporarily unavailable');
    }

    if (!submitted?.success) {
      return sendSuccessResponse({
        needsConfirmation: submitted?.code === 'NEEDS_CONFIRMATION',
        confirmationToken: submitted?.confirmationToken ?? null,
        missingDocuments: submitted?.missingDocuments ?? [],
        code: submitted?.code ?? 'SYSTEM_ERROR',
        message: submitted?.message ?? 'Could not submit application',
        options: submitted?.options ?? [],
      });
    }

    logger.info('Application created via unified workflow', { userId, applicationId: submitted.applicationId, schemeId: submitted.schemeId });

    return sendSuccessResponse({
      applicationId: submitted.applicationId,
      status: submitted.status ?? 'submitted',
      schemeId: submitted.schemeId ?? null,
      schemeCode: submitted.schemeCode ?? null,
      schemeName: submitted.schemeName ?? null,
      needsConfirmation: false,
      missingDocuments: submitted.missingDocuments ?? [],
      message: submitted.message ?? 'Application submitted successfully.',
      code: submitted.code ?? 'OK',
    });
  } catch (error) {
    logger.error('Error creating application', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};

function deriveIdempotencyKeyFromToken(token: string): string {
  if (!token) return '';
  return `confirm-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
}
