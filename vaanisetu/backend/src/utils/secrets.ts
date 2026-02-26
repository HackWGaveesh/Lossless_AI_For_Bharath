import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { logger } from './logger.js';

const client = new SecretsManagerClient({ region: process.env.REGION });
const cache = new Map<string, { value: unknown; expiry: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getSecret(secretId: string): Promise<Record<string, string>> {
  const cached = cache.get(secretId);
  if (cached && cached.expiry > Date.now()) {
    return cached.value as Record<string, string>;
  }
  try {
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );
    const raw = res.SecretString ?? '';
    const value = JSON.parse(raw) as Record<string, string>;
    cache.set(secretId, { value, expiry: Date.now() + TTL_MS });
    return value;
  } catch (error) {
    logger.error('getSecret failed', { secretId, error });
    return {};
  }
}
