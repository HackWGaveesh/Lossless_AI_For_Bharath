import type { APIGatewayProxyHandler } from 'aws-lambda';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';
import { executeAgentAction } from '../agent/action-handler.js';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body);
    const schemeId = typeof body.schemeId === 'string' ? body.schemeId.trim() : '';
    const schemeName = typeof body.schemeName === 'string' ? body.schemeName.trim() : '';
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const confirmationToken = typeof body.confirmationToken === 'string' ? body.confirmationToken.trim() : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    const effectiveIdempotencyKey = idempotencyKey || deriveIdempotencyKeyFromToken(confirmationToken);
    const confirm = body.confirm === false ? false : true;

    if (!userId || (!schemeId && !schemeName && !query && !confirmationToken)) {
      return sendErrorResponse(400, 'Missing required fields: userId and scheme reference');
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
