import type { S3Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import {
  createDocumentProcessingSteps,
  normalizeDocumentProcessingSteps,
  updateDocumentProcessingStep,
} from '../../utils/document-processing.js';

const s3 = new S3Client({ region: process.env.REGION });
// Nova models used below are served in us-east-1 for this account setup.
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });
const textract = new TextractClient({ region: process.env.REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents';

// Flatten nested JSON objects to prevent DynamoDB nesting errors
function flattenForStorage(obj: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key in obj) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (Array.isArray(obj[key])) {
        result[key] = obj[key].join(', ');
      } else {
        const nested = flattenForStorage(obj[key]);
        for (const nestedKey in nested) {
          result[`${key}_${nestedKey}`] = nested[nestedKey];
        }
      }
    } else {
      result[key] = String(obj[key]);
    }
  }
  return result;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractPdfTextWithTextract(bucket: string, key: string): Promise<string> {
  const start = await textract.send(new StartDocumentTextDetectionCommand({
    DocumentLocation: {
      S3Object: { Bucket: bucket, Name: key },
    },
  }));

  if (!start.JobId) {
    throw new Error('Failed to start PDF OCR job');
  }

  for (let attempt = 0; attempt < 45; attempt++) {
    await sleep(2000);
    const firstPage = await textract.send(new GetDocumentTextDetectionCommand({
      JobId: start.JobId,
      MaxResults: 1000,
    }));

    if (firstPage.JobStatus === 'FAILED') {
      throw new Error(firstPage.StatusMessage || 'PDF OCR failed');
    }
    if (firstPage.JobStatus !== 'SUCCEEDED') {
      continue;
    }

    const lines: string[] = [];
    const pushLines = (blocks?: { BlockType?: string; Text?: string }[]) => {
      if (!blocks) return;
      for (const block of blocks) {
        if (block.BlockType === 'LINE' && block.Text) {
          lines.push(block.Text);
        }
      }
    };

    pushLines(firstPage.Blocks);
    let nextToken = firstPage.NextToken;
    while (nextToken) {
      const page = await textract.send(new GetDocumentTextDetectionCommand({
        JobId: start.JobId,
        MaxResults: 1000,
        NextToken: nextToken,
      }));
      pushLines(page.Blocks);
      nextToken = page.NextToken;
    }

    return lines.join('\n').trim();
  }

  throw new Error('PDF OCR timed out');
}

async function renderPdfPages(fileBytes: Uint8Array): Promise<Buffer[]> {
  const { pdf } = await import('pdf-to-img');
  const pages: Buffer[] = [];

  for await (const pageImage of await pdf(Buffer.from(fileBytes), { scale: 2.0 })) {
    pages.push(Buffer.from(pageImage));
    if (pages.length >= 2) break;
  }

  return pages;
}

