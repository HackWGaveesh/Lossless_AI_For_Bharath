// ──────────────────────────────────────────────────────────────
// POST /verify/income-certificate — Income Certificate KYC
// Multi-layer: Date/Authority → OCR → Tampering Detection → AI
// ──────────────────────────────────────────────────────────────

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { extractIncomeCertData } from '../../services/textractService.js';
import { analyzeFraud } from '../../services/fraudAIService.js';
import { hashDocument, generateVerificationId, fuzzyMatchScore } from '../../utils/masking.js';
import { recordAttempt, getAttemptCount, isMultipleAttempts, isDuplicateSubmission, getIPRiskScore } from '../../utils/attempt-tracker.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { parseJsonBody, getUserIdFromEvent } from '../../utils/user-id.js';
import { logger } from '../../utils/logger.js';
import type { IncomeCertVerifyRequest, VerificationResult, FraudSignals } from '../../types/kyc.js';

const s3 = new S3Client({ region: process.env.REGION || 'ap-south-1' });

// ── Date Validation ──────────────────────────────────────────

function validateCertificateDate(dateStr?: string): { isValid: boolean; error?: string } {
    if (!dateStr) return { isValid: false, error: 'No date found' };

    // Try parsing common date formats
    const datePatterns = [
        /(\d{2})[\/\-](\d{2})[\/\-](\d{4})/, // DD/MM/YYYY or DD-MM-YYYY
        /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/, // YYYY-MM-DD
    ];

    for (const pattern of datePatterns) {
        const match = dateStr.match(pattern);
        if (match) {
            const year = match[3]?.length === 4 ? parseInt(match[3]) : parseInt(match[1]);
            const now = new Date();
            const currentYear = now.getFullYear();

            // Certificate should not be from the future
            if (year > currentYear) {
                return { isValid: false, error: 'Certificate date is in the future' };
            }

            // Certificate should not be too old (> 3 years for income cert)
            if (year < currentYear - 3) {
                return { isValid: false, error: 'Certificate is more than 3 years old' };
            }

            return { isValid: true };
        }
    }

    return { isValid: false, error: 'Could not parse date format' };
}

// ── Authority Validation ─────────────────────────────────────

function validateIssuingAuthority(authority?: string): { isValid: boolean; recognized: boolean } {
    if (!authority) return { isValid: false, recognized: false };

    const knownAuthorities = [
        'tahsildar', 'collector', 'revenue', 'mandal revenue officer',
        'mro', 'sub-divisional magistrate', 'sdm', 'district magistrate',
        'block development officer', 'bdo', 'taluk', 'tehsildar',
        'revenue divisional officer', 'rdo', 'district collector',
        'mamlatdar', 'naib tehsildar', 'circle officer',
    ];

    const normalized = authority.toLowerCase().trim();
    const recognized = knownAuthorities.some((auth) => normalized.includes(auth));

    return { isValid: !!authority.trim(), recognized };
}

