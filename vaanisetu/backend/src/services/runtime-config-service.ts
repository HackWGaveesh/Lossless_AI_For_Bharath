import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger.js';

export type BudgetMode = 'normal' | 'guarded' | 'strict';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION || 'ap-south-1' })
);

const RUNTIME_CONFIG_TABLE = process.env.RUNTIME_CONFIG_TABLE || '';
const CACHE_TTL_MS = Number(process.env.RUNTIME_CONFIG_CACHE_MS || 30000);

const MODE_RANK: Record<BudgetMode, number> = {
  normal: 0,
  guarded: 1,
  strict: 2,
};

let cachedMode: BudgetMode | null = null;
let cachedAtMs = 0;

function parseBudgetMode(value: string): BudgetMode | null {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'normal' || mode === 'guarded' || mode === 'strict') return mode;
  return null;
}

function maxBudgetMode(a: BudgetMode, b: BudgetMode): BudgetMode {
  return MODE_RANK[a] >= MODE_RANK[b] ? a : b;
}

function envBudgetMode(): BudgetMode {
  return parseBudgetMode(String(process.env.BUDGET_MODE || 'normal')) || 'normal';
}

function getMonthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function budgetConfigKey(date: Date): string {
  return `budget_mode#${getMonthKey(date)}`;
}

function endOfMonthTtl(date: Date): number {
  const nextMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0));
  nextMonth.setUTCDate(nextMonth.getUTCDate() + 3);
  return Math.floor(nextMonth.getTime() / 1000);
}

async function readRuntimeBudgetMode(date = new Date()): Promise<BudgetMode | null> {
  if (!RUNTIME_CONFIG_TABLE) return null;
  const key = budgetConfigKey(date);
  const res = await ddb.send(new GetCommand({
    TableName: RUNTIME_CONFIG_TABLE,
    Key: { config_key: key },
  }));
  return parseBudgetMode(String((res.Item as any)?.mode || ''));
}

export function resolveBudgetModeFromThreshold(threshold: number): BudgetMode {
  if (threshold >= 50) return 'strict';
  if (threshold >= 35) return 'guarded';
  return 'normal';
}

export function parseBudgetThresholdFromMessage(message: string): number | null {
  const raw = String(message || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, any>;
    const candidates = [
      parsed.threshold,
      parsed.alertThreshold,
      parsed.newThreshold,
      parsed.Threshold,
      parsed.NewThreshold,
      parsed?.detail?.threshold,
    ]
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (candidates.length) return Math.max(...candidates);
  } catch {
    // not json
  }

  const regexes = [
    /threshold\s+of\s+(?:USD|\$)\s*([0-9]+(?:\.[0-9]+)?)/i,
    /threshold\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i,
    /(?:USD|\$)\s*([0-9]+(?:\.[0-9]+)?)\s*threshold/i,
  ];
  for (const rx of regexes) {
    const m = raw.match(rx);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  const fallback = raw.match(/\b(35|45|50)(?:\.0+)?\b/g);
  if (fallback?.length) {
    const values = fallback.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (values.length) return Math.max(...values);
  }

  return null;
}

export async function setRuntimeBudgetMode(mode: BudgetMode, details?: Record<string, unknown>): Promise<void> {
  if (!RUNTIME_CONFIG_TABLE) return;
  const now = new Date();
  const key = budgetConfigKey(now);

  try {
    const current = await readRuntimeBudgetMode(now);
    const effective = current ? maxBudgetMode(current, mode) : mode;

    await ddb.send(new PutCommand({
      TableName: RUNTIME_CONFIG_TABLE,
      Item: {
        config_key: key,
        mode: effective,
        updated_at: now.toISOString(),
        source: String(details?.source || 'runtime'),
        threshold: typeof details?.threshold === 'number' ? details.threshold : null,
        ttl: endOfMonthTtl(now),
      },
    }));

    cachedMode = effective;
    cachedAtMs = Date.now();
  } catch (err: any) {
    logger.warn('setRuntimeBudgetMode failed', { error: err?.message || String(err) });
  }
}

export async function getRuntimeBudgetMode(forceRefresh = false): Promise<BudgetMode> {
  const baseline = envBudgetMode();
  if (!RUNTIME_CONFIG_TABLE) return baseline;

  const nowMs = Date.now();
  if (!forceRefresh && cachedMode && nowMs - cachedAtMs < CACHE_TTL_MS) {
    return maxBudgetMode(baseline, cachedMode);
  }

  try {
    const fromTable = await readRuntimeBudgetMode(new Date());
    const mode = fromTable ? maxBudgetMode(baseline, fromTable) : baseline;
    cachedMode = mode;
    cachedAtMs = nowMs;
    return mode;
  } catch (err: any) {
    logger.warn('getRuntimeBudgetMode failed, using env mode', { error: err?.message || String(err) });
    return baseline;
  }
}

export async function handleBudgetSnsEvent(event: any): Promise<{ mode: BudgetMode; updated: boolean }> {
  const records = Array.isArray(event?.Records) ? event.Records : [];
  let chosenMode: BudgetMode = 'normal';
  let found = false;
  let maxThreshold = 0;

  for (const record of records) {
    const message = String(record?.Sns?.Message || '');
    const threshold = parseBudgetThresholdFromMessage(message);
    if (!threshold) continue;
    found = true;
    maxThreshold = Math.max(maxThreshold, threshold);
    chosenMode = maxBudgetMode(chosenMode, resolveBudgetModeFromThreshold(threshold));
  }

  if (!found) {
    logger.info('Budget SNS message did not include threshold; no mode update');
    return { mode: await getRuntimeBudgetMode(), updated: false };
  }

  await setRuntimeBudgetMode(chosenMode, {
    source: 'aws_budgets_sns',
    threshold: maxThreshold,
  });

  return { mode: await getRuntimeBudgetMode(true), updated: true };
}

