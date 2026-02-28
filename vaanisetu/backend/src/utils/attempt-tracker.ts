// ──────────────────────────────────────────────────────────────
// Attempt Tracker — In-memory fraud tracking for repeat attempts
// In production, back this with DynamoDB or Redis
// ──────────────────────────────────────────────────────────────

import type { AttemptRecord, DocumentType } from '../types/kyc.js';
import { logger } from './logger.js';

const MAX_ATTEMPTS_PER_HOUR = 5;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory stores (replace with DynamoDB in production)
const attemptsByUser = new Map<string, AttemptRecord[]>();
const documentHashes = new Map<string, { userId: string; timestamp: string }>();

export function recordAttempt(record: AttemptRecord): void {
    const key = `${record.userId}:${record.documentType}`;
    const existing = attemptsByUser.get(key) ?? [];
    existing.push(record);
    attemptsByUser.set(key, existing);

    // Track document hash for duplicate detection
    if (record.documentHash) {
        documentHashes.set(record.documentHash, {
            userId: record.userId,
            timestamp: record.timestamp,
        });
    }

    logger.info('KYC attempt recorded', {
        userId: record.userId,
        documentType: record.documentType,
        totalAttempts: existing.length,
    });
}

export function getAttemptCount(userId: string, documentType: DocumentType): number {
    const key = `${userId}:${documentType}`;
    const records = attemptsByUser.get(key) ?? [];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return records.filter((r) => new Date(r.timestamp).getTime() > oneHourAgo).length;
}

export function isMultipleAttempts(userId: string, documentType: DocumentType): boolean {
    return getAttemptCount(userId, documentType) >= MAX_ATTEMPTS_PER_HOUR;
}

export function isDuplicateSubmission(documentHash: string, userId: string): boolean {
    const existing = documentHashes.get(documentHash);
    if (!existing) return false;

    const withinWindow =
        Date.now() - new Date(existing.timestamp).getTime() < DUPLICATE_WINDOW_MS;

    // Same user re-submitting same doc within 24h
    return existing.userId === userId && withinWindow;
}

export function getIPRiskScore(ipAddress?: string): number {
    // Placeholder — in production, integrate with IP reputation API
    // (MaxMind, IPQualityScore, etc.)
    if (!ipAddress) return 10;

    // Flag localhost / private IPs as low risk
    if (
        ipAddress.startsWith('127.') ||
        ipAddress.startsWith('192.168.') ||
        ipAddress.startsWith('10.') ||
        ipAddress === '::1'
    ) {
        return 5;
    }

    // Default moderate risk for unknown IPs
    return 20;
}
