// ──────────────────────────────────────────────────────────────
// PAN Validator — Regex + Entity Type Check
// ──────────────────────────────────────────────────────────────

import type { PanValidation } from '../types/kyc.js';

// PAN format: AAAAA9999A
// [A-Z]{3} — first 3: alphabetic series AAA-ZZZ
// [A-Z]{1} — 4th char: entity type
// [A-Z]{1} — 5th char: first letter of surname/name
// [0-9]{4} — sequential 0001-9999
// [A-Z]{1} — last: check letter

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const ENTITY_TYPE_MAP: Record<string, string> = {
    A: 'Association of Persons (AOP)',
    B: 'Body of Individuals (BOI)',
    C: 'Company',
    F: 'Firm / LLP',
    G: 'Government',
    H: 'Hindu Undivided Family (HUF)',
    J: 'Artificial Juridical Person',
    L: 'Local Authority',
    P: 'Individual / Person',
    T: 'Trust (AOP)',
};

export function validatePan(
    panNumber: string,
    declaredEntityType?: string
): PanValidation {
    const errors: string[] = [];
    const cleaned = panNumber.replace(/\s/g, '').toUpperCase();

    const matchesRegex = PAN_REGEX.test(cleaned);
    if (!matchesRegex) errors.push('PAN does not match expected format AAAAA9999A');

    const fourthChar = cleaned.length >= 4 ? cleaned[3] : '';
    const entityType = fourthChar;
    const entityTypeLabel = ENTITY_TYPE_MAP[fourthChar] ?? 'Unknown';

    if (!ENTITY_TYPE_MAP[fourthChar]) {
        errors.push(`Invalid entity type character: ${fourthChar}`);
    }

    let declaredTypeMismatch = false;
    if (declaredEntityType) {
        const normalised = declaredEntityType.toUpperCase().trim();
        // Check if declared type matches PAN entity type
        if (normalised === 'INDIVIDUAL' || normalised === 'PERSON') {
            declaredTypeMismatch = fourthChar !== 'P';
        } else if (normalised === 'COMPANY') {
            declaredTypeMismatch = fourthChar !== 'C';
        } else if (normalised === 'FIRM' || normalised === 'LLP') {
            declaredTypeMismatch = fourthChar !== 'F';
        } else if (normalised === 'HUF') {
            declaredTypeMismatch = fourthChar !== 'H';
        } else if (normalised === 'TRUST') {
            declaredTypeMismatch = fourthChar !== 'T';
        } else if (normalised === 'GOVERNMENT') {
            declaredTypeMismatch = fourthChar !== 'G';
        }

        if (declaredTypeMismatch) {
            errors.push(
                `Declared entity type "${declaredEntityType}" does not match PAN entity type "${entityTypeLabel}"`
            );
        }
    }

    const isValid = matchesRegex && !declaredTypeMismatch && !!ENTITY_TYPE_MAP[fourthChar];

    return {
        isValid,
        matchesRegex,
        entityType,
        entityTypeLabel,
        declaredTypeMismatch,
        errors,
    };
}

/** Validate IFSC code format: 4 letters + 0 + 6 alphanumeric */
export function validateIFSC(ifsc: string): { isValid: boolean; error?: string } {
    const cleaned = ifsc.replace(/\s/g, '').toUpperCase();
    const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!IFSC_REGEX.test(cleaned)) {
        return { isValid: false, error: 'IFSC code must be 4 letters + 0 + 6 alphanumeric characters' };
    }
    return { isValid: true };
}

/** Validate account number format (basic: 9-18 digits) */
export function validateAccountNumber(accountNumber: string): { isValid: boolean; error?: string } {
    const digits = accountNumber.replace(/[\s-]/g, '');
    if (!/^\d{9,18}$/.test(digits)) {
        return { isValid: false, error: 'Account number must be 9-18 digits' };
    }
    return { isValid: true };
}