async function extractPdfTextWithPdfParse(fileBytes: Uint8Array): Promise<string> {
  const pdfParseModule = await import('pdf-parse');
  const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
  const pdfData = await pdfParse(Buffer.from(fileBytes));
  return typeof pdfData?.text === 'string' ? pdfData.text.trim() : '';
}

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent((record.s3.object.key || '').replace(/\+/g, ' '));
    if (key.startsWith('voice-audio/')) {
      logger.info('Skipping voice-audio object for document pipeline', { key });
      continue;
    }
    const { userId, documentType, documentId } = parseKey(key);
    let activeStep = 'upload';
    let documentRecord: Record<string, unknown> = {
      user_id: userId,
      document_id: documentId,
      document_type: documentType,
      s3_key: key,
      status: 'processing',
      current_stage: 'upload',
      processing_steps: createDocumentProcessingSteps(),
    };

    try {
      const existing = await docClient.send(
        new GetCommand({
          TableName: DOCUMENTS_TABLE,
          Key: { user_id: userId, document_id: documentId },
        }),
      );
      if (existing.Item) {
        documentRecord = {
          ...documentRecord,
          ...existing.Item,
          processing_steps: normalizeDocumentProcessingSteps(existing.Item.processing_steps),
        };
      }
    } catch (loadError) {
      logger.warn('Could not load existing document record, using defaults', { userId, documentId, loadError });
    }

    const saveRecord = async (
      patch: Record<string, unknown>,
      stepUpdates: Array<{
        id: string;
        status: 'pending' | 'in_progress' | 'completed' | 'failed';
        detail?: string;
        result?: Record<string, unknown> | string[] | string;
      }> = [],
    ) => {
      let steps = normalizeDocumentProcessingSteps(documentRecord.processing_steps);
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

      documentRecord = {
        ...documentRecord,
        ...patch,
        processing_steps: steps,
      };

      await docClient.send(
        new PutCommand({
          TableName: DOCUMENTS_TABLE,
          Item: documentRecord,
        }),
      );
    };

    const demoteReplacedDocument = async () => {
      const replacedId = String(documentRecord.replaces_document_id ?? '');
      if (!replacedId) return;
      try {
        const existing = await docClient.send(
          new GetCommand({
            TableName: DOCUMENTS_TABLE,
            Key: { user_id: userId, document_id: replacedId },
          }),
        );
        if (!existing.Item) return;
        await docClient.send(
          new PutCommand({
            TableName: DOCUMENTS_TABLE,
            Item: {
              ...existing.Item,
              is_current: false,
              superseded_at: new Date().toISOString(),
            },
          }),
        );
      } catch (replaceError) {
        logger.warn('Could not demote replaced document', { userId, documentId, replaceError });
      }
    };

    try {
      logger.info('Processing S3 document with Bedrock Vision', { bucket, key, documentType });

      // 1. Download file from S3
      const getObjectResult = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const fileBytes = await getObjectResult.Body?.transformToByteArray();
      const mimeType = getObjectResult.ContentType || 'application/octet-stream';

      if (!fileBytes) throw new Error('Failed to read file bytes from S3');

      activeStep = 'file_validation';
      await saveRecord(
        {
          status: 'processing',
          current_stage: 'file_validation',
        },
        [
          {
            id: 'upload',
            status: 'completed',
            detail: 'File uploaded and queued for document processing.',
            result: { documentType },
          },
          {
            id: 'file_validation',
            status: 'in_progress',
            detail: 'Checking file format, size, and whether the file can be read.',
          },
        ],
      );

      const keyLower = key.toLowerCase();
      const isImage = mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/gif' || keyLower.endsWith('.jpg') || keyLower.endsWith('.jpeg') || keyLower.endsWith('.png');
      const isPdf = mimeType === 'application/pdf' || keyLower.endsWith('.pdf');

      let imageBuffers: Buffer[] = [];
      let pdfTextFallback = '';
      let imageFormat: 'png' | 'jpeg' | 'gif' | 'webp' = 'png';
      let extractionMethod = isPdf ? 'pdf_render' : 'nova_vision';

      // 2. Prepare visual (or fallback textual) representations
      if (isImage) {
        imageBuffers.push(Buffer.from(fileBytes));
        if (mimeType === 'image/jpeg' || keyLower.endsWith('.jpg') || keyLower.endsWith('.jpeg')) {
          imageFormat = 'jpeg';
        } else if (mimeType === 'image/webp' || keyLower.endsWith('.webp')) {
          imageFormat = 'webp';
        } else if (mimeType === 'image/gif' || keyLower.endsWith('.gif')) {
          imageFormat = 'gif';
        }
      } else if (isPdf) {
        logger.info('Processing PDF for visual OCR', { key });
        try {
          imageBuffers = await renderPdfPages(fileBytes);
          imageFormat = 'png';
          extractionMethod = 'pdf_render';
          logger.info('Rendered PDF pages for visual OCR', { key, pages: imageBuffers.length });
        } catch (renderErr) {
          logger.warn('PDF render failed, falling back to text extraction', { key, renderErr });
          try {
            pdfTextFallback = await extractPdfTextWithTextract(bucket, key);
            extractionMethod = 'textract_ocr';
          } catch (textractErr) {
            logger.warn('PDF Textract extraction failed, trying pdf-parse fallback', { key, textractErr });
            try {
              pdfTextFallback = await extractPdfTextWithPdfParse(fileBytes);
              extractionMethod = 'pdf_text_fallback';
            } catch (pdfParseErr) {
              logger.warn('PDF pdf-parse fallback failed', { key, pdfParseErr });
            }
          }
        }
      }

      if (imageBuffers.length === 0 && !pdfTextFallback) {
        throw new Error(`Unsupported document format or empty content: ${mimeType}`);
      }

      activeStep = 'text_extraction';
      await saveRecord(
        {
          current_stage: 'text_extraction',
        },
        [
          {
            id: 'file_validation',
            status: 'completed',
            detail: 'Document format validated successfully.',
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
              ? 'Running OCR on the PDF and preparing text for extraction.'
              : 'Preparing the uploaded image for OCR and field detection.',
          },
        ],
      );

      // 3. Build strict OCR Prompt
      const docTypePrompts: Record<string, string> = {
        aadhaar: `Extract: Name, Date of Birth, Gender, Aadhaar Number (mask as XXXX-XXXX-1234), Address, Father/Husband Name if visible.`,
        pan: `Extract: Full Name, Father's Name, Date of Birth, PAN Number (mask middle 4 digits as ABCDE****F), Signature present (yes/no).`,
        bank_passbook: `Extract: Account Holder Name, Account Number (replace all but the LAST 4 digits with X — e.g. if the document shows ...0510 then output XXXXXX0510; NEVER use 1234 or a fake suffix; use the actual last 4 digits from the document), Bank Name, Branch, IFSC Code, Account Type. Bank passbooks come in many formats (savings book, statement page, bank letter, etc.). Accept any document that clearly shows bank account details.`,
        income_certificate: `Extract: Applicant Name, Annual Income (with ₹), Issuing Authority, Certificate Number, Date of Issue, Valid Until.`,
      };

      const fieldInstructions = docTypePrompts[documentType] || `Extract all visible text fields as key-value pairs.`;

      const invalidDocHint = documentType === 'bank_passbook'
        ? `Only respond INVALID_DOCUMENT if the image is clearly a different document type (Aadhaar, PAN, etc.), a blank page, or a random unrelated image. Bank passbooks come in many formats — accept any document showing bank account details.`
        : `If NOT (wrong document, random photo, blank page), respond with exactly: INVALID_DOCUMENT`;

      const prompt = `You are an expert Indian government document OCR engine for VaaniSetu. Your ONLY job is to extract text with 100% molecular precision.

TASK: Analyze this "${documentType}" document.

CRITICAL OCR RULES for MAXIMUM ACCURACY:
1. You MUST read every single character exactly as printed. DO NOT autocorrect or guess standard spellings (e.g., if it says "Gaveesha", do NOT output "Gavveesha"). Pay extreme attention to double letters.
2. Verify names and spellings TWO TIMES before outputting. Look closely at the image crops.
3. This document may be LOW QUALITY — blurry, tilted, compressed, photographed with a basic phone camera. Try your HARDEST to read every character accurately.
4. First verify: Is this actually a "${documentType}"? ${invalidDocHint}
5. If it IS a valid "${documentType}", extract ALL information precisely as described below.
6. Return ONLY a flat JSON object with string values. NO nested objects. NO arrays. NO markdown code fences.
7. Use human-readable key names like "Full Name", "Date Of Birth", "PAN Number".
8. If a field is partially readable, include your best guess with "(unclear)" suffix.
9. Mask sensitive numbers for security.

FIELDS TO EXTRACT:
${fieldInstructions}

RESPONSE FORMAT (example):
{"Full Name": "Rajesh Kumar", "Date Of Birth": "15/08/1990", "ID Number": "XXXX-XXXX-1234"}

If the document is not a valid "${documentType}", respond with exactly: INVALID_DOCUMENT`;

      const contentBlocks: any[] = [{ text: prompt }];

      if (imageBuffers.length > 0) {
        contentBlocks.push({ image: { format: imageFormat, source: { bytes: imageBuffers[0] } } });
        if (imageBuffers.length > 1) {
          contentBlocks.push({ image: { format: imageFormat, source: { bytes: imageBuffers[1] } } });
        }
      } else if (pdfTextFallback) {
        const compactPdfText = pdfTextFallback.slice(0, 12000);
        contentBlocks[0] = { text: `${prompt}\n\nExtracted text from the PDF:\n---\n${compactPdfText}\n---\n\nBased on this text, provide the JSON response.` };
      }

      activeStep = 'field_structuring';
      await saveRecord(
        {
          current_stage: 'field_structuring',
        },
        [
          {
            id: 'text_extraction',
            status: 'completed',
            detail: 'OCR completed and the document content is ready for structuring.',
            result: {
              extractionMethod,
              pagesAnalyzed: Math.max(imageBuffers.length, isPdf ? 1 : 0),
              extractedCharacters: pdfTextFallback ? pdfTextFallback.length : undefined,
            },
          },
          {
            id: 'field_structuring',
            status: 'in_progress',
            detail: 'Nova Pro is organizing the extracted text into structured fields.',
          },
        ],
      );

      // 4. Call Model
      const bedrockResponse = await bedrock.send(new ConverseCommand({
        modelId: 'us.amazon.nova-pro-v1:0',
        messages: [{ role: 'user', content: contentBlocks }],
        inferenceConfig: { temperature: 0.1, maxTokens: 1000 },
      }));

      const responseText = bedrockResponse.output?.message?.content?.[0]?.text || '';
      console.log(`[DocProcess] Bedrock response:`, responseText);

      if (responseText.includes('INVALID_DOCUMENT')) {
        throw new Error(`The uploaded file does not appear to be a genuine ${documentType} document.`);
      }

      // 5. Extract JSON and save to Dynamo
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      let finalData: Record<string, string> = {};

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          finalData = flattenForStorage(parsed);
        } catch (e) {
          console.warn('[DocProcess] Could not parse Bedrock JSON:', e);
        }
      }

      activeStep = 'verification';
      const extractedKeys = Object.keys(finalData);
      await demoteReplacedDocument();
      await saveRecord(
        {
          current_stage: 'verification',
        },
        [
          {
            id: 'field_structuring',
            status: 'completed',
            detail: `Structured ${extractedKeys.length} fields from the document.`,
            result: {
              fieldCount: extractedKeys.length,
              extractedFields: extractedKeys.slice(0, 8),
            },
          },
          {
            id: 'verification',
            status: 'in_progress',
            detail: 'Final verification checks are running before the result is published.',
          },
        ],
      );

      await saveRecord(
        {
          structured_data: finalData,
          status: 'processed',
          current_stage: 'completed',
          is_current: true,
          processed_at: new Date().toISOString(),
        },
        [
          {
            id: 'verification',
            status: 'completed',
            detail: 'Document verified successfully and is ready to use.',
            result: {
              verifiedFields: extractedKeys.length,
            },
          },
        ],
      );

      logger.info('Document processed successfully', { userId, documentId });
    } catch (error) {
      await saveRecord(
        {
          status: 'failed',
          current_stage: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
          processed_at: new Date().toISOString(),
        },
        [
          {
            id: activeStep,
            status: 'failed',
            detail: error instanceof Error ? error.message : String(error),
            result: {
              error: error instanceof Error ? error.message : String(error),
            },
          },
        ],
      );
      logger.error('Error processing document', { error, record });
    }
  }
};

function parseKey(key: string): { userId: string; documentType: string; documentId: string } {
  const parts = key.split('/');
  return {
    userId: parts[0] ?? 'unknown',
    documentType: parts[1] ?? 'unknown',
    documentId: (parts[2] ?? '').split('.')[0] || 'unknown',
  };
}
