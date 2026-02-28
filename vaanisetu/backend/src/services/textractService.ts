// ──────────────────────────────────────────────────────────────
// Textract Service — OCR extraction for all document types
// Uses Amazon Textract AnalyzeDocument with FORMS + TABLES
// ──────────────────────────────────────────────────────────────

import {
    TextractClient,
    AnalyzeDocumentCommand,
    DetectDocumentTextCommand,
    type Block,
} from '@aws-sdk/client-textract';
import type {
    AadhaarOcrData,
    PanOcrData,
    PassbookOcrData,
    IncomeCertOcrData,
} from '../types/kyc.js';
import { logger } from '../utils/logger.js';

const textract = new TextractClient({ region: process.env.REGION || 'ap-south-1' });

// ── Helpers ──────────────────────────────────────────────────

function extractRawText(blocks: Block[]): string {
    return blocks
        .filter((b) => b.BlockType === 'LINE')
        .map((b) => b.Text ?? '')
        .join('\n');
}

function extractKeyValuePairs(blocks: Block[]): Map<string, string> {
    const keyMap = new Map<string, Block>();
    const valueMap = new Map<string, Block>();
    const blockMap = new Map<string, Block>();

    for (const block of blocks) {
        blockMap.set(block.Id ?? '', block);
        if (block.BlockType === 'KEY_VALUE_SET') {
            if (block.EntityTypes?.includes('KEY')) {
                keyMap.set(block.Id!, block);
            } else if (block.EntityTypes?.includes('VALUE')) {
                valueMap.set(block.Id!, block);
            }
        }
    }

    const kvPairs = new Map<string, string>();

    for (const [, keyBlock] of keyMap) {
        const keyText = getTextFromRelationships(keyBlock, blockMap, 'CHILD');
        let valueText = '';

        const valueRels = keyBlock.Relationships?.find((r) => r.Type === 'VALUE');
        if (valueRels?.Ids) {
            for (const vid of valueRels.Ids) {
                const vBlock = blockMap.get(vid);
                if (vBlock) {
                    valueText += getTextFromRelationships(vBlock, blockMap, 'CHILD');
                }
            }
        }

        if (keyText.trim()) {
            kvPairs.set(keyText.trim().toLowerCase(), valueText.trim());
        }
    }

    return kvPairs;
}

function getTextFromRelationships(
    block: Block,
    blockMap: Map<string, Block>,
    relType: string
): string {
    const rel = block.Relationships?.find((r) => r.Type === relType);
    if (!rel?.Ids) return block.Text ?? '';

    return rel.Ids.map((id) => blockMap.get(id)?.Text ?? '').join(' ');
}

function getAverageConfidence(blocks: Block[]): number {
    const confidences = blocks
        .filter((b) => b.BlockType === 'LINE' && b.Confidence != null)
        .map((b) => b.Confidence!);
    if (confidences.length === 0) return 0;
    return Math.round(
        confidences.reduce((a, b) => a + b, 0) / confidences.length
    );
}

// ── Aadhaar OCR ──────────────────────────────────────────────

export async function extractAadhaarData(imageBytes: Uint8Array): Promise<AadhaarOcrData> {
    logger.info('Textract: Extracting Aadhaar data');

    try {
        const response = await textract.send(
            new AnalyzeDocumentCommand({
                Document: { Bytes: imageBytes },
                FeatureTypes: ['FORMS', 'TABLES'],
            })
        );

        const blocks = response.Blocks ?? [];
        const rawText = extractRawText(blocks);
        const kvPairs = extractKeyValuePairs(blocks);
        const confidence = getAverageConfidence(blocks);

        // Extract fields from OCR
        const aadhaarMatch = rawText.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
        const dobMatch = rawText.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
        const genderMatch = rawText.match(/\b(Male|Female|MALE|FEMALE|पुरुष|महिला|Transgender)\b/i);

        // Try to find name — usually the line after "Government of India"
        let name: string | undefined;
        const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes('government of india') || lines[i].toLowerCase().includes('भारत सरकार')) {
                // Name is typically 1-2 lines below
                if (i + 1 < lines.length && !lines[i + 1].match(/\d/) && lines[i + 1].length > 2) {
                    name = lines[i + 1];
                }
                break;
            }
        }

        // Also check KV pairs
        name = name || kvPairs.get('name') || kvPairs.get('नाम');
        const dob = dobMatch?.[1] || kvPairs.get('dob') || kvPairs.get('date of birth') || kvPairs.get('जन्म तिथि');

        return {
            name,
            dateOfBirth: dob,
            aadhaarNumber: aadhaarMatch?.[0]?.replace(/\s/g, ''),
            gender: genderMatch?.[0],
            rawText,
            confidence,
        };
    } catch (error) {
        logger.error('Textract Aadhaar extraction failed', { error });
        return {
            rawText: '',
            confidence: 0,
        };
    }
}

// ── PAN OCR ──────────────────────────────────────────────────

