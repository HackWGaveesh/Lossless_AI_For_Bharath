import type { APIGatewayProxyHandler } from 'aws-lambda';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';
import { handleConversation } from '../../services/assistant-orchestrator.js';
import type { ConversationRequest } from '../../types/conversation.js';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body);
    const {
      transcript,
      language = 'hi-IN',
      sessionContext = [],
      sessionId = '',
      messageId = '',
      idempotencyKey = '',
      channel = 'voice',
      forceLanguage = '',
      confirmationToken = '',
    } = body as {
      transcript?: string;
      language?: string;
      sessionContext?: { role: string; content: string }[];
      sessionId?: string;
      messageId?: string;
      idempotencyKey?: string;
      channel?: string;
      forceLanguage?: string;
      confirmationToken?: string;
    };

    if (!transcript?.trim()) {
      return sendErrorResponse(400, 'Missing transcript');
    }
    if (!userId) {
      return sendErrorResponse(401, 'Unauthorized: missing user context');
    }
    if (!sessionId?.trim()) {
      return sendErrorResponse(400, 'Missing sessionId');
    }
    if (messageId && typeof messageId !== 'string') {
      return sendErrorResponse(400, 'Invalid messageId');
    }

    const request: ConversationRequest = {
      userId,
      sessionId,
      transcript,
      language,
      sessionContext: (Array.isArray(sessionContext) ? sessionContext : []).map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      })),
      idempotencyKey: idempotencyKey || '',
      channel,
      forceLanguage,
      confirmationToken,
    };

    const conv = await handleConversation(request);

    return sendSuccessResponse(conv);
  } catch (err: any) {
    logger.error('Voice query crashed', { error: err.message });
    return sendErrorResponse(500, 'Failed to process voice query');
  }
};
