import { corsHeaders } from './cors.js';

export function sendSuccessResponse(data: unknown, statusCode = 200) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ success: true, data }),
  };
}

export function sendErrorResponse(statusCode: number, message: string, details?: unknown) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({
      success: false,
      error: { message, details },
    }),
  };
}
