import type { Handler } from 'aws-lambda';
import { logger } from '../../utils/logger.js';
import { handleBudgetSnsEvent } from '../../services/runtime-config-service.js';

export const handler: Handler = async (event) => {
  const result = await handleBudgetSnsEvent(event);
  logger.info('Processed budget SNS event', {
    updated: result.updated,
    mode: result.mode,
    records: Array.isArray((event as any)?.Records) ? (event as any).Records.length : 0,
  });
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, ...result }),
  };
};
