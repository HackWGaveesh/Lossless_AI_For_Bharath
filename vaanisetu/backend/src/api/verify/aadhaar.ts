// ──────────────────────────────────────────────────────────────
// POST /verify/aadhaar — Aadhaar KYC Verification
// Multi-layer: Structural → OCR → Face → Fraud AI
// ──────────────────────────────────────────────────────────────

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { validateAadhaar } from '../../validators/aadhaarValidator.js';
import { extractAadhaarData } from '../../services/textractService.js';
import { compareFaces, analyzeFaceQuality } from '../../services/rekognitionService.js';
import { analyzeFraud } from '../../services/fraudAIService.js';
import { maskAadhaar, hashDocument, generateVerificationId, fuzzyMatchScore } from '../../utils/masking.js';
import { recordAttempt, getAttemptCount, isMultipleAttempts, isDuplicateSubmission, getIPRiskScore } from '../../utils/attempt-tracker.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { parseJsonBody, getUserIdFromEvent } from '../../utils/user-id.js';
import { logger } from '../../utils/logger.js';
import type { AadhaarVerifyRequest, VerificationResult, FraudSignals } from '../../types/kyc.js';

const s3 = new S3Client({ region: process.env.REGION || 'ap-south-1' });

export const handler: APIGatewayProxyHandler = async (event) => {
    const startTime = Date.now();
    const verificationId = generateVerificationId();

    try {
        const body = parseJsonBody(event) as unknown as AadhaarVerifyRequest;
        const userId = getUserIdFromEvent(event, body as any) ?? body.userId ?? 'anonymous';

        const { aadhaarNumber, name, dateOfBirth, documentImage, selfieImage, deviceFingerprint, ipAddress } = body;

        if (!aadhaarNumber || !name || !documentImage) {
            return sendErrorResponse(400, 'Missing required fields: aadhaarNumber, name, documentImage');
        }

        logger.info('Aadhaar verification started', { verificationId, userId });

        // ── Step 1: Structural Validation ──────────────────────
        const structural = validateAadhaar(aadhaarNumber);
        logger.info('Aadhaar structural validation', { verificationId, valid: structural.isValid, errors: structural.errors });

        // ── Step 2: Duplicate & Rate Check ─────────────────────
        const docHash = hashDocument(documentImage);
        const duplicateSubmission = isDuplicateSubmission(docHash, userId);
        const multipleAttempts = isMultipleAttempts(userId, 'AADHAAR');
        const attemptCount = getAttemptCount(userId, 'AADHAAR');

        if (multipleAttempts) {
            logger.warn('Aadhaar rate limit exceeded', { verificationId, userId, attemptCount });
        }

        // ── Step 3: Upload to S3 (encrypted) ───────────────────
        const imageBytes = Buffer.from(documentImage, 'base64');
        const s3Key = `kyc/aadhaar/${userId}/${verificationId}.enc`;

        try {
            await s3.send(new PutObjectCommand({
                Bucket: process.env.DOCUMENTS_BUCKET,
                Key: s3Key,
                Body: imageBytes,
                ContentType: 'image/jpeg',
                ServerSideEncryption: 'aws:kms',
                Metadata: { verificationId, userId, documentType: 'AADHAAR' },
            }));
        } catch (s3Err) {
            logger.warn('S3 upload failed, continuing with in-memory processing', { s3Err });
        }

        // ── Step 4: Textract OCR ───────────────────────────────
        const ocrData = await extractAadhaarData(new Uint8Array(imageBytes));
        logger.info('Aadhaar OCR extraction complete', {
            verificationId,
            nameExtracted: !!ocrData.name,
            aadhaarFound: !!ocrData.aadhaarNumber,
            confidence: ocrData.confidence,
        });

        // ── Step 5: OCR Match Scoring ──────────────────────────
        const nameMatchScore = fuzzyMatchScore(name, ocrData.name ?? '');
        const dobMatch = dateOfBirth && ocrData.dateOfBirth
            ? fuzzyMatchScore(dateOfBirth, ocrData.dateOfBirth)
            : 50; // neutral if no DOB to compare
        const aadhaarMatch = ocrData.aadhaarNumber
            ? (aadhaarNumber.replace(/\D/g, '') === ocrData.aadhaarNumber.replace(/\D/g, '') ? 100 : 0)
            : 50; // neutral if OCR couldn't read it

        const ocrMatchScore = Math.round((nameMatchScore * 0.5) + (dobMatch * 0.2) + (aadhaarMatch * 0.3));

        // ── Step 6: Face Comparison (if selfie provided) ───────
        let faceSimilarity: number | undefined;
        if (selfieImage) {
            const selfieBytes = Buffer.from(selfieImage, 'base64');
            const faceResult = await compareFaces(new Uint8Array(imageBytes), new Uint8Array(selfieBytes));
            faceSimilarity = faceResult.similarity;

            // Also run face quality check
            const quality = await analyzeFaceQuality(new Uint8Array(selfieBytes));
            if (quality.hasQualityIssues) {
                logger.warn('Selfie quality issues', { verificationId, issues: quality.issues });
            }
        }

        // ── Step 7: Build Fraud Signals ────────────────────────
        const fraudSignals: FraudSignals = {
            documentType: 'AADHAAR',
            checksumValid: structural.isValid,
            ocrMatchScore,
            faceSimilarity,
            qrMatch: undefined, // QR decoding is separate; set to undefined if not available
            suspiciousPatterns: ocrData.confidence < 40,
            multipleAttempts,
            attemptCount,
            duplicateSubmission,
            ipRiskScore: getIPRiskScore(ipAddress),
            deviceFingerprint,
            textConsistency: ocrData.confidence,
            layoutConsistency: ocrData.confidence > 50 ? 85 : 40,
            fontConsistency: ocrData.confidence > 50 ? 80 : 35,
            metadataFlags: [
                ...(!structural.isValid ? ['INVALID_AADHAAR_STRUCTURE'] : []),
                ...(duplicateSubmission ? ['DUPLICATE_DOCUMENT'] : []),
                ...(multipleAttempts ? ['EXCESSIVE_ATTEMPTS'] : []),
                ...(ocrData.confidence < 40 ? ['LOW_OCR_CONFIDENCE'] : []),
            ],
        };

        // ── Step 8: Fraud AI Analysis ──────────────────────────
        const fraudResult = await analyzeFraud(fraudSignals);

        // ── Step 9: Determine Status ───────────────────────────
        let status: 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW' = 'VERIFIED';
        if (fraudResult.riskLevel === 'HIGH' || !structural.isValid) {
            status = 'REJECTED';
        } else if (fraudResult.riskLevel === 'MEDIUM') {
            status = 'MANUAL_REVIEW';
        }

        // ── Step 10: Record Attempt ────────────────────────────
        recordAttempt({
            userId,
            documentType: 'AADHAAR',
            timestamp: new Date().toISOString(),
            ipAddress,
            deviceFingerprint,
            documentHash: docHash,
            result: status,
        });

        // ── Build Response ─────────────────────────────────────
        const result: VerificationResult = {
            documentType: 'AADHAAR',
            verificationId,
            status,
            structuralValidation: structural.isValid,
            ocrMatchScore,
            faceSimilarity,
            fraudProbability: fraudResult.fraudProbability,
            riskLevel: fraudResult.riskLevel,
            confidenceScore: fraudResult.confidenceScore,
            maskedId: maskAadhaar(aadhaarNumber),
            extractedData: {
                name: ocrData.name,
                dateOfBirth: ocrData.dateOfBirth,
                gender: ocrData.gender,
                ocrConfidence: ocrData.confidence,
                nameMatchScore,
            },
            fraudAnalysis: fraudResult,
            timestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - startTime,
        };

        logger.info('Aadhaar verification complete', {
            verificationId,
            status,
            riskLevel: fraudResult.riskLevel,
            processingTimeMs: result.processingTimeMs,
        });

        return sendSuccessResponse(result);
    } catch (error: any) {
        logger.error('Aadhaar verification failed', { verificationId, error: error.message, stack: error.stack });
        return sendErrorResponse(500, `Aadhaar verification failed: ${error.message}`);
    }
};
