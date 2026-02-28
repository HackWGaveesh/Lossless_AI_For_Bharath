import type { S3Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';

const s3 = new S3Client({ region: process.env.REGION });
// Nova models used below are served in us-east-1 for this account setup.
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });
const textract = new TextractClient({ region: process.env.REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent((record.s3.object.key || '').replace(/\+/g, ' '));
    if (key.startsWith('voice-audio/')) {
      logger.info('Skipping voice-audio object for document pipeline', { key });
      continue;
    }
    const { userId, documentType, documentId } = parseKey(key);

    try {
      logger.info('Processing S3 document with Bedrock Vision', { bucket, key, documentType });

      // 1. Download file from S3
      const getObjectResult = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const fileBytes = await getObjectResult.Body?.transformToByteArray();
      const mimeType = getObjectResult.ContentType || 'application/octet-stream';

      if (!fileBytes) throw new Error('Failed to read file bytes from S3');

      const keyLower = key.toLowerCase();
      const isImage = mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp' || mimeType === 'image/gif' || keyLower.endsWith('.jpg') || keyLower.endsWith('.jpeg') || keyLower.endsWith('.png');
      const isPdf = mimeType === 'application/pdf' || keyLower.endsWith('.pdf');

      let imageBuffers: Buffer[] = [];
      let pdfTextFallback = '';

      // 2. Prepare visual (or fallback textual) representations
      if (isImage) {
        imageBuffers.push(Buffer.from(fileBytes));
      } else if (isPdf) {
        logger.info('Processing PDF with Textract OCR', { key });
        try {
          pdfTextFallback = await extractPdfTextWithTextract(bucket, key);
        } catch (pdfErr) {
          logger.warn('PDF Textract extraction failed', { key, pdfErr });
        }
      }

      if (imageBuffers.length === 0 && !pdfTextFallback) {
        throw new Error(`Unsupported document format or empty content: ${mimeType}`);
      }

      // 3. Build strict OCR Prompt
      const docTypePrompts: Record<string, string> = {
        aadhaar: `Extract: Name, Date of Birth, Gender, Aadhaar Number (mask as XXXX-XXXX-1234), Address, Father/Husband Name if visible.`,
        pan: `Extract: Full Name, Father's Name, Date of Birth, PAN Number (mask middle 4 digits as ABCDE****F), Signature present (yes/no).`,
        bank_passbook: `Extract: Account Holder Name, Account Number (mask as XXXXXX1234), Bank Name, Branch, IFSC Code, Account Type.`,
        income_certificate: `Extract: Applicant Name, Annual Income (with ₹), Issuing Authority, Certificate Number, Date of Issue, Valid Until.`,
      };

      const fieldInstructions = docTypePrompts[documentType] || `Extract all visible text fields as key-value pairs.`;

      const prompt = `You are an expert Indian government document OCR engine for VaaniSetu. Your ONLY job is to extract text with 100% molecular precision.

TASK: Analyze this "${documentType}" document.

CRITICAL OCR RULES for MAXIMUM ACCURACY:
1. You MUST read every single character exactly as printed. DO NOT autocorrect or guess standard spellings (e.g., if it says "Gaveesha", do NOT output "Gavveesha"). Pay extreme attention to double letters.
2. Verify names and spellings TWO TIMES before outputting. Look closely at the image crops.
3. This document may be LOW QUALITY — blurry, tilted, compressed, photographed with a basic phone camera. Try your HARDEST to read every character accurately.
4. First verify: Is this actually a "${documentType}"? If NOT (wrong document, random photo, blank page), respond with exactly: INVALID_DOCUMENT
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
        contentBlocks.push({ image: { format: 'png', source: { bytes: imageBuffers[0] } } });
        if (imageBuffers.length > 1) {
          contentBlocks.push({ image: { format: 'png', source: { bytes: imageBuffers[1] } } });
        }
      } else if (pdfTextFallback) {
        const compactPdfText = pdfTextFallback.slice(0, 12000);
        contentBlocks[0] = { text: `${prompt}\n\nExtracted text from the PDF:\n---\n${compactPdfText}\n---\n\nBased on this text, provide the JSON response.` };
      }

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

      await docClient.send(new PutCommand({
        TableName: process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents',
        Item: {
          user_id: userId,
          document_id: documentId,
          document_type: documentType,
          s3_key: key,
          structured_data: finalData,
          status: 'processed',
          processed_at: new Date().toISOString(),
        },
      }));

      logger.info('Document processed successfully', { userId, documentId });
    } catch (error) {
      await docClient.send(new PutCommand({
        TableName: process.env.DOCUMENTS_TABLE ?? 'vaanisetu-documents',
        Item: {
          user_id: userId,
          document_id: documentId,
          document_type: documentType,
          s3_key: key,
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
          processed_at: new Date().toISOString(),
        },
      }));
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
