// ──────────────────────────────────────────────────────────────
// Fraud AI Service — Bedrock Nova Pro fraud detection engine
// Uses ConverseCommand with structured JSON prompts
// ──────────────────────────────────────────────────────────────

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { FraudSignals, FraudAnalysisResult, DocumentType } from '../types/kyc.js';
import { logger } from '../utils/logger.js';

const MODEL_ID = 'us.amazon.nova-pro-v1:0';

const bedrock = new BedrockRuntimeClient({
    region: 'us-east-1',
    token: process.env.AWS_BEARER_TOKEN_BEDROCK
        ? {
            token: process.env.AWS_BEARER_TOKEN_BEDROCK,
            expiration: new Date(Date.now() + 3600000),
        }
        : undefined,
} as any);

// ── Scoring Weights by Document Type ─────────────────────────

const WEIGHTS: Record<DocumentType, Record<string, number>> = {
    AADHAAR: {
        checksumValid: 15,
        ocrMatch: 25,
        faceSimilarity: 25,
        qrMatch: 10,
        textConsistency: 10,
        attemptHistory: 10,
        ipRisk: 5,
    },
    PAN: {
        checksumValid: 20,
        ocrMatch: 30,
        textConsistency: 20,
        attemptHistory: 15,
        ipRisk: 10,
        qrMatch: 5,
    },
    BANK_PASSBOOK: {
        ocrMatch: 30,
        textConsistency: 25,
        layoutConsistency: 20,
        attemptHistory: 15,
        ipRisk: 10,
    },
    INCOME_CERTIFICATE: {
        ocrMatch: 25,
        textConsistency: 25,
        layoutConsistency: 20,
        attemptHistory: 15,
        ipRisk: 10,
        dateValidity: 5,
    },
};

// ── Main Fraud Analysis Function ─────────────────────────────

export async function analyzeFraud(signals: FraudSignals): Promise<FraudAnalysisResult> {
    const startTime = Date.now();
    logger.info('FraudAI: Starting analysis', {
        documentType: signals.documentType,
        ocrMatchScore: signals.ocrMatchScore,
    });

    // Build the prompt
    const prompt = buildFraudPrompt(signals);

    try {
        const response = await bedrock.send(
            new ConverseCommand({
                modelId: MODEL_ID,
                system: [
                    {
                        text: `You are an enterprise-grade AI fraud detection engine for Indian government document verification (KYC). You must analyze structured verification signals and return a fraud assessment.

CRITICAL RULES:
1. Return ONLY valid JSON — no markdown, no explanation outside JSON.
2. fraudProbability must be 0-100 (integer).
3. riskLevel must be exactly "LOW", "MEDIUM", or "HIGH".
4. confidenceScore must be 0-100 (integer).
5. explanation must be concise (max 2 sentences).
6. recommendedAction must be one of: "APPROVE", "MANUAL_REVIEW", "REJECT".
7. flags must be an array of short risk flag strings.

Response JSON schema:
{
  "fraudProbability": number,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "confidenceScore": number,
  "explanation": string,
  "recommendedAction": string,
  "flags": string[]
}`,
                    },
                ],
                messages: [
                    {
                        role: 'user',
                        content: [{ text: prompt }],
                    },
                ],
                inferenceConfig: {
                    maxTokens: 500,
                    temperature: 0.1, // Low temperature for deterministic fraud assessment
                },
            })
        );

        const responseText = response.output?.message?.content?.[0]?.text ?? '';
        logger.info('FraudAI: Raw response received', { length: responseText.length });

        // Parse JSON safely
        const result = parseFraudResponse(responseText, signals);

        logger.info('FraudAI: Analysis complete', {
            fraudProbability: result.fraudProbability,
            riskLevel: result.riskLevel,
            processingTimeMs: Date.now() - startTime,
        });

        return result;
    } catch (error: any) {
        logger.error('FraudAI: Bedrock analysis failed, using rule-based fallback', {
            error: error.message,
        });

        // Fallback to rule-based scoring
        return calculateRuleBasedFraud(signals);
    }
}

// ── Prompt Builder ───────────────────────────────────────────