export async function extractPanData(imageBytes: Uint8Array): Promise<PanOcrData> {
    logger.info('Textract: Extracting PAN data');

    try {
        const response = await textract.send(
            new AnalyzeDocumentCommand({
                Document: { Bytes: imageBytes },
                FeatureTypes: ['FORMS'],
            })
        );

        const blocks = response.Blocks ?? [];
        const rawText = extractRawText(blocks);
        const kvPairs = extractKeyValuePairs(blocks);
        const confidence = getAverageConfidence(blocks);

        const panMatch = rawText.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
        const dobMatch = rawText.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);

        // Find name — usually after "Name" label or "Permanent Account Number" header
        let name: string | undefined = kvPairs.get('name') || kvPairs.get("father's name");
        let fatherName: string | undefined = kvPairs.get("father's name");

        const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].toLowerCase();
            if (line.includes('name') && i + 1 < lines.length) {
                if (!name) name = lines[i + 1];
                else if (!fatherName && line.includes('father')) fatherName = lines[i + 1];
            }
        }

        return {
            panNumber: panMatch?.[0],
            name,
            fatherName,
            dateOfBirth: dobMatch?.[1] || kvPairs.get('date of birth'),
            rawText,
            confidence,
        };
    } catch (error) {
        logger.error('Textract PAN extraction failed', { error });
        return { rawText: '', confidence: 0 };
    }
}

// ── Passbook OCR ─────────────────────────────────────────────

export async function extractPassbookData(imageBytes: Uint8Array): Promise<PassbookOcrData> {
    logger.info('Textract: Extracting Passbook data');

    try {
        const response = await textract.send(
            new AnalyzeDocumentCommand({
                Document: { Bytes: imageBytes },
                FeatureTypes: ['FORMS', 'TABLES'],
            })
        );

        const blocks = response.Blocks ?? [];
        const rawText = extractRawText(blocks);
        const kvPairs = extractKeyValuePairs(blocks);
        const confidence = getAverageConfidence(blocks);

        const ifscMatch = rawText.match(/\b[A-Z]{4}0[A-Z0-9]{6}\b/);
        const accountMatch = rawText.match(/\b\d{9,18}\b/);

        // Detect bank name from common patterns
        const bankPatterns = [
            'STATE BANK', 'SBI', 'ICICI', 'HDFC', 'AXIS', 'PNB', 'BOB', 'CANARA',
            'UNION BANK', 'INDIAN BANK', 'BANK OF INDIA', 'KOTAK', 'YES BANK',
            'IDBI', 'CENTRAL BANK', 'UCO BANK', 'INDIAN OVERSEAS',
        ];
        let bankName: string | undefined = kvPairs.get('bank') || kvPairs.get('bank name');
        if (!bankName) {
            for (const pattern of bankPatterns) {
                if (rawText.toUpperCase().includes(pattern)) {
                    bankName = pattern;
                    break;
                }
            }
        }

        return {
            accountHolderName:
                kvPairs.get('account holder') || kvPairs.get('name') || kvPairs.get('account holder name'),
            accountNumber: kvPairs.get('account number') || kvPairs.get('a/c no') || accountMatch?.[0],
            ifscCode: kvPairs.get('ifsc') || kvPairs.get('ifsc code') || ifscMatch?.[0],
            bankName,
            branchName: kvPairs.get('branch') || kvPairs.get('branch name'),
            rawText,
            confidence,
        };
    } catch (error) {
        logger.error('Textract Passbook extraction failed', { error });
        return { rawText: '', confidence: 0 };
    }
}

// ── Income Certificate OCR ───────────────────────────────────

export async function extractIncomeCertData(imageBytes: Uint8Array): Promise<IncomeCertOcrData> {
    logger.info('Textract: Extracting Income Certificate data');

    try {
        const response = await textract.send(
            new AnalyzeDocumentCommand({
                Document: { Bytes: imageBytes },
                FeatureTypes: ['FORMS', 'TABLES'],
            })
        );

        const blocks = response.Blocks ?? [];
        const rawText = extractRawText(blocks);
        const kvPairs = extractKeyValuePairs(blocks);
        const confidence = getAverageConfidence(blocks);

        // Income amount extraction — look for currency patterns
        const incomeMatch = rawText.match(/₹?\s*[\d,]+(?:\.\d{2})?/);
        const dateMatch = rawText.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
        const certNoMatch = rawText.match(/\b(?:No|Sl\.?\s*No|Certificate\s*No)[.:\s]*([A-Z0-9\-\/]+)/i);

        // Detect issuing authority
        const authorityPatterns = [
            'Tahsildar', 'Collector', 'Revenue', 'Mandal Revenue Officer',
            'MRO', 'Sub-Divisional Magistrate', 'SDM', 'District Magistrate',
            'Block Development Officer', 'BDO', 'Taluk', 'Tehsildar',
        ];
        let authority: string | undefined;
        for (const pat of authorityPatterns) {
            if (rawText.toLowerCase().includes(pat.toLowerCase())) {
                authority = pat;
                break;
            }
        }

        return {
            name: kvPairs.get('name') || kvPairs.get('name of the applicant'),
            incomeAmount: kvPairs.get('income') || kvPairs.get('annual income') || incomeMatch?.[0],
            issuingAuthority: kvPairs.get('issuing authority') || authority,
            dateIssued: kvPairs.get('date') || kvPairs.get('date of issue') || dateMatch?.[1],
            certificateNumber: kvPairs.get('certificate no') || certNoMatch?.[1],
            rawText,
            confidence,
        };
    } catch (error) {
        logger.error('Textract Income Cert extraction failed', { error });
        return { rawText: '', confidence: 0 };
    }
}
