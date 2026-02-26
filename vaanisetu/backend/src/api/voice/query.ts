import type { APIGatewayProxyHandler } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });
const MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const userId = event.requestContext?.authorizer?.claims?.sub ?? 'anonymous';
    const body = JSON.parse(event.body ?? '{}');
    const { transcript, language = 'hi-IN', sessionContext = [] } = body as {
      transcript?: string;
      language?: string;
      sessionContext?: { role: string; content: string }[];
    };

    if (!transcript?.trim()) {
      return sendErrorResponse(400, 'Missing transcript');
    }

    logger.info('Voice query', { userId, language, transcriptLength: transcript.length });

    const langLabel = language.startsWith('hi') ? 'Hindi' : language.startsWith('ta') ? 'Tamil' : language.startsWith('te') ? 'Telugu' : 'English';
    const contextBlock = sessionContext.length
      ? `Previous conversation:\n${sessionContext.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\n`
      : '';

    const systemPrompt = `You are VaaniSetu, a helpful voice assistant for rural Indian citizens. You help users with government schemes (PM-KISAN, MUDRA, Ayushman Bharat, etc.), document requirements, application status, and jobs. Respond in ${langLabel}. Be concise (2-4 sentences) for voice. Use simple language. If they ask about eligibility, suggest they use the Eligibility Calculator.`;

    const userPrompt = `${contextBlock}User said (in ${langLabel}): "${transcript}"\n\nRespond helpfully in ${langLabel}:`;

    const response = await bedrock.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      })
    );

    const parsed = JSON.parse(Buffer.from(response.body).toString()) as { content?: { text?: string }[] };
    const text = parsed.content?.[0]?.text?.trim() ?? 'Sorry, I could not generate a response.';

    return sendSuccessResponse({
      responseText: text,
      language,
    });
  } catch (error) {
    logger.error('Voice query error', { error });
    return sendErrorResponse(500, 'Failed to process voice query');
  }
};
