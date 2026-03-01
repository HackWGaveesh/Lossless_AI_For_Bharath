import type { APIGatewayProxyHandler } from 'aws-lambda';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';

const bedrockAgent = new BedrockAgentRuntimeClient({ region: 'ap-south-1' });
const bedrockRuntime = new BedrockRuntimeClient({ region: 'us-east-1' });
const MODEL_ID = 'us.amazon.nova-pro-v1:0';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body) ?? 'anonymous';
    const {
      transcript,
      language = 'hi-IN',
      sessionContext = [],
      sessionId = userId || 'anonymous',
    } = body as {
      transcript?: string;
      language?: string;
      sessionContext?: { role: string; content: string }[];
      sessionId?: string;
    };

    if (!transcript?.trim()) {
      return sendErrorResponse(400, 'Missing transcript');
    }

    const agentId = process.env.BEDROCK_AGENT_ID;
    const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';
    const guardrailId = process.env.BEDROCK_GUARDRAIL_ID;

    logger.info('Voice query', { userId, language, hasAgent: !!agentId });

    let responseText = '';
    let agentUsed = false;
    let actionCalled: string | null = null;
    let guardrailApplied = !!guardrailId;

    if (agentId) {
      try {
        const langLabel = getLangLabel(language);
        const enriched = `Language: ${langLabel}. User says: "${transcript}". 
Respond in ${langLabel}. Max 3 concise sentences.`;

        const cmd = new InvokeAgentCommand({
          agentId,
          agentAliasId,
          sessionId: sessionId.slice(0, 50),
          inputText: enriched,
          enableTrace: true,
        });

        const resp = await bedrockAgent.send(cmd);
        if (resp.completion) {
          for await (const ev of resp.completion) {
            if (ev.chunk?.bytes) {
              responseText += Buffer.from(ev.chunk.bytes).toString('utf-8');
            }
            // Extract which action the agent invoked
            if ((ev as any).trace?.trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
              const inp = (ev as any).trace.trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
              actionCalled = inp.function ?? null;
            }
          }
        }
        agentUsed = true;
        logger.info('Agent responded', { actionCalled, responseLength: responseText.length });
      } catch (agentErr: any) {
        logger.warn('Agent failed, using direct model', { error: agentErr.message });
        responseText = await directModelCall(transcript, language, sessionContext, guardrailId);
      }
    } else {
      responseText = await directModelCall(transcript, language, sessionContext, guardrailId);
    }

    if (!responseText) responseText = fallbackReply(transcript, language);

    return sendSuccessResponse({
      responseText,
      language,
      agentUsed,
      agentTrace: actionCalled ? { actionCalled } : null,
      guardrailApplied,
    });
  } catch (err: any) {
    logger.error('Voice query crashed', { error: err.message });
    return sendErrorResponse(500, 'Failed to process voice query');
  }
};

async function directModelCall(
  transcript: string,
  language: string,
  sessionContext: { role: string; content: string }[],
  guardrailId?: string
): Promise<string> {
  const langLabel = getLangLabel(language);
  const systemPrompt = `You are VaaniSetu, helping rural Indian citizens access government services.
Respond in ${langLabel}. Max 2-3 short sentences. Be warm and helpful.`;

  const messages = [
    ...sessionContext.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    })),
    { role: 'user' as const, content: [{ text: transcript }] },
  ];

  const response = await bedrockRuntime.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: { maxTokens: 200, temperature: 0.5 },
    ...(guardrailId ? {
      guardrailConfig: {
        guardrailIdentifier: guardrailId,
        guardrailVersion: '1',
        trace: 'enabled' as const,
      }
    } : {}),
  }));

  return response.output?.message?.content?.[0]?.text?.trim() ?? '';
}

function getLangLabel(language: string): string {
  const map: Record<string, string> = {
    'hi': 'Hindi', 'ta': 'Tamil', 'te': 'Telugu',
    'mr': 'Marathi', 'kn': 'Kannada'
  };
  for (const [k, v] of Object.entries(map)) {
    if (language.startsWith(k)) return v;
  }
  return 'English';
}

function fallbackReply(transcript: string, language: string): string {
  return language.startsWith('hi')
    ? 'मैं आपकी मदद के लिए तैयार हूँ। कृपया Schemes पेज खोलें।'
    : 'I am ready to help. Please open the Schemes page.';
}
