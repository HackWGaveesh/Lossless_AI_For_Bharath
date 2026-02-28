import type { APIGatewayProxyHandler } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  type LanguageCode,
} from '@aws-sdk/client-transcribe';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';

const s3 = new S3Client({ region: process.env.REGION });
const transcribe = new TranscribeClient({ region: process.env.REGION });

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

function mapLanguageCode(language?: string): LanguageCode {
  if (!language) return 'en-IN';
  if (language.startsWith('hi')) return 'hi-IN';
  if (language.startsWith('ta')) return 'ta-IN';
  if (language.startsWith('te')) return 'te-IN';
  if (language.startsWith('mr')) return 'mr-IN';
  if (language.startsWith('kn')) return 'kn-IN';
  return 'en-IN';
}

function mapMediaFormat(mimeType?: string): 'webm' | 'mp4' | 'wav' | 'ogg' {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'wav';
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body) ?? 'anonymous';
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
    const language = typeof body.language === 'string' ? body.language : 'en-IN';

    if (!audioBase64) return sendErrorResponse(400, 'Missing audio payload');

    const bucket = process.env.DOCUMENTS_BUCKET;
    if (!bucket) return sendErrorResponse(500, 'Voice storage bucket is not configured');

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    if (!audioBuffer.length) return sendErrorResponse(400, 'Invalid audio payload');
    if (audioBuffer.length > MAX_AUDIO_BYTES) return sendErrorResponse(400, 'Audio too large');

    const mediaFormat = mapMediaFormat(mimeType);
    const langCode = mapLanguageCode(language);
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const audioKey = `voice-audio/${userId}/${ts}-${rand}.${mediaFormat}`;
    const jobName = `vaani-${ts}-${rand}`.replace(/[^a-zA-Z0-9-]/g, '');

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: audioKey,
      Body: audioBuffer,
      ContentType: mimeType,
      Metadata: { userId: String(userId) },
    }));

    await transcribe.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: langCode,
      MediaFormat: mediaFormat,
      Media: { MediaFileUri: `s3://${bucket}/${audioKey}` },
    }));

    let transcriptUri = '';
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const statusRes = await transcribe.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
      const job = statusRes.TranscriptionJob;
      const status = job?.TranscriptionJobStatus;
      if (status === 'COMPLETED') {
        transcriptUri = job?.Transcript?.TranscriptFileUri ?? '';
        break;
      }
      if (status === 'FAILED') {
        const reason = job?.FailureReason ?? 'Transcription failed';
        logger.warn('Transcribe failed', { reason, jobName, userId });
        return sendErrorResponse(500, reason);
      }
    }

    if (!transcriptUri) {
      return sendErrorResponse(504, 'Transcription timed out');
    }

    const transcriptRes = await fetch(transcriptUri);
    if (!transcriptRes.ok) {
      return sendErrorResponse(500, 'Could not fetch transcript');
    }
    const payload = await transcriptRes.json() as { results?: { transcripts?: { transcript?: string }[] } };
    const transcript = payload.results?.transcripts?.[0]?.transcript?.trim() ?? '';

    return sendSuccessResponse({ transcript, language: langCode });
  } catch (error) {
    logger.error('Voice transcription error', { error });
    return sendErrorResponse(500, 'Failed to transcribe audio');
  }
};
