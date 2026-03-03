import { logger } from '../utils/logger.js';
import { executeAgentAction } from '../api/agent/action-handler.js';

export type ToolParameters = Array<{ name: string; value: string }>;

export interface ToolContext {
  userId: string;
  language?: string;
  sessionAttributes?: Record<string, string>;
}

export interface ToolResult<TBody = any> {
  success: boolean;
  code: string;
  message?: string;
  raw: any;
  body: TBody;
}

async function invokeTool(functionName: string, params: ToolParameters, ctx: ToolContext): Promise<any> {
  const startedAt = Date.now();
  const sessionAttributes = {
    userId: ctx.userId,
    ...(ctx.language ? { language: ctx.language } : {}),
    ...(ctx.sessionAttributes || {}),
  };

  try {
    const result = await executeAgentAction({
      actionGroup: 'vaanisetu-actions',
      function: functionName,
      parameters: params,
      userId: ctx.userId,
      sessionAttributes,
    });

    const durationMs = Date.now() - startedAt;
    logger.info('ToolRouter.invokeTool', {
      functionName,
      userId: ctx.userId,
      durationMs,
      code: result?.code,
      success: result?.success,
    });

    return result;
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    logger.error('ToolRouter.invokeTool failed', {
      functionName,
      userId: ctx.userId,
      durationMs,
      error: err?.message || String(err),
    });
    throw err;
  }
}

function wrapResult<T = any>(raw: any): ToolResult<T> {
  const code = String(raw?.code || (raw?.success ? 'OK' : 'SYSTEM_ERROR'));
  const success = !!raw?.success && code !== 'SYSTEM_ERROR';
  const message = typeof raw?.message === 'string' ? raw.message : undefined;
  return {
    success,
    code,
    message,
    raw,
    body: raw as T,
  };
}

export async function callTool<T = any>(
  ctx: ToolContext,
  functionName: string,
  params: ToolParameters,
): Promise<ToolResult<T>> {
  const raw = await invokeTool(functionName, params, ctx);
  return wrapResult<T>(raw);
}

