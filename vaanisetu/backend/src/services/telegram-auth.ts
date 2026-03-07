/**
 * Telegram auth: bind Telegram chat_id to phone (canonical userId) and handle
 * Cognito CUSTOM_AUTH flow (phone → OTP → verify) so Telegram users "log in" like web.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AuthFlowType,
  ChallengeNameType,
} from '@aws-sdk/client-cognito-identity-provider';
import { logger } from '../utils/logger.js';
import { normalizePhoneForUserId } from '../utils/user-id.js';

const region = process.env.REGION || process.env.AWS_REGION || 'ap-south-1';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const cognito = new CognitoIdentityProviderClient({ region });

const TELEGRAM_AUTH_TABLE = process.env.TELEGRAM_AUTH_TABLE || 'vaanisetu-telegram-auth';
const USER_POOL_ID = process.env.USER_POOL_ID || '';
const AUTH_TTL_SECONDS = 300; // 5 min for pending OTP

export interface TelegramBinding {
  phone_number: string;
  linked_at: number;
}

export interface TelegramPendingAuth {
  cognito_session: string;
  phone_number: string;
  auth_ttl: number;
}

export async function getBinding(chatId: number): Promise<TelegramBinding | null> {
  try {
    const res = await ddb.send(
      new GetCommand({
        TableName: TELEGRAM_AUTH_TABLE,
        Key: { chat_id: String(chatId) },
      })
    );
    const item = res.Item as { phone_number?: string; linked_at?: number; cognito_session?: string } | undefined;
    if (item?.phone_number && !item.cognito_session) {
      return { phone_number: item.phone_number, linked_at: item.linked_at ?? Date.now() };
    }
    return null;
  } catch (e) {
    logger.warn('Telegram getBinding failed', { chatId, error: String(e) });
    return null;
  }
}

export async function setBinding(chatId: number, phoneNumber: string): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365; // 1 year
  try {
    await ddb.send(
      new PutCommand({
        TableName: TELEGRAM_AUTH_TABLE,
        Item: {
          chat_id: String(chatId),
          phone_number: phoneNumber,
          linked_at: Date.now(),
          ttl,
        },
      })
    );
  } catch (e) {
    logger.warn('Telegram setBinding failed', { chatId, error: String(e) });
    throw e;
  }
}

export async function getPending(chatId: number): Promise<TelegramPendingAuth | null> {
  try {
    const res = await ddb.send(
      new GetCommand({
        TableName: TELEGRAM_AUTH_TABLE,
        Key: { chat_id: String(chatId) },
      })
    );
    const item = res.Item as {
      cognito_session?: string;
      pending_phone?: string;
      auth_ttl?: number;
    } | undefined;
    if (item?.cognito_session && item?.pending_phone && item?.auth_ttl && item.auth_ttl > Math.floor(Date.now() / 1000)) {
      return {
        cognito_session: item.cognito_session,
        phone_number: item.pending_phone,
        auth_ttl: item.auth_ttl,
      };
    }
    return null;
  } catch (e) {
    logger.warn('Telegram getPending failed', { chatId, error: String(e) });
    return null;
  }
}

export async function setPending(chatId: number, cognitoSession: string, phoneNumber: string): Promise<void> {
  const authTtl = Math.floor(Date.now() / 1000) + AUTH_TTL_SECONDS;
  try {
    await ddb.send(
      new PutCommand({
        TableName: TELEGRAM_AUTH_TABLE,
        Item: {
          chat_id: String(chatId),
          cognito_session: cognitoSession,
          pending_phone: phoneNumber,
          auth_ttl: authTtl,
          ttl: authTtl,
        },
      })
    );
  } catch (e) {
    logger.warn('Telegram setPending failed', { chatId, error: String(e) });
    throw e;
  }
}

export async function clearPending(chatId: number): Promise<void> {
  try {
    const existing = await ddb.send(
      new GetCommand({
        TableName: TELEGRAM_AUTH_TABLE,
        Key: { chat_id: String(chatId) },
      })
    );
    const item = existing.Item as Record<string, unknown> | undefined;
    if (!item) return;
    await ddb.send(
      new UpdateCommand({
        TableName: TELEGRAM_AUTH_TABLE,
        Key: { chat_id: String(chatId) },
        UpdateExpression: 'REMOVE cognito_session, pending_phone, auth_ttl',
      })
    );
  } catch (e) {
    logger.warn('Telegram clearPending failed', { chatId, error: String(e) });
  }
}

/** Normalize to E.164 for Cognito (e.g. +919876543210). */
function toCognitoPhone(phone: string): string {
  const normalized = normalizePhoneForUserId(phone);
  if (normalized.length === 10) return `+91${normalized}`;
  if (normalized.length === 11 && normalized.startsWith('91')) return `+${normalized}`;
  if (normalized.startsWith('91')) return `+${normalized}`;
  return `+91${normalized.slice(-10)}`;
}

