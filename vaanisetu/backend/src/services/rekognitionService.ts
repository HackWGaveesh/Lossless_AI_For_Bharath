// ──────────────────────────────────────────────────────────────
// Rekognition Service — Face detection + comparison
// Uses Amazon Rekognition CompareFaces & DetectFaces
// ──────────────────────────────────────────────────────────────

import {
    RekognitionClient,
    CompareFacesCommand,
    DetectFacesCommand,
} from '@aws-sdk/client-rekognition';
import type { FaceComparisonResult } from '../types/kyc.js';
import { logger } from '../utils/logger.js';

const rekognition = new RekognitionClient({ region: process.env.REGION || 'ap-south-1' });

const SIMILARITY_THRESHOLD = 70; // minimum % to consider a match

/**
 * Compare a face in the document image against a selfie image.
 * Returns similarity percentage and match status.
 */
export async function compareFaces(
    documentImageBytes: Uint8Array,
    selfieImageBytes: Uint8Array
): Promise<FaceComparisonResult> {
    logger.info('Rekognition: Comparing faces between document and selfie');

    try {
        // First verify both images have faces
        const [docFaces, selfieFaces] = await Promise.all([
            detectFaces(documentImageBytes),
            detectFaces(selfieImageBytes),
        ]);

        const faceDetectedInDocument = docFaces > 0;
        const faceDetectedInSelfie = selfieFaces > 0;

        if (!faceDetectedInDocument || !faceDetectedInSelfie) {
            logger.warn('Rekognition: Face not detected in one or both images', {
                faceDetectedInDocument,
                faceDetectedInSelfie,
            });
            return {
                similarity: 0,
                matched: false,
                confidence: 0,
                faceDetectedInDocument,
                faceDetectedInSelfie,
            };
        }

        // Compare faces
        const response = await rekognition.send(
            new CompareFacesCommand({
                SourceImage: { Bytes: documentImageBytes },
                TargetImage: { Bytes: selfieImageBytes },
                SimilarityThreshold: SIMILARITY_THRESHOLD,
                QualityFilter: 'AUTO',
            })
        );

        const match = response.FaceMatches?.[0];
        if (!match) {
            return {
                similarity: 0,
                matched: false,
                confidence: 0,
                faceDetectedInDocument,
                faceDetectedInSelfie,
            };
        }

        const similarity = Math.round(match.Similarity ?? 0);
        const confidence = Math.round(match.Face?.Confidence ?? 0);

        logger.info('Rekognition: Face comparison result', { similarity, confidence });

        return {
            similarity,
            matched: similarity >= SIMILARITY_THRESHOLD,
            confidence,
            faceDetectedInDocument,
            faceDetectedInSelfie,
            boundingBoxDocument: match.Face?.BoundingBox
                ? {
                    width: match.Face.BoundingBox.Width ?? 0,
                    height: match.Face.BoundingBox.Height ?? 0,
                    left: match.Face.BoundingBox.Left ?? 0,
                    top: match.Face.BoundingBox.Top ?? 0,
                }
                : undefined,
        };
    } catch (error: any) {
        logger.error('Rekognition face comparison failed', {
            error: error.message,
            code: error.name,
        });

        // Return a safe default — do not crash the pipeline
        return {
            similarity: 0,
            matched: false,
            confidence: 0,
            faceDetectedInDocument: false,
            faceDetectedInSelfie: false,
        };
    }
}

/**
 * Detect the number of faces in an image.
 * Used to pre-check before comparison.
 */
async function detectFaces(imageBytes: Uint8Array): Promise<number> {
    try {
        const response = await rekognition.send(
            new DetectFacesCommand({
                Image: { Bytes: imageBytes },
                Attributes: ['DEFAULT'],
            })
        );
        return response.FaceDetails?.length ?? 0;
    } catch (error) {
        logger.warn('Rekognition: DetectFaces failed', { error });
        return 0;
    }
}

/**
 * Detect face quality metrics for fraud analysis.
 * Checks for sunglasses, face occlusion, extreme pose, etc.
 */
export async function analyzeFaceQuality(imageBytes: Uint8Array): Promise<{
    hasQualityIssues: boolean;
    issues: string[];
    faceCount: number;
}> {
    try {
        const response = await rekognition.send(
            new DetectFacesCommand({
                Image: { Bytes: imageBytes },
                Attributes: ['ALL'],
            })
        );

        const issues: string[] = [];
        const faces = response.FaceDetails ?? [];

        if (faces.length === 0) {
            return { hasQualityIssues: true, issues: ['No face detected'], faceCount: 0 };
        }

        if (faces.length > 1) {
            issues.push(`Multiple faces detected (${faces.length})`);
        }

        const face = faces[0];

        // Check sunglasses
        if (face.Sunglasses?.Value && (face.Sunglasses.Confidence ?? 0) > 80) {
            issues.push('Sunglasses detected');
        }

        // Check extreme pose
        if (face.Pose) {
            if (Math.abs(face.Pose.Yaw ?? 0) > 45) issues.push('Face turned too far sideways');
            if (Math.abs(face.Pose.Pitch ?? 0) > 30) issues.push('Face tilted too much');
        }

        // Check low brightness / blurry
        if (face.Quality) {
            if ((face.Quality.Brightness ?? 100) < 30) issues.push('Image too dark');
            if ((face.Quality.Sharpness ?? 100) < 30) issues.push('Image too blurry');
        }

        return {
            hasQualityIssues: issues.length > 0,
            issues,
            faceCount: faces.length,
        };
    } catch (error) {
        logger.warn('Rekognition: Face quality analysis failed', { error });
        return { hasQualityIssues: false, issues: [], faceCount: 0 };
    }
}
