import type { APIGatewayProxyEvent } from 'aws-lambda';

type AnyRecord = Record<string, unknown>;

function getHeader(event: APIGatewayProxyEvent, name: string): string | undefined {
  const target = name.toLowerCase();
  const headers = event.headers || {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && typeof v === 'string' && v.trim()) {
      return v.trim();
    }
  }
  return undefined;
}

export function parseJsonBody(event: APIGatewayProxyEvent): AnyRecord {
  try {
    return JSON.parse(event.body || '{}') as AnyRecord;
  } catch {
    return {};
  }
}

export function getUserIdFromEvent(event: APIGatewayProxyEvent, body?: AnyRecord): string | null {
  const claims = (event.requestContext?.authorizer as { claims?: { sub?: string } } | undefined)?.claims;
  const fromClaims = claims?.sub;
  if (fromClaims) return fromClaims;

  const fromHeader = getHeader(event, 'X-User-Id');
  if (fromHeader) return fromHeader;

  const fromQuery = event.queryStringParameters?.userId;
  if (fromQuery) return String(fromQuery);

  const fromBody = body?.userId;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  return null;
}