function buildFraudPrompt(signals: FraudSignals): string {
    return `Analyze these verification signals for a ${signals.documentType} document and assess fraud probability.

VERIFICATION SIGNALS:
- Document Type: ${signals.documentType}
- Structural Checksum Valid: ${signals.checksumValid}
- OCR Match Score: ${signals.ocrMatchScore}/100
- Face Similarity: ${signals.faceSimilarity !== undefined ? `${signals.faceSimilarity}/100` : 'N/A (no face comparison)'}
- QR Code Match: ${signals.qrMatch !== undefined ? signals.qrMatch : 'N/A'}
- Suspicious Patterns Detected: ${signals.suspiciousPatterns}
- Multiple Attempts (rate limit): ${signals.multipleAttempts} (${signals.attemptCount} attempts)
- Duplicate Submission: ${signals.duplicateSubmission}
- IP Risk Score: ${signals.ipRiskScore}/100
- Text Consistency Score: ${signals.textConsistency}/100
- Layout Consistency Score: ${signals.layoutConsistency}/100
- Font Consistency Score: ${signals.fontConsistency}/100
- Metadata Flags: ${signals.metadataFlags.length > 0 ? signals.metadataFlags.join(', ') : 'None'}

SCORING WEIGHTS FOR ${signals.documentType}:
${JSON.stringify(WEIGHTS[signals.documentType], null, 2)}

Respond ONLY with valid JSON matching the required schema.`;
}

// ── Response Parser with Fallback ────────────────────────────

function parseFraudResponse(responseText: string, signals: FraudSignals): FraudAnalysisResult {
    try {
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate and sanitize
        return {
            fraudProbability: clamp(Number(parsed.fraudProbability) || 0, 0, 100),
            riskLevel: (['LOW', 'MEDIUM', 'HIGH'].includes(parsed.riskLevel) ? parsed.riskLevel : 'MEDIUM') as any,
            confidenceScore: clamp(Number(parsed.confidenceScore) || 50, 0, 100),
            explanation: String(parsed.explanation || 'Analysis complete.'),
            recommendedAction: String(parsed.recommendedAction || 'MANUAL_REVIEW'),
            flags: Array.isArray(parsed.flags) ? parsed.flags.map(String) : [],
        };
    } catch (parseError) {
        logger.warn('FraudAI: Failed to parse AI response, using rule-based fallback', { parseError });
        return calculateRuleBasedFraud(signals);
    }
}

// ── Rule-Based Fallback ──────────────────────────────────────

function calculateRuleBasedFraud(signals: FraudSignals): FraudAnalysisResult {
    const flags: string[] = [];
    let riskPoints = 0;

    // Checksum
    if (!signals.checksumValid) {
        riskPoints += 30;
        flags.push('INVALID_CHECKSUM');
    }

    // OCR match
    if (signals.ocrMatchScore < 50) {
        riskPoints += 25;
        flags.push('LOW_OCR_MATCH');
    } else if (signals.ocrMatchScore < 75) {
        riskPoints += 10;
        flags.push('MODERATE_OCR_MISMATCH');
    }

    // Face similarity
    if (signals.faceSimilarity !== undefined) {
        if (signals.faceSimilarity < 50) {
            riskPoints += 25;
            flags.push('FACE_MISMATCH');
        } else if (signals.faceSimilarity < 70) {
            riskPoints += 10;
            flags.push('LOW_FACE_SIMILARITY');
        }
    }

    // QR
    if (signals.qrMatch === false) {
        riskPoints += 15;
        flags.push('QR_MISMATCH');
    }

    // Suspicious patterns
    if (signals.suspiciousPatterns) {
        riskPoints += 20;
        flags.push('SUSPICIOUS_PATTERNS');
    }

    // Multiple attempts
    if (signals.multipleAttempts) {
        riskPoints += 15;
        flags.push('RATE_LIMIT_WARNING');
    }

    // Duplicate
    if (signals.duplicateSubmission) {
        riskPoints += 10;
        flags.push('DUPLICATE_SUBMISSION');
    }

    // Text / layout consistency
    if (signals.textConsistency < 50) {
        riskPoints += 10;
        flags.push('INCONSISTENT_TEXT');
    }
    if (signals.layoutConsistency < 50) {
        riskPoints += 10;
        flags.push('INCONSISTENT_LAYOUT');
    }

    const fraudProbability = clamp(riskPoints, 0, 100);
    const riskLevel = fraudProbability > 60 ? 'HIGH' : fraudProbability > 30 ? 'MEDIUM' : 'LOW';
    const confidenceScore = 100 - fraudProbability;

    let recommendedAction = 'APPROVE';
    if (riskLevel === 'HIGH') recommendedAction = 'REJECT';
    else if (riskLevel === 'MEDIUM') recommendedAction = 'MANUAL_REVIEW';

    return {
        fraudProbability,
        riskLevel,
        confidenceScore,
        explanation: `Rule-based analysis: ${flags.length} risk flags detected. ${riskLevel} risk level.`,
        recommendedAction,
        flags,
    };
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}