/**
 * Ensure a Cognito user exists for this phone (for Telegram-only signup).
 * Uses AdminCreateUser with username = phone; PreSignUp will auto-confirm.
 */
export async function ensureCognitoUser(phone: string): Promise<boolean> {
  if (!USER_POOL_ID) {
    logger.warn('USER_POOL_ID not set, skipping ensureCognitoUser');
    return false;
  }
  const cognitoPhone = toCognitoPhone(phone);
  try {
    await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: cognitoPhone,
      })
    );
    return true; // already exists
  } catch (e: unknown) {
    const err = e as { name?: string };
    if (err?.name === 'UserNotFoundException') {
      try {
        await cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: cognitoPhone,
            UserAttributes: [
              { Name: 'phone_number', Value: cognitoPhone },
              { Name: 'phone_number_verified', Value: 'true' },
              { Name: 'preferred_username', Value: cognitoPhone },
            ],
            TemporaryPassword: `Temp${Date.now()}!x`,
            MessageAction: 'SUPPRESS',
          })
        );
        return true;
      } catch (createErr) {
        logger.error('AdminCreateUser failed', { phone: cognitoPhone, error: String(createErr) });
        return false;
      }
    }
    logger.warn('AdminGetUser failed', { phone: cognitoPhone, error: String(e) });
    return false;
  }
}

/**
 * Start Cognito CUSTOM_AUTH for this phone; triggers CreateAuthChallenge (sends OTP).
 * Returns session and challenge name for use in respondToCognitoAuth.
 */
export async function initiateCognitoAuth(phone: string): Promise<{ session: string; challengeName: string } | null> {
  if (!USER_POOL_ID) {
    logger.warn('USER_POOL_ID not set');
    return null;
  }
  const cognitoPhone = toCognitoPhone(phone);
  try {
    const out = await cognito.send(
      new AdminInitiateAuthCommand({
        UserPoolId: USER_POOL_ID,
        ClientId: process.env.USER_POOL_CLIENT_ID || '',
        AuthFlow: AuthFlowType.CUSTOM_AUTH,
        AuthParameters: { USERNAME: cognitoPhone },
      })
    );
    const session = out.Session;
    const challengeName = out.ChallengeName ?? '';
    if (session && String(challengeName) === 'CUSTOM_CHALLENGE') {
      return { session, challengeName };
    }
    logger.warn('Unexpected Cognito response', { challengeName: out.ChallengeName });
    return null;
  } catch (e) {
    logger.error('AdminInitiateAuth failed', { phone: cognitoPhone, error: String(e) });
    return null;
  }
}

/**
 * Verify OTP and complete CUSTOM_CHALLENGE. Returns true if successful.
 */
export async function respondToCognitoAuth(phone: string, session: string, otp: string): Promise<boolean> {
  if (!USER_POOL_ID) return false;
  const cognitoPhone = toCognitoPhone(phone);
  const otpClean = String(otp || '').replace(/\D/g, '').slice(0, 6);
  if (!otpClean) return false;
  try {
    await cognito.send(
      new AdminRespondToAuthChallengeCommand({
        UserPoolId: USER_POOL_ID,
        ClientId: process.env.USER_POOL_CLIENT_ID || '',
        ChallengeName: ChallengeNameType.CUSTOM_CHALLENGE,
        Session: session,
        ChallengeResponses: {
          USERNAME: cognitoPhone,
          ANSWER: otpClean,
        },
      })
    );
    return true;
  } catch (e) {
    logger.warn('AdminRespondToAuthChallenge failed', { phone: cognitoPhone, error: String(e) });
    return false;
  }
}

/** Check if the message looks like a 10-digit Indian phone number. */
export function looksLikePhone(text: string): boolean {
  const digits = text.replace(/\D/g, '');
  return digits.length === 10 && /^[6-9]/.test(digits);
}

/** Check if the message looks like a 6-digit OTP. */
export function looksLikeOtp(text: string): boolean {
  return /^\d{6}$/.test(text.trim());
}