export const handler: APIGatewayProxyHandler = async (event) => {
    const startTime = Date.now();
    const verificationId = generateVerificationId();

    try {
        const body = parseJsonBody(event) as unknown as IncomeCertVerifyRequest;
        const userId = getUserIdFromEvent(event, body as any) ?? body.userId ?? 'anonymous';

        const { name, expectedIncome, documentImage, deviceFingerprint, ipAddress } = body;

        if (!name || !documentImage) {
            return sendErrorResponse(400, 'Missing required fields: name, documentImage');
        }

        logger.info('Income certificate verification started', { verificationId, userId });

        // ── Step 1: Duplicate & Rate Check ─────────────────────
        const docHash = hashDocument(documentImage);
        const duplicateSubmission = isDuplicateSubmission(docHash, userId);
        const multipleAttempts = isMultipleAttempts(userId, 'INCOME_CERTIFICATE');
        const attemptCount = getAttemptCount(userId, 'INCOME_CERTIFICATE');

        // ── Step 2: Upload to S3 ───────────────────────────────
        const imageBytes = Buffer.from(documentImage, 'base64');
        const s3Key = `kyc/income-cert/${userId}/${verificationId}.enc`;

        try {
            await s3.send(new PutObjectCommand({
                Bucket: process.env.DOCUMENTS_BUCKET,
                Key: s3Key,
                Body: imageBytes,
                ContentType: 'image/jpeg',
                ServerSideEncryption: 'aws:kms',
                Metadata: { verificationId, userId, documentType: 'INCOME_CERTIFICATE' },
            }));
        } catch (s3Err) {
            logger.warn('S3 upload failed, continuing with in-memory processing', { s3Err });
        }

        // ── Step 3: Textract OCR ───────────────────────────────
        const ocrData = await extractIncomeCertData(new Uint8Array(imageBytes));
        logger.info('Income cert OCR extraction complete', {
            verificationId,
            nameFound: !!ocrData.name,
            incomeFound: !!ocrData.incomeAmount,
            authorityFound: !!ocrData.issuingAuthority,
            dateFound: !!ocrData.dateIssued,
            confidence: ocrData.confidence,
        });

        // ── Step 4: Structural Validation ──────────────────────
        const dateValidation = validateCertificateDate(ocrData.dateIssued);
        const authorityValidation = validateIssuingAuthority(ocrData.issuingAuthority);
        const structuralValid = dateValidation.isValid && authorityValidation.isValid;

        // ── Step 5: OCR Match Scoring ──────────────────────────
        const nameMatch = fuzzyMatchScore(name, ocrData.name ?? '');
        let incomeMatch = 50; // neutral
        if (expectedIncome && ocrData.incomeAmount) {
            const expectedDigits = expectedIncome.replace(/[^0-9]/g, '');
            const extractedDigits = ocrData.incomeAmount.replace(/[^0-9]/g, '');
            incomeMatch = expectedDigits === extractedDigits ? 100 : fuzzyMatchScore(expectedDigits, extractedDigits);
        }

        const ocrMatchScore = Math.round(
            (nameMatch * 0.5) + (incomeMatch * 0.3) + (ocrData.confidence > 60 ? 20 : 0)
        );

        // ── Step 6: Tampering Detection Heuristics ─────────────
        const rawLines = ocrData.rawText.split('\n').filter(Boolean);
        const hasOfficialSeals = ocrData.rawText.toLowerCase().includes('seal') ||
            ocrData.rawText.toLowerCase().includes('stamp') ||
            ocrData.rawText.toLowerCase().includes('signed') ||
            ocrData.rawText.toLowerCase().includes('signature');
        const hasCertificateNumber = !!ocrData.certificateNumber;
        const hasMinimumContent = rawLines.length >= 5;
        const layoutScore = (hasOfficialSeals ? 30 : 0) + (hasCertificateNumber ? 25 : 0) +
            (hasMinimumContent ? 25 : 0) + (authorityValidation.recognized ? 20 : 0);

        // ── Step 7: Build Fraud Signals ────────────────────────
        const fraudSignals: FraudSignals = {
            documentType: 'INCOME_CERTIFICATE',
            checksumValid: structuralValid,
            ocrMatchScore,
            suspiciousPatterns: ocrData.confidence < 40 || !hasOfficialSeals || !authorityValidation.recognized,
            multipleAttempts,
            attemptCount,
            duplicateSubmission,
            ipRiskScore: getIPRiskScore(ipAddress),
            deviceFingerprint,
            textConsistency: ocrData.confidence,
            layoutConsistency: layoutScore,
            fontConsistency: ocrData.confidence > 50 ? 75 : 30,
            metadataFlags: [
                ...(!dateValidation.isValid ? [`DATE_ISSUE: ${dateValidation.error}`] : []),
                ...(!authorityValidation.isValid ? ['NO_ISSUING_AUTHORITY'] : []),
                ...(!authorityValidation.recognized ? ['UNRECOGNIZED_AUTHORITY'] : []),
                ...(!hasOfficialSeals ? ['NO_OFFICIAL_SEAL_DETECTED'] : []),
                ...(!hasCertificateNumber ? ['NO_CERTIFICATE_NUMBER'] : []),
                ...(duplicateSubmission ? ['DUPLICATE_DOCUMENT'] : []),
            ],
        };

        // ── Step 8: Fraud AI Analysis ──────────────────────────
        const fraudResult = await analyzeFraud(fraudSignals);

        // ── Step 9: Determine Status ───────────────────────────
        let status: 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW' = 'VERIFIED';
        if (fraudResult.riskLevel === 'HIGH') {
            status = 'REJECTED';
        } else if (fraudResult.riskLevel === 'MEDIUM' || !structuralValid) {
            status = 'MANUAL_REVIEW';
        }

        // ── Step 10: Record Attempt ────────────────────────────
        recordAttempt({
            userId,
            documentType: 'INCOME_CERTIFICATE',
            timestamp: new Date().toISOString(),
            ipAddress,
            deviceFingerprint,
            documentHash: docHash,
            result: status,
        });

        // ── Build Response ─────────────────────────────────────
        const result: VerificationResult = {
            documentType: 'INCOME_CERTIFICATE',
            verificationId,
            status,
            structuralValidation: structuralValid,
            ocrMatchScore,
            fraudProbability: fraudResult.fraudProbability,
            riskLevel: fraudResult.riskLevel,
            confidenceScore: fraudResult.confidenceScore,
            maskedId: ocrData.certificateNumber ?? 'N/A',
            extractedData: {
                name: ocrData.name,
                incomeAmount: ocrData.incomeAmount,
                issuingAuthority: ocrData.issuingAuthority,
                dateIssued: ocrData.dateIssued,
                certificateNumber: ocrData.certificateNumber,
                authorityRecognized: authorityValidation.recognized,
                dateValid: dateValidation.isValid,
                dateError: dateValidation.error,
                ocrConfidence: ocrData.confidence,
                nameMatchScore: nameMatch,
                layoutScore,
                hasOfficialSeals,
            },
            fraudAnalysis: fraudResult,
            timestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - startTime,
        };

        logger.info('Income certificate verification complete', {
            verificationId,
            status,
            riskLevel: fraudResult.riskLevel,
            processingTimeMs: result.processingTimeMs,
        });

        return sendSuccessResponse(result);
    } catch (error: any) {
        logger.error('Income certificate verification failed', { verificationId, error: error.message });
        return sendErrorResponse(500, `Income certificate verification failed: ${error.message}`);
    }
};
