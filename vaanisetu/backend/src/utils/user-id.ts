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

function looksLikePhone(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

export function getUserIdFromEvent(event: APIGatewayProxyEvent, body?: AnyRecord): string | null {
  const claims = (event.requestContext?.authorizer as { claims?: { sub?: string } } | undefined)?.claims;
  const fromClaims = claims?.sub;
  if (fromClaims) return fromClaims;

  const fromHeader = getHeader(event, 'X-User-Id');
  if (fromHeader) {
    if (looksLikePhone(fromHeader)) return normalizePhoneForUserId(fromHeader);
    return fromHeader;
  }

  const fromQuery = event.queryStringParameters?.userId;
  if (fromQuery) {
    const q = String(fromQuery);
    if (looksLikePhone(q)) return normalizePhoneForUserId(q);
    return q;
  }

  const fromBody = body?.userId;
  if (typeof fromBody === 'string' && fromBody.trim()) {
    const b = fromBody.trim();
    if (looksLikePhone(b)) return normalizePhoneForUserId(b);
    return b;
  }

  return null;
}

/**
 * Normalize phone to a canonical userId format (digits only, India 91 prefix for 10-digit).
 * Used so web and Telegram share the same partition key for a user.
 */
export function normalizePhoneForUserId(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('91')) return digits;
  if (digits.length >= 10 && digits.length <= 13) return digits;
  return digits || '';
}
