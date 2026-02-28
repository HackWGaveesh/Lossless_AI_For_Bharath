// ──────────────────────────────────────────────────────────────
// Aadhaar Validator — Structural + Verhoeff Checksum
// ──────────────────────────────────────────────────────────────

import type { AadhaarValidation } from '../types/kyc.js';

// Verhoeff tables
const d = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const p = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

function verhoeffChecksum(num: string): boolean {
    let c = 0;
    const digits = num.split('').map(Number).reverse();
    for (let i = 0; i < digits.length; i++) {
        c = d[c][p[i % 8][digits[i]]];
    }
    return c === 0;
}

function hasRepeatedDigits(num: string): boolean {
    // All same digits: 111111111111
    return /^(.)\1{11}$/.test(num);
}

function hasSequentialDigits(num: string): boolean {
    const ascending = '012345678901';
    const descending = '987654321098';
    return ascending.includes(num) || descending.includes(num);
}

export function validateAadhaar(aadhaarNumber: string): AadhaarValidation {
    const errors: string[] = [];
    const digits = aadhaarNumber.replace(/[\s-]/g, '');

    const isNumeric = /^\d+$/.test(digits);
    if (!isNumeric) errors.push('Aadhaar must contain only digits');

    const isCorrectLength = digits.length === 12;
    if (!isCorrectLength) errors.push('Aadhaar must be exactly 12 digits');

    const hasNoRepeatedDigits = !hasRepeatedDigits(digits);
    if (!hasNoRepeatedDigits) errors.push('Aadhaar cannot have all repeated digits');

    const hasNoSequentialDigits = !hasSequentialDigits(digits);
    if (!hasNoSequentialDigits) errors.push('Aadhaar cannot be a sequential number');

    // First digit cannot be 0 or 1
    if (digits.length >= 1 && (digits[0] === '0' || digits[0] === '1')) {
        errors.push('Aadhaar cannot start with 0 or 1');
    }

    let verhoeffValid = false;
    if (isNumeric && isCorrectLength) {
        verhoeffValid = verhoeffChecksum(digits);
        if (!verhoeffValid) errors.push('Aadhaar failed Verhoeff checksum validation');
    }

    const isValid =
        isNumeric &&
        isCorrectLength &&
        hasNoRepeatedDigits &&
        hasNoSequentialDigits &&
        verhoeffValid &&
        digits[0] !== '0' &&
        digits[0] !== '1';

    return {
        isValid,
        isNumeric,
        isCorrectLength,
        hasNoRepeatedDigits,
        hasNoSequentialDigits,
        verhoeffValid,
        errors,
    };
}
