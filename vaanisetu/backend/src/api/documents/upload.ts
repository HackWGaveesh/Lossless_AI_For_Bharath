import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const s3 = new S3Client({ region: process.env.REGION });

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { userId, documentType, fileName, contentType } = body;

    if (!userId || !documentType || !fileName) {
      return sendErrorResponse(400, 'Missing required fields: userId, documentType, fileName');
    }

    const documentId = uuidv4();
    const fileExtension = (fileName as string).split('.').pop() || 'bin';
    const key = `${userId}/${documentType}/${documentId}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET!,
      Key: key,
      ContentType: (contentType as string) || 'image/jpeg',
      Metadata: {
        userId: String(userId),
        documentType: String(documentType),
        documentId,
      },
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

    logger.info('Generated upload URL', { userId, documentId, key });

    return sendSuccessResponse({
      documentId,
      uploadUrl,
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    logger.error('Error generating upload URL', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};
