// ──────────────────────────────────────────────────────────────
// POST /verify/pan — PAN Card KYC Verification
// Multi-layer: Regex + Entity → OCR → Name Match → Fraud AI
// ──────────────────────────────────────────────────────────────

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { validatePan } from '../../validators/panValidator.js';
import { extractPanData } from '../../services/textractService.js';
import { analyzeFraud } from '../../services/fraudAIService.js';
import { maskPan, hashDocument, generateVerificationId, fuzzyMatchScore } from '../../utils/masking.js';
import { recordAttempt, getAttemptCount, isMultipleAttempts, isDuplicateSubmission, getIPRiskScore } from '../../utils/attempt-tracker.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { parseJsonBody, getUserIdFromEvent } from '../../utils/user-id.js';
import { logger } from '../../utils/logger.js';
import type { PanVerifyRequest, VerificationResult, FraudSignals } from '../../types/kyc.js';

const s3 = new S3Client({ region: process.env.REGION || 'ap-south-1' });

export const handler: APIGatewayProxyHandler = async (event) => {
    const startTime = Date.now();
    const verificationId = generateVerificationId();

    try {
        const body = parseJsonBody(event) as unknown as PanVerifyRequest;
        const userId = getUserIdFromEvent(event, body as any) ?? body.userId ?? 'anonymous';

        const { panNumber, name, dateOfBirth, declaredEntityType, documentImage, deviceFingerprint, ipAddress } = body;

        if (!panNumber || !name || !documentImage) {
            return sendErrorResponse(400, 'Missing required fields: panNumber, name, documentImage');
        }

        logger.info('PAN verification started', { verificationId, userId });

        // ── Step 1: Structural Validation ──────────────────────
        const structural = validatePan(panNumber, declaredEntityType);
        logger.info('PAN structural validation', { verificationId, valid: structural.isValid, entityType: structural.entityTypeLabel });

        // ── Step 2: Duplicate & Rate Check ─────────────────────
        const docHash = hashDocument(documentImage);
        const duplicateSubmission = isDuplicateSubmission(docHash, userId);
        const multipleAttempts = isMultipleAttempts(userId, 'PAN');
        const attemptCount = getAttemptCount(userId, 'PAN');

        // ── Step 3: Upload to S3 (encrypted) ───────────────────
        const imageBytes = Buffer.from(documentImage, 'base64');
        const s3Key = `kyc/pan/${userId}/${verificationId}.enc`;

        try {
            await s3.send(new PutObjectCommand({
                Bucket: process.env.DOCUMENTS_BUCKET,
                Key: s3Key,
                Body: imageBytes,
                ContentType: 'image/jpeg',
                ServerSideEncryption: 'aws:kms',
                Metadata: { verificationId, userId, documentType: 'PAN' },
            }));
        } catch (s3Err) {
            logger.warn('S3 upload failed, continuing with in-memory processing', { s3Err });
        }

        // ── Step 4: Textract OCR ───────────────────────────────
        const ocrData = await extractPanData(new Uint8Array(imageBytes));
        logger.info('PAN OCR extraction complete', {
            verificationId,
            panFound: !!ocrData.panNumber,
            nameFound: !!ocrData.name,
            confidence: ocrData.confidence,
        });

        // ── Step 5: OCR Match Scoring ──────────────────────────
        const nameMatchScore = fuzzyMatchScore(name, ocrData.name ?? '');
        const panMatchScore = ocrData.panNumber
            ? (panNumber.toUpperCase() === ocrData.panNumber.toUpperCase() ? 100 : 0)
            : 50;
        const dobMatchScore = dateOfBirth && ocrData.dateOfBirth
            ? fuzzyMatchScore(dateOfBirth, ocrData.dateOfBirth)
            : 50;

        const ocrMatchScore = Math.round(
            (nameMatchScore * 0.4) + (panMatchScore * 0.4) + (dobMatchScore * 0.2)
        );

        // ── Step 6: Build Fraud Signals ────────────────────────
        const fraudSignals: FraudSignals = {
            documentType: 'PAN',
            checksumValid: structural.isValid,
            ocrMatchScore,
            suspiciousPatterns: ocrData.confidence < 40 || structural.declaredTypeMismatch,
            multipleAttempts,
            attemptCount,
            duplicateSubmission,
            ipRiskScore: getIPRiskScore(ipAddress),
            deviceFingerprint,
            textConsistency: ocrData.confidence,
            layoutConsistency: ocrData.confidence > 50 ? 85 : 40,
            fontConsistency: ocrData.confidence > 50 ? 80 : 35,
            metadataFlags: [
                ...(!structural.isValid ? ['INVALID_PAN_FORMAT'] : []),
                ...(structural.declaredTypeMismatch ? ['ENTITY_TYPE_MISMATCH'] : []),
                ...(duplicateSubmission ? ['DUPLICATE_DOCUMENT'] : []),
                ...(multipleAttempts ? ['EXCESSIVE_ATTEMPTS'] : []),
                ...(panMatchScore === 0 ? ['PAN_NUMBER_MISMATCH'] : []),
            ],
        };

        // ── Step 7: Fraud AI Analysis ──────────────────────────
        const fraudResult = await analyzeFraud(fraudSignals);

        // ── Step 8: Determine Status ───────────────────────────
        let status: 'VERIFIED' | 'REJECTED' | 'MANUAL_REVIEW' = 'VERIFIED';
        if (fraudResult.riskLevel === 'HIGH' || !structural.isValid) {
            status = 'REJECTED';
        } else if (fraudResult.riskLevel === 'MEDIUM') {
            status = 'MANUAL_REVIEW';
        }

        // ── Step 9: Record Attempt ─────────────────────────────
        recordAttempt({
            userId,
            documentType: 'PAN',
            timestamp: new Date().toISOString(),
            ipAddress,
            deviceFingerprint,
            documentHash: docHash,
            result: status,
        });

        // ── Build Response ─────────────────────────────────────
        const result: VerificationResult = {
            documentType: 'PAN',
            verificationId,
            status,
            structuralValidation: structural.isValid,
            ocrMatchScore,
            fraudProbability: fraudResult.fraudProbability,
            riskLevel: fraudResult.riskLevel,
            confidenceScore: fraudResult.confidenceScore,
            maskedId: maskPan(panNumber),
            extractedData: {
                panNumber: ocrData.panNumber ? maskPan(ocrData.panNumber) : undefined,
                name: ocrData.name,
                fatherName: ocrData.fatherName,
                dateOfBirth: ocrData.dateOfBirth,
                entityType: structural.entityTypeLabel,
                ocrConfidence: ocrData.confidence,
                nameMatchScore,
            },
            fraudAnalysis: fraudResult,
            timestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - startTime,
        };

        logger.info('PAN verification complete', {
            verificationId,
            status,
            riskLevel: fraudResult.riskLevel,
            processingTimeMs: result.processingTimeMs,
        });

        return sendSuccessResponse(result);
    } catch (error: any) {
        logger.error('PAN verification failed', { verificationId, error: error.message });
        return sendErrorResponse(500, `PAN verification failed: ${error.message}`);
    }
};
