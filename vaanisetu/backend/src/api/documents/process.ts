import type { S3Handler } from 'aws-lambda';
import { TextractClient, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';

const textract = new TextractClient({ region: process.env.REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const BEDROCK_MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

export const handler: S3Handler = async (event) => {
  for (const record of event.Records) {
    try {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent((record.s3.object.key || '').replace(/\+/g, ' '));

      logger.info('Processing document', { bucket, key });

      const textractResult = await textract.send(new AnalyzeDocumentCommand({
        Document: { S3Object: { Bucket: bucket, Name: key } },
        FeatureTypes: ['FORMS', 'TABLES'],
      }));

      const rawText = extractText(textractResult);

      const structuredData = await structureWithBedrock(rawText, key);

      const parts = key.split('/');
      const userId = parts[0] ?? 'unknown';
      const documentType = parts[1] ?? 'unknown';
      const documentId = (parts[2] ?? '').split('.')[0];

      await docClient.send(new PutCommand({
        TableName: 'vaanisetu-documents',
        Item: {
          user_id: userId,
          document_id: documentId,
          document_type: documentType,
          s3_key: key,
          raw_text: rawText,
          structured_data: structuredData,
          status: 'processed',
          processed_at: new Date().toISOString(),
        },
      }));

      logger.info('Document processed successfully', { userId, documentId });
    } catch (error) {
      logger.error('Error processing document', { error, record });
    }
  }
};

function extractText(textractResult: { Blocks?: { BlockType?: string; Text?: string }[] }): string {
  const blocks = textractResult.Blocks || [];
  return blocks
    .filter((block) => block.BlockType === 'LINE')
    .map((block) => block.Text || '')
    .join('\n');
}

async function structureWithBedrock(rawText: string, key: string): Promise<Record<string, unknown>> {
  const documentType = key.split('/')[1] ?? 'document';

  const prompt = `You are a document parser. Extract structured data from this ${documentType} document:

${rawText}

Return valid JSON only with fields:
- For Aadhaar: name, aadhaar_number, dob, address
- For PAN: name, pan_number, dob
- For bank_passbook: name, account_number, ifsc_code, bank_name
- For other: name, type, key_value_pairs

JSON:`;

  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));

    const responseBody = JSON.parse(Buffer.from(response.body).toString()) as {
      content?: { text?: string }[];
    };
    const content = responseBody.content?.[0]?.text ?? '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    }
  } catch (err) {
    logger.warn('Bedrock structuring failed', { err });
  }

  return {};
}
