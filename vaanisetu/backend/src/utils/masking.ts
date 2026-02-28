// ──────────────────────────────────────────────────────────────
// Masking & Encryption Utilities
// Never store raw PII — always mask before logging / storing
// ──────────────────────────────────────────────────────────────

import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.KYC_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const IV_LENGTH = 16;

/** Mask Aadhaar: 1234 5678 9012 → XXXX-XXXX-9012 */
export function maskAadhaar(aadhaar: string): string {
    const digits = aadhaar.replace(/\D/g, '');
    if (digits.length !== 12) return 'XXXX-XXXX-XXXX';
    return `XXXX-XXXX-${digits.slice(8)}`;
}

/** Mask PAN: ABCDE1234F → ABCDE****F */
export function maskPan(pan: string): string {
    const cleaned = pan.replace(/\s/g, '').toUpperCase();
    if (cleaned.length !== 10) return '**********';
    return `${cleaned.slice(0, 5)}****${cleaned.slice(9)}`;
}

/** Mask account number: 12345678901234 → XXXXXXXXXX1234 */
export function maskAccountNumber(accountNumber: string): string {
    const digits = accountNumber.replace(/\D/g, '');
    if (digits.length < 4) return 'XXXX';
    return 'X'.repeat(digits.length - 4) + digits.slice(-4);
}

/** Generate a SHA-256 hash of a document for duplicate detection */
export function hashDocument(base64Content: string): string {
    return crypto.createHash('sha256').update(base64Content).digest('hex');
}

/** Encrypt sensitive data at rest */
export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
}

/** Decrypt sensitive data */
export function decrypt(encryptedText: string): string {
    const [ivHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/** Fuzzy string match score (0–100) using Levenshtein distance */
export function fuzzyMatchScore(a: string, b: string): number {
    if (!a || !b) return 0;
    const s1 = a.toLowerCase().trim();
    const s2 = b.toLowerCase().trim();

    if (s1 === s2) return 100;

    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);
    if (maxLen === 0) return 100;

    // Levenshtein distance
    const matrix: number[][] = Array.from({ length: len1 + 1 }, () =>
        Array(len2 + 1).fill(0)
    );

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    const distance = matrix[len1][len2];
    return Math.round(((maxLen - distance) / maxLen) * 100);
}

/** Generate a unique verification ID */
export function generateVerificationId(): string {
    return `KYC-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
