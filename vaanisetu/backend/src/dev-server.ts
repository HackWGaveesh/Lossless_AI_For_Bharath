import { resolve } from 'path';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from workspace root
config({ path: resolve(__dirname, '../../.env') });

import { handler as schemesListHandler } from './api/schemes/list.js';
import { handler as schemeDetailHandler } from './api/schemes/detail.js';
import { handler as schemesSearchHandler } from './api/schemes/search.js';
import { handler as documentUploadHandler } from './api/documents/upload.js';
import { handler as documentStatusHandler } from './api/documents/status.js';
import { handler as documentListHandler } from './api/documents/list.js';
import { handler as documentResolveHandler } from './api/documents/resolve.js';
import { handler as applicationCreateHandler } from './api/applications/create.js';
import { handler as applicationListHandler } from './api/applications/list.js';
import { handler as voiceQueryHandler } from './api/voice/query.js';
import { handler as voiceTranscribeHandler } from './api/voice/transcribe.js';
import { handler as telegramWebhookHandler } from './api/telegram/webhook.js';
import { handler as jobsListHandler } from './api/jobs/list.js';
import { handler as jobsMatchHandler } from './api/jobs/match.js';
import { handler as userProfileHandler } from './api/user/profile.js';
import { handler as healthHandler } from './api/health.js';
import { getDocumentStore, updateDocumentStore } from './api/documents/upload.js';
import { handler as verifyAadhaarHandler } from './api/verify/aadhaar.js';
import { handler as verifyPanHandler } from './api/verify/pan.js';
import { handler as verifyPassbookHandler } from './api/verify/passbook.js';
import { handler as verifyIncomeCertHandler } from './api/verify/income-certificate.js';
import {
  createDocumentProcessingSteps,
  normalizeDocumentProcessingSteps,
  updateDocumentProcessingStep,
} from './utils/document-processing.js';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

console.log('-------------------------------------------');
console.log('🚀 VAANISETU AI BACKEND RUNNING');
console.log('📂 Persistent Storage: data/documents-store.json');
console.log('-------------------------------------------');

function getUserId(req: Request): string {
  return (req.headers['x-user-id'] as string) ?? 'demo-user-1';
}

function toApiGatewayEvent(req: Request, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body: (req.method !== 'GET' && req.method !== 'HEAD' && req.body) ? JSON.stringify(req.body) : null,
    queryStringParameters: (req.query as Record<string, string>) || null,
    pathParameters: req.params,
    httpMethod: req.method,
    headers: req.headers,
    requestContext: {
      requestId: 'local-' + Date.now(),
      authorizer: { claims: { sub: getUserId(req) } },
    },
    ...overrides,
  };
}

function sendLambdaResponse(res: Response, result: { statusCode: number; headers?: Record<string, string>; body: string }) {
  res.status(result.statusCode);
  if (result.headers) {
    Object.entries(result.headers).forEach(([k, v]) => {
      // Avoid sending duplicate CORS headers that Express already handles
      if (k.toLowerCase().startsWith('access-control-allow-')) return;
      res.setHeader(k, v);
    });
  }
  res.send(result.body);
}

// Routes
app.get('/api/schemes', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await schemesListHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/schemes/search', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await schemesSearchHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/schemes/:schemeId', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await schemeDetailHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/documents/upload', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await documentUploadHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/documents', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { queryStringParameters: { ...req.query, userId: req.query.userId ?? getUserId(req) } });
    const result = await documentListHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/documents/:id/status', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await documentStatusHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/documents/:id/resolve', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await documentResolveHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

// Real local file upload handler
const uploadDir = resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// Bedrock for Document Verification
const bedrock = new BedrockRuntimeClient({
  region: 'us-east-1',
  token: process.env.AWS_BEARER_TOKEN_BEDROCK ? {
    token: process.env.AWS_BEARER_TOKEN_BEDROCK,
    expiration: new Date(Date.now() + 3600000)
  } : undefined
});

