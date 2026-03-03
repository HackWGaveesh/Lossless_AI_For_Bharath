/**
 * VaaniSetu Session Service
 *
 * Persists voice conversation context to DynamoDB with a 30-minute TTL.
 * Survives Lambda cold starts and multiple devices.
 *
 * Table: vaanisetu-sessions (auto-created key schema: session_id PK)
 * Falls back gracefully when DynamoDB is unavailable (dev/local).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger.js';
import type { AssistantStateData } from './assistant-state-machine.js';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION || 'ap-south-1' })
);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'vaanisetu-sessions';
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 1800); // 30 min
const SESSION_SORT_KEY = 0;

export interface SessionTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface SessionData {
  sessionId: string;
  userId: string;
  turns: SessionTurn[];
  pendingConfirmation?: Record<string, any> | null;
  assistantState?: AssistantStateData | null;
  lastActiveAt: number;
  ttl: number;
}

/**
 * Load session from DynamoDB.
 * Returns an empty session shell on miss or error.
 */
export async function loadSession(sessionId: string, userId: string): Promise<SessionData> {
  try {
    const res = await ddb.send(
      new GetCommand({ TableName: SESSIONS_TABLE, Key: { session_id: sessionId, timestamp: SESSION_SORT_KEY } })
    );
    if (res.Item) {
      const item = res.Item as any;
      return {
        sessionId,
        userId: item.user_id ?? userId,
        turns: Array.isArray(item.turns) ? item.turns : [],
        pendingConfirmation: item.pending_confirmation ?? null,
        assistantState: item.assistant_state ?? null,
        lastActiveAt: item.last_active_at ?? Date.now(),
        ttl: item.ttl ?? (Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS),
      };
    }

    const fallback = await ddb.send(
      new QueryCommand({
        TableName: SESSIONS_TABLE,
        KeyConditionExpression: 'session_id = :sid',
        ExpressionAttributeValues: { ':sid': sessionId },
        ScanIndexForward: false,
        Limit: 1,
      })
    );
    const latest = Array.isArray(fallback.Items) ? fallback.Items[0] : null;
    if (latest) {
      return {
        sessionId,
        userId: latest.user_id ?? userId,
        turns: Array.isArray(latest.turns) ? latest.turns : [],
        pendingConfirmation: latest.pending_confirmation ?? null,
        assistantState: latest.assistant_state ?? null,
        lastActiveAt: latest.last_active_at ?? Date.now(),
        ttl: latest.ttl ?? (Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS),
      };
    }
  } catch (err: any) {
    logger.warn('Session load failed (non-fatal)', { sessionId, error: err?.message });
  }
  return emptySession(sessionId, userId);
}

/**
 * Append a new turn and save back to DynamoDB.
 * Retains only the last 20 turns to control item size.
 */
export async function appendTurn(
  session: SessionData,
  userText: string,
  assistantText: string,
  pendingConfirmation?: Record<string, any> | null,
  assistantState?: AssistantStateData | null,
): Promise<SessionData> {
  const now = Date.now();
  const newTurns: SessionTurn[] = [
    ...session.turns,
    { role: 'user' as const, content: userText, timestamp: now },
    { role: 'assistant' as const, content: assistantText, timestamp: now },
  ].slice(-20); // keep last 20 turns (10 exchanges)

  const updated: SessionData = {
    ...session,
    turns: newTurns,
    pendingConfirmation: pendingConfirmation === undefined ? session.pendingConfirmation : pendingConfirmation,
    assistantState: assistantState === undefined ? session.assistantState : assistantState,
    lastActiveAt: now,
    ttl: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: SESSIONS_TABLE,
        Item: {
          session_id: session.sessionId,
          timestamp: SESSION_SORT_KEY,
          user_id: session.userId,
          turns: newTurns,
          pending_confirmation: updated.pendingConfirmation ?? null,
          assistant_state: updated.assistantState ?? null,
          last_active_at: now,
          ttl: updated.ttl,
        },
      })
    );
  } catch (err: any) {
    logger.warn('Session save failed (non-fatal)', { sessionId: session.sessionId, error: err?.message });
  }

  return updated;
}

/**
 * Clear the pending confirmation from a session (after confirm/cancel).
 */
export async function clearPendingConfirmation(session: SessionData): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: SESSIONS_TABLE,
        Item: {
          session_id: session.sessionId,
          timestamp: SESSION_SORT_KEY,
          user_id: session.userId,
          turns: session.turns,
          pending_confirmation: null,
          assistant_state: session.assistantState ?? null,
          last_active_at: Date.now(),
          ttl: session.ttl,
        },
      })
    );
  } catch (err: any) {
    logger.warn('Session clearPending failed (non-fatal)', { error: err?.message });
  }
}

function emptySession(sessionId: string, userId: string): SessionData {
  return {
    sessionId,
    userId,
    turns: [],
    pendingConfirmation: null,
    assistantState: null,
    lastActiveAt: Date.now(),
    ttl: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
}
