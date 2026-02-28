// ──────────────────────────────────────────────────────────────
// KYC Verification Type Definitions
// Enterprise-grade identity verification system
// ──────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type DocumentType =
    | 'AADHAAR'
    | 'PAN'
    | 'BANK_PASSBOOK'
    | 'INCOME_CERTIFICATE';

export type VerificationStatus =
    | 'PENDING'
    | 'PROCESSING'
    | 'VERIFIED'
    | 'REJECTED'
    | 'MANUAL_REVIEW';

// ── Structural Validation ────────────────────────────────────

export interface AadhaarValidation {
    isValid: boolean;
    isNumeric: boolean;
    isCorrectLength: boolean;
    hasNoRepeatedDigits: boolean;
    hasNoSequentialDigits: boolean;
    verhoeffValid: boolean;
    errors: string[];
}

export interface PanValidation {
    isValid: boolean;
    matchesRegex: boolean;
    entityType: string;
    entityTypeLabel: string;
    declaredTypeMismatch: boolean;
    errors: string[];
}

// ── OCR Extraction Results ───────────────────────────────────

export interface AadhaarOcrData {
    name?: string;
    dateOfBirth?: string;
    aadhaarNumber?: string;
    gender?: string;
    address?: string;
    fatherName?: string;
    rawText: string;
    confidence: number;
}

export interface PanOcrData {
    panNumber?: string;
    name?: string;
    fatherName?: string;
    dateOfBirth?: string;
    rawText: string;
    confidence: number;
}

export interface PassbookOcrData {
    accountHolderName?: string;
    accountNumber?: string;
    ifscCode?: string;
    bankName?: string;
    branchName?: string;
    rawText: string;
    confidence: number;
}

export interface IncomeCertOcrData {
    name?: string;
    incomeAmount?: string;
    issuingAuthority?: string;
    dateIssued?: string;
    certificateNumber?: string;
    rawText: string;
    confidence: number;
}

// ── Face Comparison ──────────────────────────────────────────

export interface FaceComparisonResult {
    similarity: number;
    matched: boolean;
    confidence: number;
    faceDetectedInDocument: boolean;
    faceDetectedInSelfie: boolean;
    boundingBoxDocument?: BoundingBox;
    boundingBoxSelfie?: BoundingBox;
}

export interface BoundingBox {
    width: number;
    height: number;
    left: number;
    top: number;
}

// ── Fraud Signals ────────────────────────────────────────────

export interface FraudSignals {
    documentType: DocumentType;
    checksumValid: boolean;
    ocrMatchScore: number;
    faceSimilarity?: number;
    qrMatch?: boolean;
    suspiciousPatterns: boolean;
    multipleAttempts: boolean;
    attemptCount: number;
    duplicateSubmission: boolean;
    ipRiskScore: number;
    deviceFingerprint?: string;
    textConsistency: number;
    layoutConsistency: number;
    fontConsistency: number;
    metadataFlags: string[];
}

// ── Fraud AI Response ────────────────────────────────────────

export interface FraudAnalysisResult {
    fraudProbability: number;
    riskLevel: RiskLevel;
    confidenceScore: number;
    explanation: string;
    recommendedAction: string;
    flags: string[];
}

// ── Final Verification Response ──────────────────────────────

export interface VerificationResult {
    documentType: DocumentType;
    verificationId: string;
    status: VerificationStatus;
    structuralValidation: boolean;
    ocrMatchScore: number;
    faceSimilarity?: number;
    fraudProbability: number;
    riskLevel: RiskLevel;
    confidenceScore: number;
    maskedId: string;
    extractedData: Record<string, unknown>;
    fraudAnalysis: FraudAnalysisResult;
    timestamp: string;
    processingTimeMs: number;
}

// ── Request Types ────────────────────────────────────────────

export interface AadhaarVerifyRequest {
    userId: string;
    aadhaarNumber: string;
    name: string;
    dateOfBirth: string;
    documentImage: string; // base64
    selfieImage?: string;  // base64
    deviceFingerprint?: string;
    ipAddress?: string;
}

export interface PanVerifyRequest {
    userId: string;
    panNumber: string;
    name: string;
    dateOfBirth?: string;
    declaredEntityType?: string;
    documentImage: string; // base64
    deviceFingerprint?: string;
    ipAddress?: string;
}

export interface PassbookVerifyRequest {
    userId: string;
    accountHolderName: string;
    accountNumber: string;
    ifscCode: string;
    documentImage: string; // base64
    deviceFingerprint?: string;
    ipAddress?: string;
}

export interface IncomeCertVerifyRequest {
    userId: string;
    name: string;
    expectedIncome?: string;
    documentImage: string; // base64
    deviceFingerprint?: string;
    ipAddress?: string;
}

// ── Attempt Tracking ─────────────────────────────────────────

export interface AttemptRecord {
    userId: string;
    documentType: DocumentType;
    timestamp: string;
    ipAddress?: string;
    deviceFingerprint?: string;
    documentHash: string;
    result: VerificationStatus;
}

// ── Scoring Weights ──────────────────────────────────────────

export interface ScoringWeights {
    structuralValidation: number;
    ocrMatch: number;
    faceSimilarity: number;
    fraudAI: number;
    attemptHistory: number;
    documentConsistency: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
    structuralValidation: 0.15,
    ocrMatch: 0.25,
    faceSimilarity: 0.20,
    fraudAI: 0.25,
    attemptHistory: 0.05,
    documentConsistency: 0.10,
};