app.put('/api/documents/mock-upload/:documentId', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const documentId = req.params.documentId;
  const store = getDocumentStore();

  // Find document in store by documentId (userId may vary)
  let storeKey = '';
  let doc: Record<string, unknown> | undefined;
  for (const [key, val] of store.entries()) {
    if (val.document_id === documentId) {
      storeKey = key;
      doc = val;
      break;
    }
  }

  if (!doc) {
    console.warn(`[MockUpload] Document ${documentId} not found in store`);
    return res.status(404).json({ error: 'Document not found' });
  }

  // Get the raw file body
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const mimeType = String(req.headers['content-type'] || 'image/jpeg');

  if (rawBody.length === 0) {
    console.warn(`[MockUpload] Empty body received for ${documentId}`);
    return res.status(400).json({ error: 'No file data received' });
  }

  // Save to disk
  const ext = mimeType.includes('pdf') ? 'pdf' : mimeType.includes('png') ? 'png' : 'jpg';
  const filePath = resolve(uploadDir, `${documentId}.${ext}`);
  fs.writeFileSync(filePath, rawBody);
  console.log(`[MockUpload] Saved upload: ${rawBody.length} bytes (${mimeType}) → ${filePath}`);

  let currentDoc = {
    ...doc,
    status: 'processing',
    current_stage: 'upload',
    processing_steps: normalizeDocumentProcessingSteps((doc as any).processing_steps ?? createDocumentProcessingSteps()),
  } as Record<string, unknown>;
  let activeStep = 'upload';

  const persistLocalDoc = (
    patch: Record<string, unknown>,
    stepUpdates: Array<{
      id: string;
      status: 'pending' | 'in_progress' | 'completed' | 'failed';
      detail?: string;
      result?: Record<string, unknown> | string[] | string;
    }> = [],
  ) => {
    let steps = normalizeDocumentProcessingSteps(currentDoc.processing_steps);
    const now = new Date().toISOString();
    for (const stepUpdate of stepUpdates) {
      steps = updateDocumentProcessingStep(
        steps,
        stepUpdate.id,
        {
          status: stepUpdate.status,
          ...(stepUpdate.detail !== undefined ? { detail: stepUpdate.detail } : {}),
          ...(stepUpdate.result !== undefined ? { result: stepUpdate.result } : {}),
        },
        now,
      );
    }

    currentDoc = {
      ...currentDoc,
      ...patch,
      processing_steps: steps,
    };
    updateDocumentStore(storeKey, currentDoc);
  };

  persistLocalDoc({ status: 'processing', current_stage: 'upload' });
  res.status(200).send();

  const docType = String(doc.document_type || 'document');

  try {
    const fileBytes = fs.readFileSync(filePath);
    const isImage = mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/gif';
    const isPdf = mimeType === 'application/pdf';

    console.log(`[DocVerify] Processing ${docType}, mimeType=${mimeType}, size=${fileBytes.length} bytes`);

    // ── Convert ALL files to image bytes for vision OCR ──
    activeStep = 'file_validation';
    persistLocalDoc(
      { current_stage: 'file_validation' },
      [
        {
          id: 'upload',
          status: 'completed',
          detail: 'File uploaded and queued for the local AI pipeline.',
          result: { documentType: docType },
        },
        {
          id: 'file_validation',
          status: 'in_progress',
          detail: 'Checking file format and readability.',
        },
      ],
    );

    let imageBuffers: Buffer[] = [];
    let imageFormat: 'png' | 'jpeg' | 'gif' | 'webp' = 'jpeg';

    if (isImage) {
      imageBuffers = [Buffer.from(fileBytes)];
      if (mimeType === 'image/png' || filePath.endsWith('.png')) {
        imageFormat = 'png';
      } else if (mimeType === 'image/webp' || filePath.endsWith('.webp')) {
        imageFormat = 'webp';
      } else if (mimeType === 'image/gif' || filePath.endsWith('.gif')) {
        imageFormat = 'gif';
      } else {
        imageFormat = 'jpeg';
      }
      console.log(`[DocVerify] Image file ready: ${imageBuffers[0].length} bytes (format: ${imageFormat})`);
    } else if (isPdf) {
      // Convert PDF pages to PNG images using pdf-to-img
      try {
        const { pdf: pdfToImg } = await import('pdf-to-img');
        let pageNum = 0;
        for await (const pageImage of await pdfToImg(fileBytes, { scale: 2.0 })) {
          pageNum++;
          imageBuffers.push(Buffer.from(pageImage));
          console.log(`[DocVerify] PDF page ${pageNum}: ${pageImage.length} bytes`);
          if (pageNum >= 2) break; // Max 2 pages to keep under API limits
        }
        console.log(`[DocVerify] Converted ${pageNum} PDF pages to images`);
      } catch (pdfErr: any) {
        console.error('[DocVerify] PDF-to-image conversion failed:', pdfErr.message);
        // Fallback: try pdf-parse for text extraction
        try {
          // @ts-ignore
          const pdfParseModule = await import('pdf-parse');
          // @ts-ignore
          const pdfParse = pdfParseModule.default ?? pdfParseModule;
          const pdfData = await pdfParse(fileBytes);
          if (pdfData.text && pdfData.text.trim().length > 10) {
            console.log(`[DocVerify] Fallback: extracted ${pdfData.text.length} chars of text`);
            // We'll handle text-only below
            (req as any).__pdfText = pdfData.text;
          }
        } catch { /* ignore */ }
      }
    }

    if (imageBuffers.length === 0 && !(req as any).__pdfText) {
      throw new Error(`Cannot process file type: ${mimeType}. Please upload a JPG, PNG, or PDF.`);
    }

    activeStep = 'text_extraction';
    persistLocalDoc(
      { current_stage: 'text_extraction' },
      [
        {
          id: 'file_validation',
          status: 'completed',
          detail: 'File validated and ready for OCR.',
          result: {
            mimeType,
            fileSizeKb: Math.max(1, Math.round(fileBytes.length / 1024)),
            inputMode: isPdf ? 'pdf' : 'image',
          },
        },
        {
          id: 'text_extraction',
          status: 'in_progress',
          detail: isPdf
            ? 'Extracting text from the PDF for OCR.'
            : 'Preparing the image for OCR and field extraction.',
        },
      ],
    );

    // ── Build the OCR prompt ──
    const docTypePrompts: Record<string, string> = {
      aadhaar: `Extract: Name, Date of Birth, Gender, Aadhaar Number (mask as XXXX-XXXX-1234), Address, Father/Husband Name if visible.`,
      pan: `Extract: Full Name, Father's Name, Date of Birth, PAN Number (mask middle 4 digits as ABCDE****F), Signature present (yes/no).`,
      bank_passbook: `Extract: Account Holder Name, Account Number (replace all but the LAST 4 digits with X — e.g. if the document shows ...0510 then output XXXXXX0510; NEVER use 1234 or a fake suffix; use the actual last 4 digits from the document), Bank Name, Branch, IFSC Code, Account Type. Bank passbooks come in many formats (savings book, statement page, bank letter, etc.). Accept any document that clearly shows bank account details.`,
      income_certificate: `Extract: Applicant Name, Annual Income (with ₹), Issuing Authority, Certificate Number, Date of Issue, Valid Until.`,
    };

    const fieldInstructions = docTypePrompts[docType] || `Extract all visible text fields as key-value pairs.`;

    const invalidDocHint = docType === 'bank_passbook'
      ? `Only respond INVALID_DOCUMENT if the image is clearly a different document type (Aadhaar, PAN, etc.), a blank page, or a random unrelated image. Bank passbooks come in many formats — accept any document showing bank account details.`
      : `If NOT (wrong document, random photo, blank page), respond with exactly: INVALID_DOCUMENT`;

    const prompt = `You are an expert Indian government document OCR engine for VaaniSetu. Your ONLY job is to extract text with 100% molecular precision.

TASK: Analyze this "${docType}" document.

CRITICAL OCR RULES for MAXIMUM ACCURACY:
1. You MUST read every single character exactly as printed. DO NOT autocorrect or guess standard spellings (e.g., if it says "Gaveesha", do NOT output "Gavveesha"). Pay extreme attention to double letters.
2. Verify names and spellings TWO TIMES before outputting. Look closely at the image crops.
3. This document may be LOW QUALITY — blurry, tilted, compressed, photographed with a basic phone camera. Try your HARDEST to read every character accurately.
4. First verify: Is this actually a "${docType}"? ${invalidDocHint}
5. If it IS a valid "${docType}", extract ALL information precisely as described below.
6. Return ONLY a flat JSON object with string values. NO nested objects. NO arrays. NO markdown code fences.
7. Use human-readable key names like "Full Name", "Date Of Birth", "PAN Number".
8. If a field is partially readable, include your best guess with "(unclear)" suffix.
9. Mask sensitive numbers for security.

FIELDS TO EXTRACT:
${fieldInstructions}

RESPONSE FORMAT (example):
{"Full Name": "Rajesh Kumar", "Date Of Birth": "15/08/1990", "ID Number": "XXXX-XXXX-1234"}

If the document is not a valid "${docType}", respond with exactly: INVALID_DOCUMENT`;

    // ── Build content blocks for Bedrock ──
    const contentBlocks: any[] = [{ text: prompt }];

    if (imageBuffers.length > 0) {
      // Send first page image to vision model
      contentBlocks.push({
        image: { format: imageFormat, source: { bytes: imageBuffers[0] } }
      });
      // If there's a second page, send it too (PDF pages are always PNG)
      if (imageBuffers.length > 1) {
        contentBlocks.push({
          image: { format: isPdf ? 'png' : imageFormat, source: { bytes: imageBuffers[1] } }
        });
      }
    } else if ((req as any).__pdfText) {
      // Text-only fallback for PDFs
      contentBlocks[0] = {
        text: `${prompt}\n\nExtracted text from the PDF:\n---\n${(req as any).__pdfText}\n---\n\nBased on this text, provide the JSON response.`
      };
    }

    activeStep = 'field_structuring';
    persistLocalDoc(
      { current_stage: 'field_structuring' },
      [
        {
          id: 'text_extraction',
          status: 'completed',
          detail: 'OCR completed and content is ready for structuring.',
          result: {
            extractionMethod: isPdf ? 'pdf_text_fallback' : 'nova_vision',
            pagesAnalyzed: Math.max(imageBuffers.length, isPdf ? 1 : 0),
            extractedCharacters: typeof (req as any).__pdfText === 'string' ? (req as any).__pdfText.length : undefined,
          },
        },
        {
          id: 'field_structuring',
          status: 'in_progress',
          detail: 'Nova Pro is organizing the detected content into fields.',
        },
      ],
    );

    console.log(`[DocVerify] Sending to Bedrock Nova Pro (${contentBlocks.length} content blocks)...`);

    const response = await bedrock.send(new ConverseCommand({
      modelId: 'us.amazon.nova-pro-v1:0',
      messages: [{
        role: "user",
        content: contentBlocks
      }],
      inferenceConfig: {
        maxTokens: 800,
        temperature: 0.1,
      }
    }));

    const resultText = response.output?.message?.content?.[0]?.text?.trim() || 'INVALID_DOCUMENT';
    console.log(`[DocVerify] AI Response for ${docType}:`, resultText);

    if (resultText === 'INVALID_DOCUMENT' || (resultText.toLowerCase().includes('invalid_document') && !resultText.includes('{'))) {
      throw new Error(`This does not appear to be a valid ${docType}. Please upload the correct document.`);
    } else {
      let structuredData: any = {};
      try {
        // Extract JSON from response (may have markdown fences or extra text)
        const cleaned = resultText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          structuredData = JSON.parse(jsonMatch[0]);
        } else {
          structuredData = { Summary: cleaned };
        }
      } catch (err) {
        console.warn('[DocVerify] Failed to parse AI JSON, using raw text');
        structuredData = { Info: resultText };
      }

      // Flatten any nested objects so frontend never gets [object Object]
      const flatData: Record<string, string> = {};
      function flattenForStorage(obj: any, prefix: string = '') {
        for (const [key, value] of Object.entries(obj)) {
          const label = prefix ? `${prefix} - ${key}` : key;
          if (value === null || value === undefined) continue;
          if (Array.isArray(value)) {
            flatData[label] = value.map((v: any) => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', ');
          } else if (typeof value === 'object') {
            flattenForStorage(value, label);
          } else {
            flatData[label] = String(value);
          }
        }
      }
      flattenForStorage(structuredData);
      structuredData = flatData;

      console.log(`[DocVerify] Extracted fields:`, Object.keys(structuredData));

      activeStep = 'verification';
      persistLocalDoc(
        { current_stage: 'verification' },
        [
          {
            id: 'field_structuring',
            status: 'completed',
            detail: `Structured ${Object.keys(structuredData).length} fields from the document.`,
            result: {
              fieldCount: Object.keys(structuredData).length,
              extractedFields: Object.keys(structuredData).slice(0, 8),
            },
          },
          {
            id: 'verification',
            status: 'in_progress',
            detail: 'Publishing the verified result.',
          },
        ],
      );

      const replacedDocumentId = String(currentDoc.replaces_document_id ?? '');
      if (replacedDocumentId) {
        for (const [existingKey, value] of store.entries()) {
          if (value.document_id === replacedDocumentId) {
            updateDocumentStore(existingKey, {
              ...value,
              is_current: false,
              superseded_at: new Date().toISOString(),
            });
            break;
          }
        }
      }

      persistLocalDoc(
        {
          status: 'processed',
          current_stage: 'completed',
          structured_data: structuredData,
          is_current: true,
          processed_at: new Date().toISOString()
        },
        [
          {
            id: 'verification',
            status: 'completed',
            detail: 'Document verified successfully and ready to use.',
            result: {
              verifiedFields: Object.keys(structuredData).length,
            },
          },
        ],
      );
    }
  } catch (err: any) {
    console.error('[DocVerify] FAILED:', err.message);
    persistLocalDoc(
      {
        status: 'failed',
        current_stage: 'failed',
        error_message: `Verification failed: ${err.message}`,
        processed_at: new Date().toISOString()
      },
      [
        {
          id: activeStep,
          status: 'failed',
          detail: err.message,
          result: { error: err.message },
        },
      ],
    );
  }
});

app.get('/api/applications', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await applicationListHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/applications', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await applicationCreateHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/voice/query', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await voiceQueryHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await telegramWebhookHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await jobsListHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/user/profile', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await userProfileHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.put('/api/user/profile', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await userProfileHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    const result = await healthHandler({} as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch {
    res.status(503).json({ status: 'error', service: 'vaanisetu-backend' });
  }
});

// ── KYC Verification Routes ─────────────────────────────────

app.post('/api/verify/aadhaar', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await verifyAadhaarHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/verify/pan', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await verifyPanHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/verify/passbook', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await verifyPassbookHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/verify/income-certificate', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await verifyIncomeCertHandler(event as never, {} as never, () => { }) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`VaaniSetu backend dev server running at http://localhost:${PORT}`);
});
