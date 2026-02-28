// ──────────────────────────────────────────────────────────────
// POST /verify/passbook — Bank Passbook KYC Verification
// Multi-layer: IFSC/Account → OCR → Layout Analysis → Fraud AI
// ──────────────────────────────────────────────────────────────

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { validateIFSC, validateAccountNumber } from '../../validators/panValidator.js';
import { extractPassbookData } from '../../services/textractService.js';
import { analyzeFraud } from '../../services/fraudAIService.js';
import { maskAccountNumber, hashDocument, generateVerificationId, fuzzyMatchScore } from '../../utils/masking.js';
import { recordAttempt, getAttemptCount, isMultipleAttempts, isDuplicateSubmission, getIPRiskScore } from '../../utils/attempt-tracker.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { parseJsonBody, getUserIdFromEvent } from '../../utils/user-id.js';
import { logger } from '../../utils/logger.js';
import type { PassbookVerifyRequest, VerificationResult, FraudSignals } from '../../types/kyc.js';

const s3 = new S3Client({ region: process.env.REGION || 'ap-south-1' });

export const handler: APIGatewayProxyHandler = async (event) => {
    const startTime = Date.now();
    const verificationId = generateVerificationId();

    try {
        const body = parseJsonBody(event) as unknown as PassbookVerifyRequest;
        const userId = getUserIdFromEvent(event, body as any) ?? body.userId ?? 'anonymous';

        const { accountHolderName, accountNumber, ifscCode, documentImage, deviceFingerprint, ipAddress } = body;

        if (!accountHolderName || !accountNumber || !ifscCode || !documentImage) {
            return sendErrorResponse(400, 'Missing required fields: accountHolderName, accountNumber, ifscCode, documentImage');
        }

        logger.info('Passbook verification started', { verificationId, userId });

        // ── Step 1: Structural Validation ──────────────────────
        const ifscValidation = validateIFSC(ifscCode);
        const accountValidation = validateAccountNumber(accountNumber);
        const structuralValid = ifscValidation.isValid && accountValidation.isValid;

        logger.info('Passbook structural validation', {
            verificationId,
            ifscValid: ifscValidation.isValid,
            accountValid: accountValidation.isValid,
        });

        // ── Step 2: Duplicate & Rate Check ─────────────────────
        const docHash = hashDocument(documentImage);
        const duplicateSubmission = isDuplicateSubmission(docHash, userId);
        const multipleAttempts = isMultipleAttempts(userId, 'BANK_PASSBOOK');
        const attemptCount = getAttemptCount(userId, 'BANK_PASSBOOK');

        // ── Step 3: Upload to S3 ───────────────────────────────
        const imageBytes = Buffer.from(documentImage, 'base64');
        const s3Key = `kyc/passbook/${userId}/${verificationId}.enc`;

        try {
            await s3.send(new PutObjectCommand({
                Bucket: process.env.DOCUMENTS_BUCKET,
                Key: s3Key,
                Body: imageBytes,
                ContentType: 'image/jpeg',
                ServerSideEncryption: 'aws:kms',
                Metadata: { verificationId, userId, documentType: 'BANK_PASSBOOK' },
            }));
        } catch (s3Err) {
            logger.warn('S3 upload failed, continuing with in-memory processing', { s3Err });
        }

        // ── Step 4: Textract OCR ───────────────────────────────
        const ocrData = await extractPassbookData(new Uint8Array(imageBytes));
        logger.info('Passbook OCR extraction complete', {
            verificationId,
            nameFound: !!ocrData.accountHolderName,
            accountFound: !!ocrData.accountNumber,
            ifscFound: !!ocrData.ifscCode,
            confidence: ocrData.confidence,
        });

        // ── Step 5: OCR Match Scoring ──────────────────────────
        const nameMatch = fuzzyMatchScore(accountHolderName, ocrData.accountHolderName ?? '');
        const accountMatch = ocrData.accountNumber
            ? (accountNumber.replace(/\D/g, '') === ocrData.accountNumber.replace(/\D/g, '') ? 100 : 0)
            : 50;
        const ifscMatch = ocrData.ifscCode
            ? (ifscCode.toUpperCase() === ocrData.ifscCode.toUpperCase() ? 100 : 0)
            : 50;

        const ocrMatchScore = Math.round(
            (nameMatch * 0.4) + (accountMatch * 0.3) + (ifscMatch * 0.3)
        );

        // ── Step 6: Layout Consistency Analysis ────────────────
        // Check if document layout matches typical passbook format
        const rawLines = ocrData.rawText.split('\n').filter(Boolean);
        const hasTableStructure = rawLines.length > 5;
        const hasBankHeader = !!(ocrData.bankName);
        const layoutScore = (hasTableStructure ? 50 : 20) + (hasBankHeader ? 30 : 0) + (ocrData.confidence > 60 ? 20 : 0);

        // ── Step 7: Build Fraud Signals ────────────────────────
        const fraudSignals: FraudSignals = {
            documentType: 'BANK_PASSBOOK',
            checksumValid: structuralValid,
            ocrMatchScore,
            suspiciousPatterns: ocrData.confidence < 40 || !hasBankHeader,
            multipleAttempts,
            attemptCount,
            duplicateSubmission,
            ipRiskScore: getIPRiskScore(ipAddress),
            deviceFingerprint,
            textConsistency: ocrData.confidence,
            layoutConsistency: layoutScore,
            fontConsistency: ocrData.confidence > 50 ? 80 : 35,
            metadataFlags: [
                ...(!ifscValidation.isValid ? ['INVALID_IFSC'] : []),
                ...(!accountValidation.isValid ? ['INVALID_ACCOUNT_NUMBER'] : []),
                ...(accountMatch === 0 ? ['ACCOUNT_NUMBER_MISMATCH'] : []),
                ...(ifscMatch === 0 ? ['IFSC_MISMATCH'] : []),
                ...(!hasBankHeader ? ['NO_BANK_HEADER_DETECTED'] : []),
                ...(duplicateSubmission ? ['DUPLICATE_DOCUMENT'] : []),
            ],
        };

        // ── Step 8: Fraud AI Analysis ──────────────────────────
        const fraudResult = await analyzeFraud(fraudSignals);

        // ── Step 9: Determine Status ───────────────────────────
        let status: 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW' = 'VERIFIED';
        if (fraudResult.riskLevel === 'HIGH' || !structuralValid) {
            status = 'REJECTED';
        } else if (fraudResult.riskLevel === 'MEDIUM') {
            status = 'MANUAL_REVIEW';
        }

        // ── Step 10: Record Attempt ────────────────────────────
        recordAttempt({
            userId,
            documentType: 'BANK_PASSBOOK',
            timestamp: new Date().toISOString(),
            ipAddress,
            deviceFingerprint,
            documentHash: docHash,
            result: status,
        });

        // ── Build Response ─────────────────────────────────────
        const result: VerificationResult = {
            documentType: 'BANK_PASSBOOK',
            verificationId,
            status,
            structuralValidation: structuralValid,
            ocrMatchScore,
            fraudProbability: fraudResult.fraudProbability,
            riskLevel: fraudResult.riskLevel,
            confidenceScore: fraudResult.confidenceScore,
            maskedId: maskAccountNumber(accountNumber),
            extractedData: {
                accountHolderName: ocrData.accountHolderName,
                accountNumber: ocrData.accountNumber ? maskAccountNumber(ocrData.accountNumber) : undefined,
                ifscCode: ocrData.ifscCode,
                bankName: ocrData.bankName,
                branchName: ocrData.branchName,
                ocrConfidence: ocrData.confidence,
                nameMatchScore: nameMatch,
                layoutScore,
            },
            fraudAnalysis: fraudResult,
            timestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - startTime,
        };

        logger.info('Passbook verification complete', {
            verificationId,
            status,
            riskLevel: fraudResult.riskLevel,
            processingTimeMs: result.processingTimeMs,
        });

        return sendSuccessResponse(result);
    } catch (error: any) {
        logger.error('Passbook verification failed', { verificationId, error: error.message });
        return sendErrorResponse(500, `Passbook verification failed: ${error.message}`);
    }
};
