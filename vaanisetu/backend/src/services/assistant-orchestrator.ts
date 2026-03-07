import crypto from 'crypto';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger.js';
import { safeGenerateResponse } from './novapro-orchestrator.js';
import { loadSession, appendTurn } from './session-service.js';
import { deriveAssistantState, confirmIntentConfidence, type AssistantState } from './assistant-state-machine.js';
import { getRuntimeBudgetMode } from './runtime-config-service.js';
import { callTool } from './tool-router.js';
import { getLangLabel } from './language-service.js';
import { detectWorkflowIntent, normalizeText, detectLanguageHint, type WorkflowIntent } from './intent-detection.js';
import type {
  ConversationRequest,
  ConversationResponse,
} from '../types/conversation.js';

// Agent in us-east-1 where Nova Pro is natively available
const bedrockAgent = new BedrockAgentRuntimeClient({ region: 'us-east-1' });
const bedrockRuntime = new BedrockRuntimeClient({ region: 'us-east-1' });
const MODEL_ID = 'us.amazon.nova-pro-v1:0';
const AGENT_TRACE_ENABLED = process.env.BEDROCK_AGENT_ENABLE_TRACE === 'true';
const AGENT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.BEDROCK_AGENT_TIMEOUT_MS ?? 55000);
  return Number.isFinite(raw) && raw > 0 ? raw : 55000;
})();

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION || 'ap-south-1' }),
);
const USERS_TABLE = process.env.USERS_TABLE || 'vaanisetu-users';

type SessionTurn = { role: string; content: string };

type ApplyFlowResult = {
  responseText: string;
  actionCalled: string | null;
  applicationSubmitted?: boolean;
  applicationId?: string;
  pendingConfirmation?: Record<string, any> | null;
  pendingAction?: Record<string, any> | null;
  cards?: Array<Record<string, any>>;
  execution?: Record<string, any> | null;
  actionResultType?: string | null;
  matchReasons?: string[];
  serviceTrace?: Record<string, any> | null;
  grounding?: { sources: string[] };
  stateHint?: AssistantState;
};

export async function handleConversation(req: ConversationRequest): Promise<ConversationResponse> {
  const {
    userId,
    sessionId,
    transcript,
    language,
    sessionContext,
    idempotencyKey = '',
    channel,
    forceLanguage = '',
    confirmationToken = '',
  } = req;

  const session = await loadSession(sessionId, userId);
  const persistedTurns = Array.isArray(session.turns)
    ? session.turns.map((t) => ({ role: t.role, content: t.content })).filter((t) => !!t.content)
    : [];
  const mergedSessionContext = dedupeSessionContext([
    ...persistedTurns,
    ...sessionContext,
  ]).slice(-20);
  const activeConfirmationToken = confirmationToken || String(session.pendingConfirmation?.confirmationToken || '');
  const budgetMode = await getRuntimeBudgetMode();

  const applyFlowResult = await maybeHandleStructuredWorkflow({
    transcript,
    language,
    userId,
    sessionContext: mergedSessionContext,
    idempotencyKey,
    channel,
    forceLanguage,
    confirmationToken: activeConfirmationToken,
    sessionPendingConfirmation: session.pendingConfirmation ?? null,
    currentState: (session.assistantState?.state as AssistantState | undefined) || 'IDLE',
  });

  if (applyFlowResult) {
    const nextState = deriveAssistantState({
      current: session.assistantState ?? null,
      intent: String(applyFlowResult.execution?.intent || ''),
      actionResultType: applyFlowResult.actionResultType || '',
      pendingType: String(applyFlowResult.pendingAction?.type || applyFlowResult.pendingConfirmation?.type || ''),
    });
    const updatedSession = await appendTurn(
      session,
      transcript,
      applyFlowResult.responseText,
      applyFlowResult.pendingConfirmation === undefined
        ? session.pendingConfirmation
        : applyFlowResult.pendingConfirmation,
      nextState,
    );
    const messages = toAssistantMessages(updatedSession.turns);
    const execution = {
      ...(applyFlowResult.execution ?? {}),
      state: nextState.state,
    };

    return {
      responseText: applyFlowResult.responseText,
      language: forceLanguage || language,
      agentUsed: false,
      responseMode: 'workflow',
      applicationSubmitted: !!applyFlowResult.applicationSubmitted,
      applicationId: applyFlowResult.applicationId ?? null,
      pendingConfirmation: applyFlowResult.pendingConfirmation ?? null,
      pendingAction: applyFlowResult.pendingAction ?? applyFlowResult.pendingConfirmation ?? null,
      cards: applyFlowResult.cards ?? [],
      execution,
      actionResultType: applyFlowResult.actionResultType ?? null,
      matchReasons: applyFlowResult.matchReasons ?? [],
      grounding: applyFlowResult.grounding ?? { sources: ['deterministic_tools'] },
      messages,
      agentTrace: applyFlowResult.actionCalled ? { actionCalled: applyFlowResult.actionCalled, agentUsed: false } : null,
      guardrailApplied: false,
      serviceTrace: applyFlowResult.serviceTrace ?? null,
      budgetMode,
    };
  }

  if (budgetMode === 'strict') {
    const strictText =
      'I can currently run only grounded workflow actions due to cost-safe mode. Please ask for scheme lookup, apply, status, jobs, profile, or language update.';
    const strictState = deriveAssistantState({
      current: session.assistantState ?? null,
      intent: '',
      actionResultType: 'budget_guardrail',
    });
    const strictSession = await appendTurn(session, transcript, strictText, session.pendingConfirmation, strictState);
    return {
      responseText: strictText,
      language: forceLanguage || language,
      agentUsed: false,
      responseMode: 'workflow',
      applicationSubmitted: false,
      applicationId: null,
      pendingConfirmation: null,
      pendingAction: null,
      cards: [],
      execution: { state: strictState.state, intent: 'none', steps: ['budget_guardrail'] },
      actionResultType: 'budget_guardrail',
      grounding: { sources: ['budget_guardrail'] },
      messages: toAssistantMessages(strictSession.turns),
      agentTrace: null,
      guardrailApplied: false,
      serviceTrace: null,
      budgetMode,
      matchReasons: [],
    };
  }

  const agentId = process.env.BEDROCK_AGENT_ID;
  const agentAliases = getAgentAliases();

  logger.info('Voice conversation', {
    userId,
    language,
    hasAgent: !!agentId,
    agentId,
    agentAliases,
    agentTraceEnabled: AGENT_TRACE_ENABLED,
    agentTimeoutMs: AGENT_TIMEOUT_MS,
    channel,
  });

  let responseText = '';
  let agentUsed = false;
  let responseMode: 'agent' | 'direct_model' = 'direct_model';
  let actionCalled: string | null = null;

  if (agentId) {
    const langLabel = getLangLabel(language);
    const enriched = `Language: ${langLabel}.
Authenticated user id: ${userId}.
If user asks to apply but scheme is unclear (for example "PM yojna"), first ask which exact scheme and do not submit yet.
User says: ${transcript}`;
    let lastAgentErr: Error | null = null;

    for (const agentAliasId of agentAliases) {
      try {
        const result = await invokeAgentWithAlias({
          agentId,
          agentAliasId,
          sessionId: sessionId.slice(0, 50),
          inputText: enriched,
          userId,
          language: langLabel,
        });
        responseText = result.responseText;
        actionCalled = result.actionCalled;
        agentUsed = true;
        responseMode = 'agent';
        logger.info('Agent responded', { agentAliasId, actionCalled, responseLength: responseText.length });
        break;
      } catch (agentErr: any) {
        const wrapped = agentErr instanceof Error ? agentErr : new Error(String(agentErr));
        lastAgentErr = wrapped;
        logger.warn('Agent alias failed', { agentAliasId, error: wrapped.message });
      }
    }

    if (!agentUsed) {
      logger.warn('All agent aliases failed, falling back to direct Nova Pro', { error: lastAgentErr?.message });
      responseText = await safeDirectModelCall(transcript, language, mergedSessionContext);
      responseMode = 'direct_model';
    }
  } else {
    responseText = await safeDirectModelCall(transcript, language, mergedSessionContext);
    responseMode = 'direct_model';
  }

  if (!responseText) {
    if (agentUsed) {
      logger.warn('Agent returned empty response, falling back to direct Nova Pro');
      agentUsed = false;
      responseMode = 'direct_model';
      actionCalled = null;
    }
    responseText = await safeDirectModelCall(transcript, language, mergedSessionContext);
  }

  const nextState = deriveAssistantState({
    current: session.assistantState ?? null,
    intent: '',
    actionResultType: '',
    pendingType: String(session.pendingConfirmation?.type || ''),
  });
  const nonWorkflowSession = await appendTurn(session, transcript, responseText, session.pendingConfirmation, nextState);

  return {
    responseText,
    language: forceLanguage || language,
    agentUsed,
    responseMode,
    messages: toAssistantMessages(nonWorkflowSession.turns),
    pendingAction: session.pendingConfirmation ?? null,
    cards: [],
    grounding: { sources: ['conversational_model'] },
    execution: { state: nextState.state, intent: 'none', steps: ['conversational_model'] },
    agentTrace: actionCalled ? { actionCalled, agentUsed: true } : null,
    guardrailApplied: false,
    serviceTrace: null,
    matchReasons: [],
    budgetMode,
    applicationSubmitted: false,
    applicationId: null,
    pendingConfirmation: null,
    actionResultType: null,
  };
}

async function maybeHandleStructuredWorkflow(args: {
  transcript: string;
  language: string;
  userId: string;
  sessionContext: SessionTurn[];
  idempotencyKey: string;
  channel: string;
  forceLanguage: string;
  confirmationToken: string;
  sessionPendingConfirmation?: Record<string, any> | null;
  currentState?: AssistantState;
}): Promise<ApplyFlowResult | null> {
  const {
    transcript,
    language,
    userId,
    sessionContext,
    idempotencyKey,
    confirmationToken,
    sessionPendingConfirmation,
    currentState = 'IDLE',
  } = args;
  const normalized = normalizeText(transcript);

  // ── Auto-detect language from transcript script ─────────────────────────
  // Only override the stored language preference when the user actually types in a non-Latin script
  // (Devanagari, Tamil, Telugu, Kannada). If they type in English but have e.g. Hindi set as their
  // language, we keep their stored preference so the response comes back in their chosen language.
  const detectedLangHint = detectLanguageHint(transcript);
  const effectiveLanguage = detectedLangHint
    ? `${detectedLangHint}-IN`
    : (args.forceLanguage || language || 'en-IN');

  let intent = detectWorkflowIntent(normalized);
  if (intent === 'none' && sessionPendingConfirmation?.type === 'apply_field_confirmation') {
    intent = 'apply';
  }
  if (
    intent === 'none'
    && sessionPendingConfirmation?.type === 'application_confirm'
    && (/\b(yes|confirm|haan|haanji|proceed|ho|theek hai|bilkul|zaroor|accha|seri|avunu)\b/.test(normalized)
      || /சரி|அவுனு|ஆமாம்/.test(transcript)
      || /అవును|సరే|ఓకే/.test(transcript)
      || /ಹೌದು|ಸರಿ|ಓಕೆ/.test(transcript)
      || /हो|ठीक है|हाँ|बिल्कुल/.test(transcript))
  ) {
    intent = 'apply';
  }
  if (
    intent === 'none'
    && sessionPendingConfirmation?.type === 'job_confirm'
    && (/\b(yes|confirm|haan|haanji|proceed|ho|theek hai|bilkul|zaroor|accha|seri|avunu)\b/.test(normalized)
      || /சரி|அவுனு|ஆமாம்/.test(transcript)
      || /అవును|సరే|ఓకే/.test(transcript)
      || /ಹೌದು|ಸರಿ|ಓಕೆ/.test(transcript)
      || /हो|ठीक है|हाँ|बिल्कुल/.test(transcript))
  ) {
    intent = 'apply';
  }
  if (intent === 'none') {
    const patch = parseProfilePatchFromTranscript(transcript);
    if (Object.keys(patch).length > 0) {
      intent = 'profile_update';
    } else {
      // Last-resort: ask Nova Pro to classify
      try {
        const classifyRes = await bedrockRuntime.send(new ConverseCommand({
          modelId: MODEL_ID,
          messages: [{
            role: 'user',
            content: [{ text: `Classify this message into exactly one word from: schemes, apply, apply_for_job, status, jobs, documents, profile, other\nMessage: "${transcript.slice(0, 200)}"\nReply with ONE word only, no punctuation.` }],
          }],
          inferenceConfig: { maxTokens: 5, temperature: 0 },
        }));
        const cls = (classifyRes.output?.message?.content?.[0]?.text || '').trim().toLowerCase();
        if (cls === 'schemes') intent = 'schemes';
        else if (cls === 'apply') intent = 'apply';
        else if (cls === 'apply_for_job') intent = 'apply_for_job';
        else if (cls === 'status') intent = 'status';
        else if (cls === 'jobs') intent = 'jobs';
        else if (cls === 'documents') intent = 'documents';
        else if (cls === 'profile') intent = 'profile_update';
      } catch {
        // classification failed, fall through to directModelCall
      }
      if (intent === 'none') return null;
    }
  }

  if (intent === 'greeting') {
    const langLabel = getLangLabel(effectiveLanguage);
    const greetingFallbacks: Record<string, string> = {
      Hindi: 'नमस्ते! मैं VaaniSetu हूं। मैं आपको योजनाएं, नौकरियां और आवेदन में मदद कर सकता हूं। आप क्या जानना चाहते हैं?',
      Tamil: 'வணக்கம்! நான் VaaniSetu. திட்டங்கள், வேலைகள் மற்றும் விண்ணப்பங்களில் உதவ முடியும். என்ன தேவை?',
      Telugu: 'నమస్కారం! నేను VaaniSetu. యోజనలు, ఉద్యోగాలు మరియు అప్లికేషన్లలో సహాయం చేయగలను. ఏమి కావాలి?',
      Kannada: 'ನಮಸ್ಕಾರ! ನಾನು VaaniSetu. ಯೋಜನೆಗಳು, ಉದ್ಯೋಗಗಳು ಮತ್ತು ಅರ್ಜಿಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ಏನು ಬೇಕು?',
      Marathi: 'नमस्कार! मी VaaniSetu. योजना, नोकरी आणि अर्जात मदत करू शकतो. काय हवं?',
      English: 'Hello! I\'m VaaniSetu. I can help with schemes, jobs, and applications. What would you like to know?',
    };
    const fallbackText = greetingFallbacks[langLabel] || greetingFallbacks.English;

    // Proactive context: if there's a pending application confirmation, mention it.
    let proactivityContext = 'User is greeting you. Respond warmly and briefly list what you can help with.';
    if (sessionPendingConfirmation?.type === 'application_confirm') {
      const schemeName = (sessionPendingConfirmation.scheme as any)?.nameEn || (sessionPendingConfirmation.scheme as any)?.name || 'the scheme';
      proactivityContext += ` Notice that there is a pending application for ${schemeName}. Briefly ask if they want to continue with that or do something else.`;
    }

    const orchestrated = await safeGenerateResponse(
      { intent: 'general', language: effectiveLanguage, transcript, additionalContext: proactivityContext },
      fallbackText,
    );
    return {
      actionCalled: null,
      responseText: orchestrated.responseText || fallbackText,
      actionResultType: 'greeting',
      serviceTrace: orchestrated.serviceTrace,
      execution: { intent: 'greeting', confidence: 0.95, entities: { detectedLanguage: detectedLangHint }, steps: ['greeting', 'novapro_orchestrator'] },
    };
  }

  const profile = await fetchUserProfile(userId);
  const runAction = async (functionName: string, parameters: Array<{ name: string; value: string }>) => {
    const res = await callTool(
      { userId, language },
      functionName,
      parameters,
    );
    return res.body;
  };

  if (intent === 'status') {
    const appRef = extractApplicationRef(transcript) || extractApplicationRefFromContext(sessionContext);
    if (!appRef) {
      // No specific ref — list all applications for this user
      const summary = await runAction('getUserApplicationsSummary', [
        { name: 'userId', value: userId },
      ]);
      const apps = Array.isArray(summary?.applications) ? summary.applications : [];
      if (!apps.length) {
        const noAppsOrch = await safeGenerateResponse(
          {
            intent: 'status', language: effectiveLanguage, transcript,
            additionalContext: 'User has no applications yet. Encourage them to explore schemes and apply.'
          },
          'You have not submitted any applications yet. Would you like to see schemes you can apply for?'
        );
        return {
          actionCalled: 'getUserApplicationsSummary',
          responseText: noAppsOrch.responseText,
          serviceTrace: noAppsOrch.serviceTrace,
          actionResultType: 'no_applications',
          execution: { intent, confidence: 0.9, steps: ['getUserApplicationsSummary', 'novapro_orchestrator'], tool: 'getUserApplicationsSummary', dataSource: 'dynamodb' },
        };
      }
      const appsContext = apps.slice(0, 5).map((a: any) =>
        `${a.applicationId}: ${a.schemeName || a.schemeCode || 'Unknown scheme'} — ${a.status} (${a.createdAt?.slice(0, 10) || ''})`
      ).join('\n');
      const summaryOrch = await safeGenerateResponse(
        {
          intent: 'status', language: effectiveLanguage, transcript,
          additionalContext: `User's applications:\n${appsContext}\nTotal: ${summary.summary?.total || apps.length}`
        },
        `You have ${apps.length} application(s). Latest: ${apps[0]?.applicationId} — ${apps[0]?.status}.`
      );
      return {
        actionCalled: 'getUserApplicationsSummary',
        responseText: summaryOrch.responseText,
        serviceTrace: summaryOrch.serviceTrace,
        cards: apps.slice(0, 3).map((a: any) => ({
          type: 'application_status',
          applicationRef: a.applicationId,
          status: a.status,
          schemeName: a.schemeName || a.schemeCode,
        })),
        grounding: { sources: ['applications_table'] },
        actionResultType: 'status_list',
        execution: { intent, confidence: 0.9, steps: ['getUserApplicationsSummary', 'novapro_orchestrator'], tool: 'getUserApplicationsSummary', dataSource: 'dynamodb' },
      };
    }
    const parsed = await runAction('getApplicationStatus', [
      { name: 'userId', value: userId },
      { name: 'applicationId', value: appRef },
    ]);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      const statusUnavailFallback = 'I cannot access live status data right now. Please try again shortly.';
      const statusUnavailOrch = await safeGenerateResponse(
        { intent: 'status', language: effectiveLanguage, transcript, additionalContext: 'Status data is temporarily unavailable. Ask user to try again shortly.' },
        statusUnavailFallback,
      );
      return {
        actionCalled: 'getApplicationStatus',
        responseText: statusUnavailOrch.responseText || statusUnavailFallback,
        actionResultType: 'data_unavailable',
        serviceTrace: statusUnavailOrch.serviceTrace,
        execution: {
          intent,
          confidence: 0.98,
          entities: { applicationRef: appRef },
          steps: ['getApplicationStatus', 'data_unavailable', 'novapro_orchestrator'],
          tool: 'getApplicationStatus',
          dataSource: 'applications_table',
        },
      };
    }
    if (parsed?.success === false) {
      return {
        actionCalled: 'getApplicationStatus',
        responseText: parsed.message || 'Unable to fetch application status right now.',
        actionResultType: 'status_error',
        execution: {
          intent,
          confidence: 0.98,
          entities: { applicationRef: appRef },
          steps: ['getApplicationStatus'],
          tool: 'getApplicationStatus',
          dataSource: 'applications_table',
        },
      };
    }
    const statusFallback = `Application ${appRef} is ${parsed.status || 'under_review'}.${parsed.expectedDecision ? ` Expected decision: ${parsed.expectedDecision}.` : ''}`;
    const statusOrch = await safeGenerateResponse(
      {
        intent: 'status',
        language: effectiveLanguage,
        transcript,
        additionalContext: `Application reference: ${appRef}. Status: ${parsed.status || 'under_review'}.${parsed.expectedDecision ? ` Expected decision: ${parsed.expectedDecision}.` : ''} ${parsed.message || ''}`,
      },
      statusFallback,
    );
    return {
      actionCalled: 'getApplicationStatus',
      responseText: statusOrch.responseText || statusFallback,
      cards: [{ type: 'application_status', applicationRef: appRef, status: parsed.status || 'under_review' }],
      grounding: { sources: ['applications_table'] },
      serviceTrace: statusOrch.serviceTrace,
      actionResultType: 'status',
      execution: {
        intent,
        confidence: 0.98,
        entities: { applicationRef: appRef },
        steps: ['getApplicationStatus', 'novapro_orchestrator'],
        tool: 'getApplicationStatus',
        dataSource: 'applications_table',
      },
    };
  }

  if (intent === 'documents') {
    const docId = extractDocumentId(transcript);
    const isVerify = /\b(verify|status|check|approved|processed|rejected)\b/.test(normalized);
    const isUpload = /\b(upload|reupload|attach|submit)\b/.test(normalized);

    if (isVerify && docId) {
      const verify = await runAction('verifyDocument', [
        { name: 'userId', value: userId },
        { name: 'documentId', value: docId },
      ]);
      if (verify?.code === 'DATA_UNAVAILABLE') {
        return {
          actionCalled: 'verifyDocument',
          responseText: 'I cannot access document verification right now. Please try again shortly.',
          actionResultType: 'data_unavailable',
          execution: {
            intent,
            confidence: 0.9,
            entities: { documentId: docId },
            steps: ['verifyDocument', 'data_unavailable'],
          },
        };
      }
      if (!verify?.success) {
        return {
          actionCalled: 'verifyDocument',
          responseText: verify?.message || 'I could not verify this document right now.',
          actionResultType: 'document_verify_error',
          execution: {
            intent,
            confidence: 0.88,
            entities: { documentId: docId },
            steps: ['verifyDocument'],
          },
        };
      }
      return {
        actionCalled: 'verifyDocument',
        responseText: verify?.message || `Document ${docId} status: ${verify?.status || 'processing'}.`,
        cards: [{ type: 'document_status', documentId: docId, status: verify?.status || 'processing' }],
        grounding: { sources: ['documents_table'] },
        actionResultType: 'document_verified',
        execution: {
          intent,
          confidence: 0.91,
          entities: { documentId: docId },
          steps: ['verifyDocument'],
        },
      };
    }

    if (isUpload) {
      const documentType = parseDocumentType(transcript);
      if (!documentType) {
        const orchNoType = await safeGenerateResponse(
          {
            intent: 'documents', language: effectiveLanguage, transcript,
            additionalContext: 'User wants to upload a document but did not specify which one. Ask them which document: PAN, Aadhaar, income certificate, or bank passbook.'
          },
          'Please tell me which document to upload: PAN, Aadhaar, income certificate, or bank passbook.'
        );
        return {
          actionCalled: 'requestDocumentUploadSlot',
          responseText: orchNoType.responseText,
          serviceTrace: orchNoType.serviceTrace,
          actionResultType: 'document_type_required',
          execution: {
            intent,
            confidence: 0.8,
            entities: {},
            steps: ['document_type_parse_failed', 'novapro_orchestrator'],
          },
        };
      }
      const slot = await runAction('requestDocumentUploadSlot', [{ name: 'documentType', value: documentType }]);
      if (!slot?.success) {
        return {
          actionCalled: 'requestDocumentUploadSlot',
          responseText: slot?.message || 'I could not prepare an upload slot right now.',
          actionResultType: 'document_upload_error',
          execution: {
            intent,
            confidence: 0.85,
            entities: { documentType },
            steps: ['requestDocumentUploadSlot'],
          },
        };
      }
      return {
        actionCalled: 'requestDocumentUploadSlot',
        responseText: slot?.message || `Upload slot ready for ${documentType}.`,
        cards: [{ type: 'document_upload', documentType, openPage: '/documents' }],
        grounding: { sources: ['documents_table'] },
        actionResultType: 'document_upload_slot',
        execution: {
          intent,
          confidence: 0.87,
          entities: { documentType },
          steps: ['requestDocumentUploadSlot'],
        },
      };
    }

    const schemeHint =
      extractSchemeHintFromTranscript(transcript)
      || extractSchemeHintFromDocumentQuery(transcript)
      || extractPendingSchemeFromContext(sessionContext);
    if (!schemeHint) {
      const orchNoScheme = await safeGenerateResponse(
        {
          intent: 'documents', language: effectiveLanguage, transcript,
          additionalContext: 'User wants to know required documents but did not specify a scheme. Ask which scheme they are applying for.'
        },
        'Please tell me which scheme you need documents for.'
      );
      return {
        actionCalled: 'getRequiredDocuments',
        responseText: orchNoScheme.responseText,
        serviceTrace: orchNoScheme.serviceTrace,
        actionResultType: 'scheme_required_for_documents',
        execution: {
          intent,
          confidence: 0.82,
          entities: {},
          steps: ['scheme_hint_missing', 'novapro_orchestrator'],
        },
      };
    }
    const docs = await runAction('getRequiredDocuments', [{ name: 'query', value: schemeHint }]);
    if (docs?.code === 'DATA_UNAVAILABLE') {
      return {
        actionCalled: 'getRequiredDocuments',
        responseText: 'I cannot access required document data right now. Please try again shortly.',
        actionResultType: 'data_unavailable',
        execution: {
          intent,
          confidence: 0.85,
          entities: { schemeHint },
          steps: ['getRequiredDocuments', 'data_unavailable'],
        },
      };
    }
    if (!docs?.success) {
      return {
        actionCalled: 'getRequiredDocuments',
        responseText: docs?.message || 'I could not fetch required documents for that scheme.',
        actionResultType: 'document_requirements_error',
        execution: {
          intent,
          confidence: 0.85,
          entities: { schemeHint },
          steps: ['getRequiredDocuments'],
        },
      };
    }
    const missing = Array.isArray(docs?.missingDocuments) ? docs.missingDocuments : [];
    const required = Array.isArray(docs?.requiredDocuments) ? docs.requiredDocuments : [];
    const docsOrch = await safeGenerateResponse(
      {
        intent: 'documents', language: effectiveLanguage, transcript,
        additionalContext: missing.length
          ? `Missing documents for ${schemeHint}: ${missing.join(', ')}. All required: ${required.join(', ')}.`
          : `All required documents for ${schemeHint} are already uploaded.`
      },
      missing.length ? `Missing: ${missing.join(', ')}.` : 'All documents ready.'
    );
    return {
      actionCalled: 'getRequiredDocuments',
      responseText: docsOrch.responseText,
      serviceTrace: docsOrch.serviceTrace,
      cards: [
        ...missing.map((d: string) => ({ type: 'document_upload', documentType: d, openPage: '/documents' })),
        { type: 'document_requirements', requiredDocuments: required, missingDocuments: missing, schemeHint },
      ],
      grounding: { sources: ['documents_table', 'schemes_table'] },
      actionResultType: missing.length ? 'document_requirements_missing' : 'document_requirements_ready',
      execution: {
        intent,
        confidence: 0.87,
        entities: { schemeHint, missingCount: missing.length },
        steps: ['getRequiredDocuments', 'novapro_orchestrator'],
      },
    };
  }

  if (intent === 'language_update') {
    const preferred = parsePreferredLanguage(normalized);
    if (!preferred) {
      return {
        actionCalled: 'setPreferredLanguage',
        responseText: 'Please tell me which language to set: English, Hindi, Tamil, Telugu, Marathi, or Kannada.',
        actionResultType: 'language_validation_error',
        execution: {
          intent,
          confidence: 0.9,
          entities: {},
          steps: ['language_parse_failed'],
        },
      };
    }
    const parsed = await runAction('setPreferredLanguage', [
      { name: 'userId', value: userId },
      { name: 'language', value: preferred },
    ]);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      return {
        actionCalled: 'setPreferredLanguage',
        responseText: 'I cannot update language settings right now. Please try again shortly.',
        actionResultType: 'data_unavailable',
        execution: {
          intent,
          confidence: 0.92,
          entities: { preferredLanguage: preferred },
          steps: ['setPreferredLanguage', 'data_unavailable'],
        },
      };
    }
    const newLangCode = `${preferred}-IN`;
    const langFallback = `Default language updated to ${preferred}.`;
    const langOrch = await safeGenerateResponse(
      {
        intent: 'language_update',
        language: newLangCode,
        transcript,
        additionalContext: `Language was just changed to ${preferred}. Confirm warmly in this new language.`,
      },
      langFallback,
    );
    return {
      actionCalled: 'setPreferredLanguage',
      responseText: langOrch.responseText || langFallback,
      cards: [{ type: 'language_updated', language: preferred }],
      grounding: { sources: ['users_table'] },
      serviceTrace: langOrch.serviceTrace,
      actionResultType: parsed?.success ? 'language_updated' : 'language_error',
      execution: {
        intent,
        confidence: 0.93,
        entities: { preferredLanguage: preferred },
        steps: ['setPreferredLanguage', 'novapro_orchestrator'],
        tool: 'setPreferredLanguage',
        dataSource: 'dynamodb',
      },
    };
  }

  if (intent === 'profile_update') {
    const patch = refineProfilePatchForWrite(
      enrichProfilePatchWithContext(
        parseProfilePatchFromTranscript(transcript),
        transcript,
        sessionContext,
      ),
      transcript,
    );
    if (!Object.keys(patch).length) {
      return {
        actionCalled: 'updateUserProfile',
        responseText:
          'I could not detect profile details. You can say for example: "My age is 35", "State is Bihar", "I am from Tamil Nadu", or "District is Patna".',
        actionResultType: 'profile_validation_error',
        execution: {
          intent,
          confidence: 0.82,
          entities: {},
          steps: ['profile_parse_failed'],
        },
      };
    }
    const parameters = Object.entries(patch).map(([name, value]) => ({ name, value: String(value) }));
    parameters.push({ name: 'userId', value: userId });
    const parsed = await runAction('updateUserProfile', parameters);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      return {
        actionCalled: 'updateUserProfile',
        responseText: 'I cannot update profile data right now. Please try again shortly.',
        actionResultType: 'data_unavailable',
        execution: {
          intent,
          confidence: 0.88,
          entities: patch,
          steps: ['updateUserProfile', 'data_unavailable'],
        },
      };
    }
    const updatedFieldsArray = Array.isArray(parsed?.updatedFields) ? parsed.updatedFields : [];
    const updatedFieldsList = updatedFieldsArray.join(', ');
    const profileFallback = parsed?.success
      ? `Profile updated: ${updatedFieldsList || 'your details'}.`
      : parsed?.message || 'Could not update profile.';
    const profileOrch = await safeGenerateResponse(
      {
        intent: 'profile_update',
        language: effectiveLanguage,
        transcript,
        userProfile: patch,
        additionalContext: parsed?.success
          ? `Updated fields: ${updatedFieldsList}. Profile is now more complete for scheme matching.`
          : `Profile update failed: ${parsed?.message || 'unknown error'}`,
      },
      profileFallback,
    );
    const profileUpdatedText = profileOrch.responseText || profileFallback;

    // If the previous assistant turn asked for scheme profile gaps, auto-continue scheme discovery.
    if (parsed?.success && shouldResumeSchemesAfterProfileUpdate(sessionContext)) {
      const refreshedProfile = await fetchUserProfile(userId);
      const schemeFollowup = await buildSchemesEligibilityResponse({
        runAction,
        profile: refreshedProfile,
        transcript,
        language: effectiveLanguage,
        intent,
      });
      return {
        ...schemeFollowup,
        responseText: `${profileUpdatedText}\n${schemeFollowup.responseText}`,
        cards: [
          {
            type: 'profile_updated',
            updatedFields: updatedFieldsArray,
          },
          ...(schemeFollowup.cards ?? []),
        ],
        grounding: {
          sources: Array.from(new Set(['users_table', ...(schemeFollowup.grounding?.sources ?? [])])),
        },
        serviceTrace: profileOrch.serviceTrace,
        actionResultType:
          schemeFollowup.actionResultType === 'schemes'
            ? 'profile_updated_and_schemes'
            : schemeFollowup.actionResultType,
        execution: {
          ...(schemeFollowup.execution ?? {}),
          intent: 'profile_update',
          steps: ['updateUserProfile', 'novapro_orchestrator', ...((schemeFollowup.execution?.steps ?? []))],
        },
      };
    }

    return {
      actionCalled: 'updateUserProfile',
      responseText: profileUpdatedText,
      serviceTrace: profileOrch.serviceTrace,
      cards: parsed?.success
        ? [
          {
            type: 'profile_updated',
            updatedFields: updatedFieldsArray,
          },
        ]
        : [],
      grounding: { sources: ['users_table'] },
      actionResultType: parsed?.success ? 'profile_updated' : 'profile_error',
      execution: {
        intent,
        confidence: 0.88,
        entities: patch,
        steps: ['updateUserProfile', 'novapro_orchestrator'],
        tool: 'updateUserProfile',
        dataSource: 'dynamodb',
      },
    };
  }

  if (intent === 'jobs') {
    const state = extractStateHint(transcript, profile?.state || '');
    const occupation = String(profile?.occupation || '').trim();
    const parsed = await runAction('getJobsByProfile', [
      { name: 'state', value: state },
      { name: 'occupation', value: occupation },
    ]);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      return {
        actionCalled: 'getJobsByProfile',
        responseText: 'I cannot access live jobs data right now. Please try again shortly.',
        actionResultType: 'data_unavailable',
        execution: {
          intent,
          confidence: 0.9,
          entities: { state, occupation },
          steps: ['getJobsByProfile', 'data_unavailable'],
        },
      };
    }
    let jobs = Array.isArray(parsed?.jobs) ? parsed.jobs.slice(0, 5) : [];
    if (!jobs.length) {
      const fallbackParsed = await runAction('getJobsByProfile', [
        { name: 'state', value: state || '' },
        { name: 'occupation', value: '' },
      ]);
      jobs = Array.isArray(fallbackParsed?.jobs) ? fallbackParsed.jobs.slice(0, 5) : [];
    }
    if (!jobs.length) {
      return {
        actionCalled: 'getJobsByProfile',
        responseText: 'No matching jobs found right now. Try a different location or occupation.',
        actionResultType: 'jobs_empty',
        execution: {
          intent,
          confidence: 0.92,
          entities: { state, occupation },
          steps: ['getJobsByProfile'],
        },
      };
    }
    const summaryRes = await runAction('getUserApplicationsSummary', [{ name: 'userId', value: userId }]);
    const appliedJobIds = new Set(
      (summaryRes?.applications || []).filter((a: any) => a.jobId).map((a: any) => String(a.jobId)),
    );
    jobs = jobs.filter((j: any) => !appliedJobIds.has(String(j.id)));
    if (!jobs.length) {
      return {
        actionCalled: 'getJobsByProfile',
        responseText: "You've already applied to all the jobs we found for you. Check your Applications page or try again later for new listings.",
        actionResultType: 'jobs_all_applied',
        execution: { intent, confidence: 0.9, steps: ['getJobsByProfile', 'getUserApplicationsSummary'] },
      };
    }
    const lines = jobs.map((j: any, i: number) =>
      `${i + 1}. ${j.title} - ${j.company} (${j.state}) ${j.salaryRange ? `- ${j.salaryRange}` : ''}`.trim(),
    );
    const fallback = `Top job matches for you:\n${lines.join('\n')}`;
    const orchestrated = await safeGenerateResponse(
      {
        intent: 'jobs',
        language: effectiveLanguage,
        transcript,
        jobs: jobs.map((j: any) => ({
          title: j.title,
          company: j.company,
          state: j.state,
          salaryRange: j.salaryRange,
        })),
        userProfile: profile,
      },
      fallback,
    );
    const jobsForContext = jobs.slice(0, 5).map((j: any) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      state: j.state,
      salaryRange: j.salaryRange,
    }));
    return {
      actionCalled: 'getJobsByProfile',
      responseText: orchestrated.responseText || fallback,
      actionResultType: 'jobs',
      cards: jobs.slice(0, 3).map((j: any) => ({
        type: 'job_card',
        jobId: j.id,
        title: j.title,
        company: j.company,
        state: j.state,
        salaryRange: j.salaryRange,
      })),
      pendingConfirmation: { type: 'job_list', jobs: jobsForContext },
      grounding: { sources: ['jobs_table'] },
      serviceTrace: orchestrated.serviceTrace,
      execution: {
        intent,
        confidence: 0.92,
        entities: { state, occupation },
        steps: ['getJobsByProfile', 'novapro_orchestrator'],
      },
    };
  }

  if (intent === 'schemes') {
    return buildSchemesEligibilityResponse({
      runAction,
      profile,
      transcript,
      language: effectiveLanguage,
      intent,
    });
  }

  if (intent === 'scheme_lookup' || intent === 'scheme_detail') {
    const fn = intent === 'scheme_detail' ? 'getSchemeDetails' : 'resolveScheme';
    const parsed = await runAction(fn, [{ name: 'query', value: transcript }]);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      const schemeUnavailFallback = 'I cannot access live scheme data right now. Please try again shortly.';
      const schemeUnavailOrch = await safeGenerateResponse(
        { intent: 'scheme_detail', language: effectiveLanguage, transcript, additionalContext: 'Scheme data is temporarily unavailable.' },
        schemeUnavailFallback,
      );
      return {
        actionCalled: fn,
        responseText: schemeUnavailOrch.responseText || schemeUnavailFallback,
        actionResultType: 'data_unavailable',
        serviceTrace: schemeUnavailOrch.serviceTrace,
        execution: {
          intent,
          confidence: 0.85,
          entities: { query: transcript },
          steps: [fn, 'data_unavailable', 'novapro_orchestrator'],
          tool: fn,
          dataSource: 'schemes_table',
        },
      };
    }
    if (parsed?.success && parsed?.scheme) {
      const s = parsed.scheme;
      const schemeFallback = `${s.nameEn || s.name || s.code || 'Scheme'}${s.nameHi ? ` (${s.nameHi})` : ''}. ${s.benefitRs ? `Benefit: Rs ${Number(s.benefitRs).toLocaleString('en-IN')}.` : ''} ${s.description || ''}`.trim();
      const schemeOrch = await safeGenerateResponse(
        {
          intent: 'scheme_detail',
          language: effectiveLanguage,
          transcript,
          schemes: [{
            id: s.id || s.code,
            code: s.code,
            name: s.nameEn || s.name,
            nameHi: s.nameHi,
            description: s.description || '',
            benefitRs: Number(s.benefitRs || 0),
            category: s.category || '',
          }],
          userProfile: profile,
        },
        schemeFallback,
      );
      return {
        actionCalled: fn,
        responseText: schemeOrch.responseText || schemeFallback,
        cards: [
          {
            type: 'scheme_card',
            id: s.id,
            code: s.code,
            name: s.nameEn || s.name,
            nameHi: s.nameHi,
            benefitRs: s.benefitRs,
            description: s.description,
          },
        ],
        grounding: { sources: ['schemes_table'] },
        serviceTrace: schemeOrch.serviceTrace,
        actionResultType: intent === 'scheme_detail' ? 'scheme_detail' : 'scheme_lookup',
        execution: {
          intent,
          confidence: 0.86,
          entities: { query: transcript },
          steps: [fn, 'novapro_orchestrator'],
          tool: fn,
          dataSource: 'schemes_table',
        },
      };
    }
    if (parsed?.code === 'AMBIGUOUS_TOP3' && Array.isArray(parsed?.options)) {
      const opts = parsed.options.slice(0, 3);
      const top = opts.map((m: any) => m.name || m.code || m.id).join(', ');
      return {
        actionCalled: fn,
        responseText: `${parsed.message || 'I found multiple matching schemes.'} Options: ${top}.`,
        pendingConfirmation: {
          type: 'scheme_disambiguation',
          options: opts.map((o: any) => ({
            id: o.id,
            code: o.code,
            name: o.name,
            benefitRs: o.benefitRs,
          })),
        },
        pendingAction: {
          type: 'scheme_disambiguation',
          options: opts.map((o: any) => ({
            id: o.id,
            code: o.code,
            name: o.name,
            benefitRs: o.benefitRs,
          })),
        },
        cards: [
          {
            type: 'scheme_disambiguation',
            options: opts.map((o: any) => ({
              id: o.id,
              code: o.code,
              name: o.name,
              benefitRs: o.benefitRs,
            })),
          },
        ],
        grounding: { sources: ['schemes_table'] },
        actionResultType: 'scheme_disambiguation',
        execution: {
          intent,
          confidence: 0.78,
          entities: { query: transcript },
          steps: [fn],
        },
      };
    }
    return {
      actionCalled: fn,
      responseText: parsed?.message || 'I could not find that scheme.',
      actionResultType: 'scheme_not_found',
      execution: {
        intent,
        confidence: 0.74,
        entities: { query: transcript },
        steps: [fn],
      },
    };
  }

  const isConfirmIntent =
    /\b(confirm|yes|proceed|submit now|go ahead|haan|haanji|ho|theek hai|bilkul|zaroor|accha|seri|avunu)\b/.test(normalized)
    || /சரி|அவுனு|ஆமாம்/.test(transcript)
    || /అవును|సరే|ఓకే/.test(transcript)
    || /ಹೌದು|ಸರಿ|ಓಕೆ/.test(transcript)
    || /हो|ठीक है|हाँ|बिल्कुल/.test(transcript);
  const confirmConfidence = confirmIntentConfidence(normalized);

  // Override intent to 'apply' when:
  // (a) user expresses confirmation AND
  // (b) there is an active pending application confirmation in the session OR a confirmationToken in the request
  const hasPendingForOverride =
    isConfirmIntent &&
    (
      sessionPendingConfirmation?.type === 'application_confirm' ||
      sessionPendingConfirmation?.type === 'apply_field_confirmation' ||
      sessionPendingConfirmation?.type === 'job_confirm' ||
      !!confirmationToken
    );
  const effectiveIntent = hasPendingForOverride ? 'apply' : intent;

  if (effectiveIntent !== 'apply' && effectiveIntent !== 'apply_for_job') return null;

  const jobListContext = sessionPendingConfirmation?.type === 'job_list' ? sessionPendingConfirmation : null;
  const jobConfirmContext = sessionPendingConfirmation?.type === 'job_confirm' ? sessionPendingConfirmation : null;
  const isJobApplyContext = !!(jobListContext || jobConfirmContext);
  const isApplyForJobIntent = intent === 'apply_for_job';

  if (jobConfirmContext && isConfirmIntent) {
    const job = jobConfirmContext.job as { id?: string; title?: string; company?: string };
    const createRes = await runAction('createJobApplication', [
      { name: 'userId', value: userId },
      { name: 'jobId', value: job?.id || '' },
      { name: 'jobTitle', value: job?.title || '' },
      { name: 'company', value: job?.company || '' },
    ]);
    if (createRes?.code === 'ALREADY_APPLIED') {
      return {
        actionCalled: 'createJobApplication',
        responseText: 'You have already applied for this job. Check your Applications page to track it.',
        actionResultType: 'job_already_applied',
        pendingConfirmation: null,
        execution: { intent: 'apply', confidence: 0.9, steps: ['createJobApplication'] },
      };
    }
    if (createRes?.success && createRes?.applicationId) {
      return {
        actionCalled: 'createJobApplication',
        responseText: `Application submitted for ${job?.title || 'this job'} at ${job?.company || 'the company'}. Reference: ${createRes.applicationId}. You can track it in Applications.`,
        applicationSubmitted: true,
        applicationId: createRes.applicationId,
        cards: [{ type: 'application_submitted', applicationId: createRes.applicationId }],
        actionResultType: 'job_submitted',
        pendingConfirmation: null,
        execution: { intent: 'apply', confidence: 0.95, steps: ['createJobApplication'] },
      };
    }
    return {
      actionCalled: 'createJobApplication',
      responseText: createRes?.message || 'Could not submit job application. Please try again.',
      actionResultType: 'job_apply_error',
      execution: { intent: 'apply', confidence: 0.8, steps: ['createJobApplication'] },
    };
  }

  if (isApplyForJobIntent && !jobListContext) {
    const state = extractStateHint(transcript, profile?.state || '');
    const occupation = String(profile?.occupation || '').trim();
    const parsed = await runAction('getJobsByProfile', [
      { name: 'state', value: state },
      { name: 'occupation', value: occupation },
    ]);
    let jobs = Array.isArray(parsed?.jobs) ? parsed.jobs.slice(0, 5) : [];
    if (!jobs.length) {
      const fallback = await runAction('getJobsByProfile', [
        { name: 'state', value: state || '' },
        { name: 'occupation', value: '' },
      ]);
      jobs = Array.isArray(fallback?.jobs) ? fallback.jobs.slice(0, 5) : [];
    }
    if (!jobs.length) {
      return {
        actionCalled: 'getJobsByProfile',
        responseText: 'No jobs found right now. Try again later or say "find jobs" to search.',
        actionResultType: 'jobs_empty',
        execution: { intent: 'apply_for_job', confidence: 0.8, steps: ['getJobsByProfile'] },
      };
    }
    const summaryResApply = await runAction('getUserApplicationsSummary', [{ name: 'userId', value: userId }]);
    const appliedJobIdsApply = new Set(
      (summaryResApply?.applications || []).filter((a: any) => a.jobId).map((a: any) => String(a.jobId)),
    );
    jobs = jobs.filter((j: any) => !appliedJobIdsApply.has(String(j.id)));
    if (!jobs.length) {
      return {
        actionCalled: 'getJobsByProfile',
        responseText: "You've already applied to all the jobs we found. Check your Applications page or say \"find jobs\" again later for new listings.",
        actionResultType: 'jobs_all_applied',
        execution: { intent: 'apply_for_job', confidence: 0.9, steps: ['getJobsByProfile', 'getUserApplicationsSummary'] },
      };
    }
    const jobsForContext = jobs.map((j: any) => ({ id: j.id, title: j.title, company: j.company, state: j.state, salaryRange: j.salaryRange }));
    const lines = jobs.map((j: any, i: number) =>
      `${i + 1}. ${j.title} - ${j.company} (${j.state}) ${j.salaryRange ? `- ${j.salaryRange}` : ''}`.trim(),
    );
    return {
      actionCalled: 'getJobsByProfile',
      responseText: `Here are jobs you can apply for:\n${lines.join('\n')}\nSay "apply for job 1" or "apply for job 2" to apply.`,
      cards: jobs.slice(0, 3).map((j: any) => ({
        type: 'job_card',
        jobId: j.id,
        title: j.title,
        company: j.company,
        state: j.state,
        salaryRange: j.salaryRange,
      })),
      pendingConfirmation: { type: 'job_list', jobs: jobsForContext },
      actionResultType: 'jobs',
      execution: { intent: 'apply_for_job', confidence: 0.9, steps: ['getJobsByProfile'] },
    };
  }

  if (jobListContext && (intent === 'apply' || isApplyForJobIntent)) {
    const jobs = Array.isArray(jobListContext.jobs) ? jobListContext.jobs : [];
    const numMatch = normalized.match(/(?:apply|aavedan)\s+(?:for\s+)?(?:job\s+)?(\d+)/i)
      || normalized.match(/(?:job\s+)?(\d+)\s+(?:apply|aavedan)/i);
    const idMatch = normalized.match(/(?:apply|aavedan)\s+(?:for\s+)?(?:job\s+)([a-zA-Z0-9_-]+)/i);
    let selectedJob: any = null;
    if (idMatch) {
      const matchId = idMatch[1];
      if (/^\d+$/.test(matchId)) {
        const jobIndex = Math.max(0, (parseInt(matchId, 10) || 1) - 1);
        selectedJob = jobs[Math.min(jobIndex, jobs.length - 1)] || jobs[0];
      } else {
        selectedJob = jobs.find((j: any) => String(j.id || '') === matchId) || jobs[0];
      }
    } else if (numMatch) {
      const jobIndex = Math.max(0, (parseInt(numMatch[1], 10) || 1) - 1);
      selectedJob = jobs[Math.min(jobIndex, jobs.length - 1)] || jobs[0];
    } else if (/\b(apply|aavedan)\s+(?:for\s+)?(this|that|it)\b/.test(normalized) || /\b(this|that|it)\s+(?:job\s+)?(?:apply|aavedan)/.test(normalized)) {
      selectedJob = jobs[0];
    } else {
      selectedJob = jobs[0];
    }
    if (!selectedJob) {
      return {
        actionCalled: null,
        responseText: 'Which job would you like to apply for? Say "apply for job 1" or "apply for job 2" etc.',
        actionResultType: 'job_disambiguation',
        execution: { intent: 'apply', confidence: 0.7, steps: [] },
      };
    }
    const gapsRes = await runAction('collectProfileGaps', [
      { name: 'userId', value: userId },
      { name: 'flowType', value: 'jobs' },
    ]);
    const missing = Array.isArray(gapsRes?.missingFields) ? gapsRes.missingFields : [];
    if (missing.length > 0) {
      return {
        actionCalled: 'collectProfileGaps',
        responseText: `To apply for jobs, please share: ${missing.join(', ')}. For example: "My state is Karnataka, occupation is student."`,
        cards: [{ type: 'profile_gaps', missingFields: missing }],
        pendingConfirmation: { type: 'job_list', jobs, pendingJob: selectedJob },
        actionResultType: 'profile_gaps',
        execution: { intent: 'apply', confidence: 0.85, steps: ['collectProfileGaps'] },
      };
    }
    const summaryRes = await runAction('getUserApplicationsSummary', [{ name: 'userId', value: userId }]);
    const applied = (summaryRes?.applications || []).some((a: any) => String(a.jobId || '') === String(selectedJob.id));
    if (applied) {
      return {
        actionCalled: 'getUserApplicationsSummary',
        responseText: `You have already applied for ${selectedJob.title || 'this job'} at ${selectedJob.company || ''}. Check your Applications page.`,
        actionResultType: 'job_already_applied',
        execution: { intent: 'apply', confidence: 0.9, steps: ['getUserApplicationsSummary'] },
      };
    }
    return {
      actionCalled: null,
      responseText: `Confirm application for ${selectedJob.title || 'this job'} at ${selectedJob.company || ''}? Say "Yes" or "Confirm" to proceed.`,
      pendingConfirmation: {
        type: 'job_confirm',
        job: selectedJob,
      },
      cards: [{
        type: 'job_confirm',
        job: selectedJob,
        jobId: selectedJob.id,
        title: selectedJob.title,
        company: selectedJob.company,
      }],
      actionResultType: 'job_confirm',
      execution: { intent: 'apply', confidence: 0.9, steps: ['job_confirm'] },
    };
  }

  if (jobConfirmContext && !isConfirmIntent) {
    const job = jobConfirmContext.job as { title?: string; company?: string };
    return {
      actionCalled: null,
      responseText: `To apply for ${job?.title || 'this job'} at ${job?.company || ''}, say "Yes" or "Confirm". To cancel, say "No" or "Cancel".`,
      pendingConfirmation: jobConfirmContext,
      actionResultType: 'job_confirm_pending',
      execution: { intent: 'apply', confidence: 0.8, steps: [] },
    };
  }

  const explicitFromTurn = extractSchemeHintFromTranscript(transcript);
  const fromContext = extractPendingSchemeFromContext(sessionContext);
  const activePendingConfirmation = sessionPendingConfirmation && sessionPendingConfirmation.type === 'application_confirm'
    ? sessionPendingConfirmation
    : null;
  const activeFieldConfirmation = sessionPendingConfirmation && sessionPendingConfirmation.type === 'apply_field_confirmation'
    ? sessionPendingConfirmation
    : null;

  // CRITICAL: Prioritize explicit names, then context, then LOCK-IN names from active workflows, finally fallback to transcript.
  // Only use explicitFromTurn if it's a real scheme name (not a generic word like "this" / "it").
  const usableExplicit = explicitFromTurn && !isGenericWord(explicitFromTurn) ? explicitFromTurn : null;
  const schemeHint = usableExplicit
    || fromContext
    || (activeFieldConfirmation?.schemeHint as string)
    || (activePendingConfirmation?.scheme as any)?.nameEn
    || (activePendingConfirmation?.scheme as any)?.name
    || transcript;

  const effectiveConfirmationToken = confirmationToken || String(activePendingConfirmation?.confirmationToken || '');
  const hasPendingForSubmit = !!effectiveConfirmationToken;

  if (activeFieldConfirmation) {
    const fieldOrder = Array.isArray(activeFieldConfirmation.fieldOrder)
      ? activeFieldConfirmation.fieldOrder
      : ['name', 'phone', 'state', 'district', 'address'];
    const index = Number(activeFieldConfirmation.index || 0);
    const currentField = fieldOrder[index];
    const values = { ...(activeFieldConfirmation.values || {}) } as Record<string, string>;
    const isAffirm =
      /\b(yes|ok|okay|confirm|haan|haanji|correct|right|ho|accha|theek|seri|avunu)\b/.test(normalized)
      || /சரி|ஆமாம்/.test(transcript)
      || /అవును|సరే/.test(transcript)
      || /ಹೌದು|ಸರಿ/.test(transcript)
      || /हो|हाँ|ठीक/.test(transcript);
    const parsedChange = parseFieldChangeCandidate(transcript, currentField);

    // CRITICAL: Always use the locked-in scheme name from the very first 'apply' turn.
    // Never fall back to the current transcript (e.g. 'Yes') during the field confirmation loop.
    const schemeHintFromFieldFlow = String(activeFieldConfirmation.schemeHint || '').trim();

    if (!schemeHintFromFieldFlow) {
      // Emergency fallback to context if somehow the lock-in was lost
      const contextRedundancy = extractPendingSchemeFromContext(sessionContext);
      if (contextRedundancy) activeFieldConfirmation.schemeHint = contextRedundancy;
    }

    const prepareAfterFieldConfirmation = async (): Promise<ApplyFlowResult> => {
      const finalQuery = (activeFieldConfirmation.schemeHint as string) || schemeHint;
      const prepared = await runAction('prepareApplication', [
        { name: 'userId', value: userId },
        { name: 'query', value: finalQuery },
        { name: 'schemeName', value: finalQuery },
      ]);
      if (prepared?.code === 'DATA_UNAVAILABLE') {
        return {
          actionCalled: 'prepareApplication',
          responseText: 'I cannot access live scheme/application data right now. Please try again shortly.',
          actionResultType: 'data_unavailable',
          execution: {
            intent,
            confidence: 0.9,
            entities: { schemeHint: schemeHintFromFieldFlow },
            steps: ['prepareApplication', 'data_unavailable'],
          },
        };
      }
      if (prepared?.success === true && prepared?.code === 'NEEDS_CONFIRMATION' && prepared?.scheme) {
        const missingDocs = Array.isArray(prepared.missingDocuments) ? prepared.missingDocuments : [];
        const availableDocs = Array.isArray(prepared.availableDocuments) ? prepared.availableDocuments : [];
        const documentCards = missingDocs.map((d: string) => ({
          type: 'document_upload',
          documentType: d,
          uploadApiPath: '/documents/upload',
          openPage: '/documents',
        }));
        let responseText = `All details confirmed. You are applying for ${prepared.scheme.nameEn || prepared.scheme.name}. `;
        if (availableDocs.length > 0) {
          responseText += `We will use your existing document(s): ${availableDocs.join(', ')}. `;
        }
        if (missingDocs.length > 0) {
          responseText += `Please upload: ${missingDocs.join(', ')}. `;
        }
        responseText += 'Once all documents are uploaded, say: confirm application.';
        return {
          actionCalled: 'prepareApplication',
          responseText,
          pendingConfirmation: {
            type: 'application_confirm',
            confirmationToken: prepared.confirmationToken || null,
            scheme: prepared.scheme,
            missingDocuments: missingDocs,
            availableDocuments: availableDocs,
          },
          pendingAction: {
            type: 'application_confirm',
            confirmationToken: prepared.confirmationToken || null,
            scheme: prepared.scheme,
            missingDocuments: missingDocs,
            availableDocuments: availableDocs,
          },
          cards: [
            {
              type: 'application_confirm',
              confirmationToken: prepared.confirmationToken || null,
              scheme: prepared.scheme,
              missingDocuments: missingDocs,
              availableDocuments: availableDocs,
            },
            ...documentCards,
          ],
          actionResultType: 'prepare_apply',
          grounding: { sources: ['schemes_table', 'documents_table', 'users_table'] },
          execution: {
            intent,
            confidence: 0.95,
            entities: { schemeHint: schemeHintFromFieldFlow },
            steps: ['confirmApplicationField', 'prepareApplication'],
          },
        };
      }
      return {
        actionCalled: 'prepareApplication',
        responseText: prepared?.message || 'Could not prepare application right now.',
        actionResultType: 'apply_error',
        execution: {
          intent,
          confidence: 0.8,
          entities: { schemeHint: schemeHintFromFieldFlow },
          steps: ['prepareApplication'],
        },
      };
    };

    if (!currentField) {
      return prepareAfterFieldConfirmation();
    }

    if (isAffirm) {
      const nextIndex = index + 1;
      const nextField = fieldOrder[nextIndex];
      if (!nextField) {
        return prepareAfterFieldConfirmation();
      }
      return {
        actionCalled: 'confirmApplicationField',
        responseText: buildFieldPrompt(nextField, values[nextField], effectiveLanguage),
        pendingConfirmation: {
          ...activeFieldConfirmation,
          type: 'apply_field_confirmation',
          index: nextIndex,
          values,
        },
        pendingAction: {
          ...activeFieldConfirmation,
          type: 'apply_field_confirmation',
          index: nextIndex,
          values,
        },
        cards: [{ type: 'field_confirm', field: nextField, value: values[nextField] || '' }],
        actionResultType: 'field_confirmation_pending',
        grounding: { sources: ['users_table'] },
        execution: {
          intent,
          confidence: 0.9,
          entities: { field: nextField },
          steps: ['confirmApplicationField'],
        },
      };
    }

    if (parsedChange) {
      values[currentField] = parsedChange;
      const mapped = mapFieldToProfileParam(currentField);
      const update = await runAction('confirmApplicationField', [
        { name: 'userId', value: userId },
        { name: 'field', value: mapped },
        { name: 'value', value: parsedChange },
      ]);
      if (update?.code === 'DATA_UNAVAILABLE') {
        return {
          actionCalled: 'confirmApplicationField',
          responseText: 'I cannot update your profile right now. Please try again shortly.',
          actionResultType: 'data_unavailable',
          execution: {
            intent,
            confidence: 0.86,
            entities: { field: currentField },
            steps: ['confirmApplicationField', 'data_unavailable'],
          },
        };
      }
      const nextIndex = index + 1;
      const nextField = fieldOrder[nextIndex];
      if (!nextField) {
        return prepareAfterFieldConfirmation();
      }
      return {
        actionCalled: 'confirmApplicationField',
        responseText: `Updated ${currentField}. ${buildFieldPrompt(nextField, values[nextField], effectiveLanguage)}`,
        pendingConfirmation: {
          ...activeFieldConfirmation,
          type: 'apply_field_confirmation',
          index: nextIndex,
          values,
        },
        pendingAction: {
          ...activeFieldConfirmation,
          type: 'apply_field_confirmation',
          index: nextIndex,
          values,
        },
        cards: [{ type: 'field_confirm', field: nextField, value: values[nextField] || '' }],
        actionResultType: 'field_confirmation_pending',
        grounding: { sources: ['users_table'] },
        execution: {
          intent,
          confidence: 0.9,
          entities: { field: nextField },
          steps: ['confirmApplicationField'],
        },
      };
    }

    return {
      actionCalled: 'confirmApplicationField',
      responseText: `Please confirm only your ${currentField} for now. ${buildFieldPrompt(currentField, values[currentField] || '', effectiveLanguage)}`,
      pendingConfirmation: {
        ...activeFieldConfirmation,
        type: 'apply_field_confirmation',
        index,
        values,
      },
      pendingAction: {
        ...activeFieldConfirmation,
        type: 'apply_field_confirmation',
        index,
        values,
      },
      cards: [{ type: 'field_confirm', field: currentField, value: values[currentField] || '' }],
      actionResultType: 'field_confirmation_pending',
      grounding: { sources: ['users_table'] },
      execution: {
        intent,
        confidence: 0.9,
        entities: { field: currentField, clarification: true },
        steps: ['confirmApplicationField'],
      },
    };
  }

  if (isConfirmIntent) {
    if (confirmConfidence < 0.75) {
      return {
        actionCalled: 'submitApplication',
        responseText: 'Please explicitly say: confirm application, to avoid mistakes.',
        actionResultType: 'needs_explicit_confirmation',
        execution: {
          intent,
          confidence: confirmConfidence,
          entities: { schemeHint, pending: hasPendingForSubmit },
          steps: ['confirm_confidence_check'],
        },
      };
    }
    if (currentState === 'IDLE' && !hasPendingForSubmit) {
      return {
        actionCalled: 'submitApplication',
        responseText: 'No pending application is active. Please say: apply for <scheme name> first.',
        actionResultType: 'needs_pending_confirmation',
        execution: {
          intent,
          confidence: 0.96,
          entities: { schemeHint, state: currentState },
          steps: ['state_guard_blocked'],
        },
      };
    }
    if (!hasPendingForSubmit) {
      return {
        actionCalled: 'submitApplication',
        responseText: 'I do not have a pending application to submit. Please first say: apply for <scheme name>.',
        actionResultType: 'needs_pending_confirmation',
        execution: {
          intent,
          confidence: 0.93,
          entities: { schemeHint, pending: false },
          steps: ['submit_guard_blocked'],
        },
      };
    }
    const stableConfirmIdempotencyKey = idempotencyKey || deriveIdempotencyKeyFromToken(effectiveConfirmationToken);
    const parsed = await runAction('submitApplication', [
      { name: 'userId', value: userId },
      { name: 'confirm', value: 'true' },
      { name: 'confirmationToken', value: effectiveConfirmationToken || '' },
      { name: 'query', value: schemeHint },
      { name: 'schemeName', value: schemeHint },
      { name: 'idempotencyKey', value: stableConfirmIdempotencyKey },
    ]);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      return {
        actionCalled: 'submitApplication',
        responseText: 'I cannot access live application data right now. Please try again in a few minutes.',
        actionResultType: 'data_unavailable',
        execution: {
          intent,
          confidence: 0.95,
          entities: { schemeHint },
          steps: ['submitApplication', 'data_unavailable'],
        },
      };
    }
    if (parsed?.code === 'MISSING_DOCUMENTS') {
      const missing = Array.isArray(parsed.missingDocuments) ? parsed.missingDocuments : [];
      return {
        actionCalled: 'submitApplication',
        responseText: `Please upload all required documents before submitting. Missing: ${missing.join(', ')}. Use the upload cards below, then say confirm application again.`,
        actionResultType: 'missing_documents_blocked',
        pendingConfirmation: activePendingConfirmation ? { ...activePendingConfirmation, missingDocuments: missing } : null,
        pendingAction: activePendingConfirmation ? { ...activePendingConfirmation, missingDocuments: missing } : null,
        cards: missing.map((d: string) => ({ type: 'document_upload', documentType: d, openPage: '/documents' })),
        execution: {
          intent,
          confidence: 0.9,
          entities: { schemeHint, missingDocuments: missing },
          steps: ['submitApplication', 'missing_documents_blocked'],
        },
      };
    }
    if (parsed?.success === true) {
      const submitFallback = `Application submitted! Reference: ${parsed.applicationId || 'N/A'}.`;
      const submitOrch = await safeGenerateResponse(
        {
          intent: 'apply',
          language: effectiveLanguage,
          transcript,
          additionalContext: `Application submitted successfully. Reference number: ${parsed.applicationId}. Scheme: ${parsed.schemeName || schemeHint}. Congratulate the user warmly.`,
        },
        submitFallback,
      );
      return {
        actionCalled: 'submitApplication',
        responseText: submitOrch.responseText || submitFallback,
        serviceTrace: submitOrch.serviceTrace,
        applicationSubmitted: true,
        applicationId: parsed.applicationId,
        pendingConfirmation: null,
        pendingAction: null,
        cards: [
          {
            type: 'application_submitted',
            applicationId: parsed.applicationId,
            schemeName: parsed.schemeName || null,
          },
        ],
        grounding: { sources: ['applications_table'] },
        actionResultType: 'submitted',
        execution: {
          intent,
          confidence: 0.94,
          entities: { schemeHint },
          steps: ['submitApplication', 'novapro_orchestrator'],
          tool: 'submitApplication',
          dataSource: 'dynamodb',
        },
      };
    }
    if (parsed?.code === 'AMBIGUOUS_TOP3' && Array.isArray(parsed?.options)) {
      const opts = parsed.options.slice(0, 3);
      return {
        actionCalled: 'submitApplication',
        responseText: `${parsed.message || 'I found multiple matching schemes.'} Please choose one option.`,
        pendingConfirmation: {
          type: 'scheme_disambiguation',
          options: opts.map((o: any) => ({
            id: o.id,
            code: o.code,
            name: o.name,
            benefitRs: o.benefitRs,
          })),
        },
        pendingAction: {
          type: 'scheme_disambiguation',
          schemeHint,
          options: opts.map((o: any) => ({
            id: o.id,
            code: o.code,
            name: o.name,
            benefitRs: o.benefitRs,
          })),
        },
        cards: [
          {
            type: 'scheme_disambiguation',
            options: opts.map((o: any) => ({
              id: o.id,
              code: o.code,
              name: o.name,
              benefitRs: o.benefitRs,
            })),
          },
        ],
        grounding: { sources: ['schemes_table'] },
        actionResultType: 'scheme_disambiguation',
        execution: {
          intent,
          confidence: 0.84,
          entities: { schemeHint },
          steps: ['submitApplication'],
        },
      };
    }
    return {
      actionCalled: 'submitApplication',
      responseText: parsed?.message || 'Could not submit application right now.',
      actionResultType: 'submit_error',
      execution: {
        intent,
        confidence: 0.84,
        entities: { schemeHint },
        steps: ['submitApplication'],
      },
    };
  }

  // 1. First, try to identify/prepare the application to lock in the scheme and check eligibility
  const initialPrep = await runAction('prepareApplication', [
    { name: 'userId', value: userId },
    { name: 'query', value: schemeHint },
    { name: 'schemeName', value: schemeHint },
  ]);

  if (initialPrep?.code === 'DATA_UNAVAILABLE') {
    return {
      actionCalled: 'prepareApplication',
      responseText: 'I cannot access live scheme data right now. Please try again shortly.',
      actionResultType: 'data_unavailable',
      execution: { intent, confidence: 0.9, entities: { schemeHint }, steps: ['prepareApplication', 'data_unavailable'] },
    };
  }

  // Handle ambiguous matches immediately
  if (initialPrep?.code === 'AMBIGUOUS_TOP3' && Array.isArray(initialPrep?.options)) {
    const opts = initialPrep.options.slice(0, 3);
    return {
      actionCalled: 'prepareApplication',
      responseText: `${initialPrep.message || 'I found multiple matching schemes.'} Please choose one option.`,
      pendingConfirmation: {
        type: 'scheme_disambiguation',
        schemeHint,
        options: opts.map((o: any) => ({ id: o.id, code: o.code, name: o.name, benefitRs: o.benefitRs })),
      },
      pendingAction: {
        type: 'scheme_disambiguation',
        schemeHint,
        options: opts.map((o: any) => ({ id: o.id, code: o.code, name: o.name, benefitRs: o.benefitRs })),
      },
      cards: [{
        type: 'scheme_disambiguation',
        options: opts.map((o: any) => ({ id: o.id, code: o.code, name: o.name, benefitRs: o.benefitRs })),
      }],
      actionResultType: 'scheme_disambiguation',
      execution: { intent, confidence: 0.85, entities: { schemeHint }, steps: ['prepareApplication'] },
    };
  }

  // If we have a scheme (even if it normally needs docs/confirmation),
  // we follow the user request to ALWAYS perform individual field confirmations first.
  if ((initialPrep?.success === true || initialPrep?.code === 'NEEDS_CONFIRMATION') && initialPrep?.scheme) {
    const verifiedSchemeName = initialPrep.scheme.nameEn || initialPrep.scheme.name;
    const coreFields = ['name', 'phone', 'state', 'district', 'address'];

    // Fetch current profile to show existing values for confirmation
    const currentProfile = await fetchUserProfile(userId);
    const initialValues: Record<string, string> = {
      name: currentProfile.name || '',
      phone: currentProfile.phone_number || currentProfile.phone || '',
      state: currentProfile.state || '',
      district: currentProfile.district || '',
      address: currentProfile.address || '',
    };

    return {
      actionCalled: 'confirmApplicationField',
      responseText: `I can help you apply for ${verifiedSchemeName}. First, let's verify your details. ${buildFieldPrompt(coreFields[0], initialValues[coreFields[0]], effectiveLanguage)}`,
      pendingConfirmation: {
        type: 'apply_field_confirmation',
        index: 0,
        fieldOrder: coreFields,
        values: initialValues,
        schemeHint: verifiedSchemeName, // LOCK IN THE SCHEME NAME FOR THE DURATION OF THE LOOP
      },
      pendingAction: {
        type: 'apply_field_confirmation',
        index: 0,
        fieldOrder: coreFields,
        values: initialValues,
        schemeHint: verifiedSchemeName,
      },
      cards: [{ type: 'field_confirm', field: coreFields[0], value: initialValues[coreFields[0]] || '' }],
      actionResultType: 'field_confirmation_pending',
      grounding: { sources: ['users_table'] },
      execution: {
        intent,
        confidence: 0.92,
        entities: { schemeHint: verifiedSchemeName, field: coreFields[0] },
        steps: ['prepareApplication', 'start_field_confirmation'],
      },
    };
  }

  // Fallback if no scheme found or other error
  return {
    actionCalled: 'prepareApplication',
    responseText: initialPrep?.message || 'I could not find that scheme. Could you please specify the name again?',
    actionResultType: 'scheme_not_found',
    execution: { intent, confidence: 0.8, entities: { schemeHint }, steps: ['prepareApplication'] },
  };
  // No fallback here, covered by the schemes intent above.
  return null;
}


function dedupeSessionContext(turns: SessionTurn[]): SessionTurn[] {
  const out: SessionTurn[] = [];
  for (const turn of turns) {
    const role = turn.role === 'assistant' ? 'assistant' : 'user';
    const content = String(turn.content || '').trim();
    if (!content) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role && prev.content === content) continue;
    out.push({ role, content });
  }
  return out;
}

function toAssistantMessages(
  turns: Array<{ role: string; content: string; timestamp?: number }>,
): Array<{ role: string; content: string; timestamp: number }> {
  return (turns || []).map((turn) => ({
    role: turn.role === 'assistant' ? 'assistant' : 'user',
    content: String(turn.content || ''),
    timestamp: Number(turn.timestamp || Date.now()),
  }));
}

function shouldResumeSchemesAfterProfileUpdate(sessionContext: SessionTurn[]): boolean {
  const latestAssistant = [...sessionContext]
    .reverse()
    .filter((t) => t.role === 'assistant')
    .map((t) => normalizeText(t.content || ''))[0] || '';

  if (!latestAssistant) return false;

  // High confidence keywords for scheme/job context
  const hasContext =
    latestAssistant.includes('scheme')
    || latestAssistant.includes('yojana')
    || latestAssistant.includes('benefit')
    || latestAssistant.includes('job')
    || latestAssistant.includes('eligible')
    || latestAssistant.includes('apply')
    || latestAssistant.includes('missing')
    || latestAssistant.includes('details needed')
    || latestAssistant.includes('profile');

  return hasContext;
}

async function buildSchemesEligibilityResponse(args: {
  runAction: (functionName: string, parameters: Array<{ name: string; value: string }>) => Promise<any>;
  profile: Record<string, any>;
  transcript: string;
  language: string;
  intent: string;
}): Promise<ApplyFlowResult> {
  const {
    runAction,
    profile,
    transcript,
    language,
    intent,
  } = args;

  const gapCheck = await runAction('collectProfileGaps', [
    { name: 'flowType', value: 'schemes' },
  ]);
  const missingFields: string[] = Array.isArray(gapCheck?.missingFields) ? gapCheck.missingFields : [];
  if (missingFields.length > 0) {
    // Still fetch top schemes for new users (don't hard-block)
    const topSchemes = await runAction('getSchemesByProfile', [
      { name: 'age', value: '' },
      { name: 'annualIncome', value: '' },
      { name: 'gender', value: '' },
      { name: 'state', value: '' },
      { name: 'occupation', value: '' },
      { name: 'casteCategory', value: '' },
    ]);
    const schemes = Array.isArray(topSchemes?.schemes) ? topSchemes.schemes.slice(0, 4) : [];
    const schemeSummaries = schemes.map((s: any) => ({
      id: s.id || s.code, code: s.code, name: s.name, nameHi: s.nameHi,
      description: s.summary || '', benefitRs: Number(s.benefitRs || 0),
      category: s.category || '', eligibilityScore: s.matchPercent || 50,
      matchReasons: Array.isArray(s.matchReasons) ? s.matchReasons : [],
    }));

    const fallback = `Here are some popular schemes. To get personalized matches, please share: ${missingFields.slice(0, 3).join(', ')}.`;
    const orchGap = await safeGenerateResponse(
      {
        intent: 'schemes',
        language,
        transcript,
        schemes: schemeSummaries,
        additionalContext: `Showing general schemes. For personalized results, user should share: ${missingFields.slice(0, 3).join(', ')}.`,
      },
      fallback
    );
    return {
      actionCalled: 'getSchemesByProfile',
      responseText: orchGap.responseText || fallback,
      serviceTrace: orchGap.serviceTrace,
      actionResultType: 'schemes_partial',
      cards: [
        ...schemeSummaries.slice(0, 3).map((s: any) => ({ type: 'scheme_card', ...s })),
        { type: 'profile_gaps', flowType: 'schemes', missingFields: missingFields.slice(0, 4) },
      ],
      grounding: { sources: ['schemes_table', 'users_table'] },
      execution: { intent, confidence: 0.85, steps: ['collectProfileGaps', 'getSchemesByProfile', 'novapro_orchestrator'] },
    };
  }

  const age = Number(profile?.age || 0) || 0;
  const annualIncome = Number(profile?.annualIncome || profile?.annual_income || 0) || 0;
  const gender = String(profile?.gender || '').toLowerCase();
  const state = extractStateHint(transcript, profile?.state || '');
  const occupation = String(profile?.occupation || '').toLowerCase();
  const parsed = await runAction('getSchemesByProfile', [
    { name: 'age', value: String(age || '') },
    { name: 'annualIncome', value: String(annualIncome || '') },
    { name: 'gender', value: gender },
    { name: 'state', value: state },
    { name: 'occupation', value: occupation },
    { name: 'casteCategory', value: String(profile?.casteCategory || profile?.caste_category || '') },
  ]);

  if (parsed?.code === 'DATA_UNAVAILABLE') {
    return {
      actionCalled: 'getSchemesByProfile',
      responseText: 'I cannot access live schemes data right now. Please try again shortly.',
      actionResultType: 'data_unavailable',
      execution: {
        intent,
        confidence: 0.9,
        entities: { age, annualIncome, gender, state, occupation },
        steps: ['getSchemesByProfile', 'data_unavailable'],
      },
    };
  }

  const schemes = Array.isArray(parsed?.schemes) ? parsed.schemes.slice(0, 5) : [];
  if (!schemes.length) {
    const gaps = await runAction('collectProfileGaps', [{ name: 'flowType', value: 'schemes' }]);
    const missing: string[] = Array.isArray(gaps?.missingFields) ? gaps.missingFields : [];
    return {
      actionCalled: 'getSchemesByProfile',
      responseText: missing.length
        ? `I need more profile details to find matches: ${missing.slice(0, 4).join(', ')}.`
        : 'I could not find matching schemes. Please update your profile details and try again.',
      actionResultType: 'schemes_empty',
      cards: missing.length ? [{ type: 'profile_gaps', flowType: 'schemes', missingFields: missing }] : [],
      grounding: { sources: ['users_table', 'schemes_table'] },
      execution: {
        intent,
        confidence: 0.9,
        entities: { age, annualIncome, gender, state, occupation },
        steps: ['getSchemesByProfile'],
      },
    };
  }

  const topMatchReasons: string[] = Array.isArray(schemes[0]?.matchReasons) ? schemes[0].matchReasons : [];
  const schemeSummaries = schemes.map((s: any) => ({
    id: s.id || s.code,
    code: s.code,
    name: s.name,
    nameHi: s.nameHi,
    description: s.summary || '',
    benefitRs: Number(s.benefitRs || 0),
    category: s.category || '',
    eligibilityScore: s.matchPercent || 0,
    matchReasons: Array.isArray(s.matchReasons) ? s.matchReasons : [],
  }));
  const lines = schemes.map((s: any, i: number) =>
    `${i + 1}. ${s.name}${s.benefitRs ? ` - Rs ${Number(s.benefitRs).toLocaleString('en-IN')}` : ''} (${s.matchPercent || 0
    }% match)`,
  );
  const fallback = `Top schemes for you:\n${lines.join('\n')}\nSay: apply for <scheme name> to continue.`;
  const orchestrated = await safeGenerateResponse(
    { intent: 'schemes', language, transcript, schemes: schemeSummaries, userProfile: profile },
    fallback,
  );

  return {
    actionCalled: 'getSchemesByProfile',
    responseText: orchestrated.responseText || fallback,
    actionResultType: 'schemes',
    matchReasons: topMatchReasons,
    cards: schemeSummaries.slice(0, 3).map((s: any) => ({ type: 'scheme_card', ...s })),
    grounding: { sources: ['schemes_table', 'users_table'] },
    serviceTrace: orchestrated.serviceTrace,
    execution: {
      intent,
      confidence: 0.9,
      entities: { age, annualIncome, gender, state, occupation },
      steps: ['getSchemesByProfile', 'novapro_orchestrator'],
    },
  };
}

function mapFieldToProfileParam(field: string): string {
  const map: Record<string, string> = {
    name: 'name',
    phone: 'phone',
    state: 'state',
    district: 'district',
    address: 'address',
  };
  return map[field] || field;
}

function isOpaqueIdLike(value: string): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  if (/^[0-9a-f-]{30,}$/i.test(v) && (v.match(/-/g) || []).length >= 3) return true;
  return false;
}

function sanitizeNameForPrompt(value: string): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isOpaqueIdLike(v)) return '';
  if (/^\+?\d{10,13}$/.test(v.replace(/\s+/g, ''))) return '';
  return v;
}

function sanitizePhoneForPrompt(value: string): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isOpaqueIdLike(v)) return '';
  const digits = v.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return '';
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

function sanitizeDistrictForPrompt(value: string): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isOpaqueIdLike(v)) return '';
  if (/^address\b/i.test(v)) return '';
  return v;
}

function sanitizeAddressForPrompt(value: string): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isOpaqueIdLike(v)) return '';
  return v.replace(/^(address)\s*/i, '').trim();
}

function getProfileValueForField(profile: Record<string, any>, field: string): string {
  if (field === 'name') return sanitizeNameForPrompt(String(profile?.name || profile?.fullName || '').trim());
  if (field === 'phone') return sanitizePhoneForPrompt(String(profile?.phone || '').trim());
  if (field === 'state') return String(profile?.state || '').trim();
  if (field === 'district') return sanitizeDistrictForPrompt(String(profile?.district || '').trim());
  if (field === 'address') return sanitizeAddressForPrompt(String(profile?.address || '').trim());
  return String(profile?.[field] || '').trim();
}

function buildFieldPrompt(field: string, value: string, language: string): string {
  const shown = value?.trim() ? value.trim() : '';
  const langCode = language.split('-')[0];

  const fieldNames: Record<string, Record<string, string>> = {
    name: { hi: 'नाम', ta: 'பெயர்', te: 'పేరు', kn: 'ಹೆಸರು', mr: 'नाव', en: 'Name' },
    phone: { hi: 'फोन नंबर', ta: 'தொலைபேசி', te: 'ఫోన్', kn: 'ಫೋನ್', mr: 'फोन नंबर', en: 'Phone' },
    state: { hi: 'राज्य', ta: 'மாநிலம்', te: 'రాష్ట్రం', kn: 'ರಾಜ್ಯ', mr: 'राज्य', en: 'State' },
    district: { hi: 'जिला', ta: 'மாவட்டம்', te: 'జిల్లా', kn: 'ಜಿಲ್ಲೆ', mr: 'जिल्हा', en: 'District' },
    address: { hi: 'पता', ta: 'முகவரி', te: 'చిరునామా', kn: 'ವಿಳಾಸ', mr: 'पत्ता', en: 'Address' },
  };

  const confirmWords: Record<string, string> = {
    hi: 'हाँ बोलें अगर सही है',
    ta: 'சரி என்று சொல்லுங்கள்',
    te: 'అవును అని చెప్పండి',
    kn: 'ಹೌದು ಎಂದು ಹೇಳಿ',
    mr: 'हो म्हणा',
    en: 'Say yes to confirm',
  };

  const changeWords: Record<string, string> = {
    hi: 'या बदलने के लिए बोलें:',
    ta: 'மாற்ற சொல்லுங்கள்:',
    te: 'మార్చడానికి చెప్పండి:',
    kn: 'ಬದಲಾಯಿಸಲು ಹೇಳಿ:',
    mr: 'बदलायचे असल्यास म्हणा:',
    en: 'Or say: change to',
  };

  const notProvided: Record<string, string> = {
    hi: 'दिया नहीं गया', ta: 'வழங்கப்படவில்லை', te: 'అందించబడలేదు',
    kn: 'ನೀಡಲಾಗಿಲ್ಲ', mr: 'दिलेले नाही', en: 'not provided',
  };

  const fName = (fieldNames[field]?.[langCode] || fieldNames[field]?.en || field);
  const shownVal = shown || (notProvided[langCode] || notProvided.en);
  const confirmWord = confirmWords[langCode] || confirmWords.en;
  const changeWord = changeWords[langCode] || changeWords.en;

  return `${fName}: ${shownVal}. ${confirmWord}, ${changeWord} "${field}".`;
}

function parseFieldChangeCandidate(transcript: string, currentField: string): string | null {
  const text = String(transcript || '').trim();
  if (!text) return null;
  // Ignore explicit confirm/deny words
  if (/^(yes|ok|okay|confirm|haan|haanji|ho|theek|seri|avunu|सही|ठीक|हाँ|अवश्य|ಹೌದು|ಸರಿ)$/i.test(text)) return null;
  if (/^(no|nahi|nahin|नहीं|இல்லை|లేదు|ಇಲ್ಲ|नाही)$/i.test(text)) return null;

  let candidate = '';
  const direct = text.match(new RegExp(`change\\s+${currentField}\\s+to\\s+(.+)`, 'i'));
  if (direct?.[1]) candidate = direct[1].trim().replace(/[.?!]+$/, '');
  const generic = text.match(/change\s+to\s+(.+)/i);
  if (!candidate && generic?.[1]) candidate = generic[1].trim().replace(/[.?!]+$/, '');

  // If no explicit instruction, use the whole text ONLY IF it doesn't sound like a workflow command
  if (!candidate && text.length >= 2 && text.length <= 160) {
    const isIntentCommand = /\b(apply|want to apply|status|jobs?|schemes?|yojana|benefits?|profile|language|check|track|show)\b/i.test(text);
    if (isIntentCommand) {
      // It's likely an intent switch, not a field value. Prevent corrupting profile with "I want to apply for PM Awas"
      return null;
    }
    candidate = text.replace(/[.?!]+$/, '');
  }
  return normalizeFieldValueForConfirmation(currentField, candidate || text);
}

function normalizeFieldValueForConfirmation(field: string, candidate: string): string | null {
  const base = String(candidate || '').trim().replace(/\s+/g, ' ').replace(/[.?!]+$/, '');
  if (!base) return null;

  if (field === 'phone') {
    const phoneMatch = base.match(/\+?\d[\d -]{8,15}/);
    const digits = (phoneMatch?.[0] || base).replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) return null;
    return digits.length === 10 ? `+91${digits}` : `+${digits}`;
  }

  if (field === 'name') {
    const seemsOtherField =
      /\b(address|adress|addr|district|state|income|salary|caste|occupation|age|gender|phone|mobile|number|apply|yojana|scheme|status)\b/i.test(base)
      && !/\bname\b/i.test(base);
    if (seemsOtherField) return null;
    const v = base
      .replace(/^no[, ]*/i, '')
      .replace(/^(?:my\s+)?name\s*(?:is|:)?\s*/i, '')
      .trim();
    // Names generally shouldn't be > 5 words or > 60 chars or contain numbers
    if (!v || v.length < 2 || v.length > 60 || v.split(/\s+/).length > 5 || !/[a-z\u0900-\u0D7F]/i.test(v) || isOpaqueIdLike(v) || /^\+?\d{8,}$/.test(v)) return null;
    return v;
  }

  if (field === 'state') {
    const v = base.replace(/^state\s*(?:is|:)?\s*/i, '').trim();
    if (!v || /\b(apply|scheme|yojana|status|job|profile)\b/i.test(v)) return null;
    return isKnownState(v) || isKnownState(normalizeText(v)) ? v : null;
  }

  if (field === 'district') {
    if (/\b(address|adress|addr|apply|scheme|yojana|status|job)\b/i.test(base) && !/\bdistrict\b/i.test(base)) return null;
    const v = sanitizeDistrictForPrompt(base.replace(/^district\s*(?:is|:)?\s*/i, '').trim());
    return v.length >= 2 ? v : null;
  }

  if (field === 'address') {
    if (/\b(apply|scheme|yojana|status|job|profile)\b/i.test(base)) return null;
    const v = sanitizeAddressForPrompt(
      base
        .replace(/^my\s+address\s*(?:is|:)?\s*/i, '')
        .replace(/^address\s*(?:is|:)?\s*/i, '')
        .trim(),
    );
    return v.length >= 3 ? v : null;
  }

  return base;
}

function parsePreferredLanguage(normalized: string): string | null {
  const map: Record<string, string> = {
    english: 'en',
    en: 'en',
    hindi: 'hi',
    hi: 'hi',
    tamil: 'ta',
    ta: 'ta',
    telugu: 'te',
    te: 'te',
    marathi: 'mr',
    mr: 'mr',
    kannada: 'kn',
    kn: 'kn',
  };
  for (const [k, v] of Object.entries(map)) {
    if (normalized.includes(k)) return v;
  }
  return null;
}

const KNOWN_INDIAN_STATES = new Set<string>([
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat', 'haryana',
  'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'manipur',
  'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu', 'telangana',
  'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal',
  'andaman and nicobar islands', 'chandigarh', 'dadra and nagar haveli and daman and diu', 'delhi',
  'jammu and kashmir', 'ladakh', 'lakshadweep', 'puducherry',
]);

function parseNumericToken(value: string): number | null {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function normalizeOccupation(value: string): string | null {
  const v = normalizeText(value);
  if (!v) return null;
  const map: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\bstudent\b/, value: 'student' },
    { pattern: /\bfarmer\b|\bkrishi\b/, value: 'farmer' },
    { pattern: /\bself[\s_-]?employed\b/, value: 'self_employed' },
    { pattern: /\bentrepreneur\b|\bbusiness\b/, value: 'self_employed' },
    { pattern: /\bsalaried\b|\bemployed\b|\bjob\b/, value: 'salaried' },
    { pattern: /\bunemployed\b/, value: 'unemployed' },
    { pattern: /\bhomemaker\b|\bhousewife\b|\bhouse maker\b/, value: 'homemaker' },
    { pattern: /\blabou?rer\b|\bworker\b/, value: 'worker' },
  ];
  for (const entry of map) {
    if (entry.pattern.test(v)) return entry.value;
  }
  return null;
}

function isCasteToken(value: string): boolean {
  return /^(general|obc|sc|st|ews)$/i.test(String(value || '').trim());
}

function isGenderToken(value: string): boolean {
  return /^(male|female|other|m|f)$/i.test(String(value || '').trim());
}

function cleanLocationToken(value: string): string {
  return String(value || '')
    .replace(/\b(i am|iam|from|my|is|im)\b/gi, ' ')
    .replace(/[.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKnownState(value: string): boolean {
  return KNOWN_INDIAN_STATES.has(normalizeText(value));
}

function parseProfilePatchFromTranscript(transcript: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const raw = String(transcript || '').trim();
  const text = raw.toLowerCase();
  const normalized = normalizeText(raw);
  const hasAddressKeyword = /\b(address|adress|addr)\b/i.test(raw);
  const hasDistrictKeyword = /\bdistrict\b/i.test(raw);
  if (/^(hi|hello|hey|namaste|namaskar|namaskara|namaskaram|yes|ok|okay|confirm|haan|haanji|no|nahi|nahin|cancel)$/i.test(normalized)) {
    return out;
  }

  // Age
  let age =
    text.match(/\bmy\s+age\s+is\s+(\d{1,3})\b/)
    ?? text.match(/\bage\s+is\s+(\d{1,3})\b/)
    ?? text.match(/\bage\s+(\d{1,3})\b/)
    ?? text.match(/\b(?:i\s+am|iam|meri\s+umar|umar)\s+(\d{1,3})\b/);
  if (age?.[1]) {
    const n = Number(age[1]);
    if (n >= 10 && n <= 120) out.age = n;
  }
  if (out.age == null && text.length <= 15) {
    const loneNum = text.match(/^\s*(\d{1,3})\s*$/);
    if (loneNum?.[1]) {
      const n = Number(loneNum[1]);
      if (n >= 10 && n <= 120) out.age = n;
    }
  }

  // Income
  const income =
    text.match(/\b(?:annual\s*income|income|salary)\s*(?:is|=|:)?\s*₹?\s*([0-9][0-9,]{2,})\b/)
    ?? text.match(/\bmy\s+income\s+is\s+([0-9][0-9,]{2,})\b/);
  if (income?.[1]) {
    const n = parseNumericToken(income[1]);
    if (n && n >= 1000) out.annualIncome = n;
  }

  // Gender
  let gender = text.match(/\bgender\s*(?:is|:)?\s*(male|female|other|m|f)\b/);
  if (!gender?.[1]) gender = text.match(/\b(?:i\s+am|iam)\s+(?:a\s+)?(male|female|other)\b/);
  if (!gender?.[1] && isGenderToken(normalized)) {
    out.gender = (normalized === 'm' ? 'MALE' : normalized === 'f' ? 'FEMALE' : normalized.toUpperCase());
  }
  if (!gender?.[1] && out.gender == null) {
    const trailingGender = text.match(/\b(male|female|other)\b/);
    if (trailingGender?.[1]) {
      out.gender = trailingGender[1].toUpperCase();
    }
  }
  if (gender?.[1]) {
    out.gender = (gender[1] === 'm' ? 'MALE' : gender[1] === 'f' ? 'FEMALE' : gender[1].toUpperCase());
  }

  // Name / phone
  const nameMatch = raw.match(/\b(?:my\s+name\s+is|name\s+is)\s+([a-z][a-z .'-]{1,60})/i);
  if (nameMatch?.[1]) {
    const nameValue = nameMatch[1].replace(/\s+/g, ' ').trim().replace(/[.?!]+$/, '');
    if (nameValue.length >= 2) out.name = nameValue;
  }
  const phoneMatch = raw.match(/\b(?:phone|mobile|number|contact)\s*(?:number)?\s*(?:is|:)?\s*(\+?[0-9][0-9 -]{8,15})/i);
  if (phoneMatch?.[1]) {
    const digits = phoneMatch[1].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) {
      out.phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    }
  }
  if (!out.phone && /^\+?\d{10,13}$/.test(raw.replace(/\s+/g, ''))) {
    const digits = raw.replace(/\D/g, '');
    out.phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
  }

  // Occupation (avoid classifying gender terms as occupation)
  const explicitOccupation = text.match(/\boccupation\s*(?:is|:)?\s*([a-z_ -]{3,40})\b/);
  const inferredOccupation =
    normalizeOccupation(explicitOccupation?.[1] || '')
    || normalizeOccupation(text.match(/\b(?:i\s+am|iam)\s+(?:a|an)?\s*([a-z_ -]{3,40})\b/)?.[1] || '');
  if (inferredOccupation && !isGenderToken(inferredOccupation) && !isCasteToken(inferredOccupation)) {
    out.occupation = inferredOccupation;
  }

  // State / District explicit patterns
  const explicitState = text.match(/\bstate\s*(?:is|:)?\s*([a-z ]{2,40})\b/);
  if (explicitState?.[1]) out.state = cleanLocationToken(explicitState[1]);

  const explicitDistrict = text.match(/\bdistrict\s*(?:is|:)?\s*([a-z ]{2,40})\b/);
  if (explicitDistrict?.[1]) out.district = cleanLocationToken(explicitDistrict[1]);

  // Address
  const explicitAddress = raw.match(/\b(?:address|adress|addr)\s*(?:is|:)?\s*([a-z0-9,./ -]{3,150})/i);
  if (explicitAddress?.[1]) {
    const addressValue = explicitAddress[1]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.?!]+$/, '');
    if (addressValue.length >= 3) {
      out.address = addressValue;
    }
  }

  // "from <x>, <y>" should infer state/district pair.
  const fromComma = raw.match(/\bfrom\s+([^,\n.]+)\s*,\s*([^,\n.]+)/i);
  if (fromComma?.[1] && fromComma?.[2]) {
    const first = cleanLocationToken(fromComma[1]);
    const second = cleanLocationToken(fromComma[2]);
    const firstIsState = isKnownState(first);
    const secondIsState = isKnownState(second);
    if (firstIsState && !out.state) out.state = first;
    if (secondIsState && !out.state) out.state = second;
    if (!out.district) {
      if (firstIsState && !secondIsState) out.district = second;
      else if (secondIsState && !firstIsState) out.district = first;
      else out.district = second;
    }
  } else {
    const fromSingle = text.match(/\b(?:i\s+am\s+from|iam\s+from|from)\s+([a-z ]{2,40})\b/);
    if (fromSingle?.[1]) {
      const loc = cleanLocationToken(fromSingle[1]);
      if (isKnownState(loc) && !out.state) out.state = loc;
      else if (!out.district) out.district = loc;
    }
  }

  // Caste
  const casteFromCaste = text.match(/\bcaste\s*(?:is|:)?\s*(general|obc|sc|st|ews)\b/);
  const casteFromCategory = text.match(/\b(?:category|cat)\s*(?:is|:)?\s*(general|obc|sc|st|ews)\b/);
  if (casteFromCaste?.[1]) out.casteCategory = casteFromCaste[1].toUpperCase();
  else if (casteFromCategory?.[1]) out.casteCategory = casteFromCategory[1].toUpperCase();
  else if (isCasteToken(normalized)) out.casteCategory = normalized.toUpperCase();

  // Comma-separated compact updates: "shimoga, 120000, obc"
  const segments = raw
    .split(/[,\n]/)
    .map((s) => cleanLocationToken(s))
    .map((s) => s.replace(/\b(male|female|other)\b/ig, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const consumedIndexes = new Set<number>();

  // Segment-level label parsing for mixed order inputs, e.g. "gaveesh name", "1200000 income", "ganimakki adress"
  segments.forEach((seg, idx) => {
    const segNorm = normalizeText(seg);

    if (!out.name) {
      const nameForward = seg.match(/^(?:my\s+)?name\s*(?:is|:)?\s*(.+)$/i);
      const nameReverse = seg.match(/^(.+?)\s+name$/i);
      const nv = (nameForward?.[1] || nameReverse?.[1] || '').trim();
      if (nv && nv.length >= 2 && !/^\d+$/.test(nv)) {
        out.name = nv;
        consumedIndexes.add(idx);
      }
    }

    if (!out.address) {
      const addressForward = seg.match(/^(?:my\s+)?(?:address|adress|addr)\s*(?:is|:)?\s*(.+)$/i);
      const addressReverse = seg.match(/^(.+?)\s+(?:address|adress|addr)$/i);
      const av = (addressForward?.[1] || addressReverse?.[1] || '').trim();
      if (av && av.length >= 3 && !/^\d+$/.test(av)) {
        out.address = av;
        consumedIndexes.add(idx);
      }
    }

    if (!out.annualIncome) {
      const incomeForward = seg.match(/^(?:annual\s+)?(?:income|salary)\s*(?:is|:)?\s*([0-9][0-9,]*)$/i);
      const incomeReverse = seg.match(/^([0-9][0-9,]*)\s*(?:income|salary)$/i);
      const n = parseNumericToken(incomeForward?.[1] || incomeReverse?.[1] || '');
      if (n && n >= 1000) {
        out.annualIncome = n;
        consumedIndexes.add(idx);
      }
    }

    if (!out.phone) {
      const phoneForward = seg.match(/^(?:phone|mobile|number|contact)\s*(?:number)?\s*(?:is|:)?\s*(\+?[0-9][0-9 -]{8,15})$/i);
      const phoneReverse = seg.match(/^(\+?[0-9][0-9 -]{8,15})\s*(?:phone|mobile|number|contact)$/i);
      const digits = (phoneForward?.[1] || phoneReverse?.[1] || '').replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 13) {
        out.phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
        consumedIndexes.add(idx);
      }
    }

    if (!out.state) {
      const stateForward = seg.match(/^state\s*(?:is|:)?\s*(.+)$/i);
      const stateReverse = seg.match(/^(.+?)\s+state$/i);
      const sv = normalizeText((stateForward?.[1] || stateReverse?.[1] || '').trim());
      if (sv && isKnownState(sv)) {
        out.state = (stateForward?.[1] || stateReverse?.[1] || '').trim();
        consumedIndexes.add(idx);
      }
    }

    if (!out.district) {
      const districtForward = seg.match(/^district\s*(?:is|:)?\s*(.+)$/i);
      const districtReverse = seg.match(/^(.+?)\s+district$/i);
      const dv = (districtForward?.[1] || districtReverse?.[1] || '').trim();
      if (dv && dv.length >= 2) {
        out.district = dv;
        consumedIndexes.add(idx);
      }
    }

    if (!out.casteCategory && isCasteToken(segNorm)) {
      out.casteCategory = segNorm.toUpperCase();
      consumedIndexes.add(idx);
    }
  });

  // Parse remaining unlabeled segments (location-style leftovers)
  const leftoverSegments = segments.filter((_, idx) => !consumedIndexes.has(idx));
  for (const seg of leftoverSegments) {
    const segNorm = normalizeText(seg);
    if (!out.annualIncome && /^\d[\d,]{3,}$/.test(seg.replace(/\s+/g, ''))) {
      const n = parseNumericToken(seg);
      const digits = String(seg).replace(/\D/g, '');
      if (!out.phone && digits.length >= 10 && digits.length <= 13) {
        out.phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
        continue;
      }
      if (n && n >= 1000 && digits.length <= 8) {
        out.annualIncome = n;
        continue;
      }
    }
    if (!out.casteCategory && isCasteToken(segNorm)) {
      out.casteCategory = segNorm.toUpperCase();
      continue;
    }
    if (!out.state && isKnownState(segNorm)) {
      out.state = seg;
      continue;
    }
  }

  const leftoverLocation = leftoverSegments.filter((seg) => {
    const segNorm = normalizeText(seg);
    if (!segNorm) return false;
    if (isKnownState(segNorm)) return false;
    if (isGenderToken(segNorm) || isCasteToken(segNorm)) return false;
    if (/^(yes|ok|okay|confirm|haan|haanji|no|nahi|nahin|cancel)$/i.test(segNorm)) return false;
    if (/^\d[\d,]*$/.test(seg.replace(/\s+/g, ''))) return false;
    return /^[a-z ]{2,40}$/i.test(segNorm);
  });

  const hasExplicitStateOrFromCue =
    !!out.state || /\bstate\b/i.test(raw) || /\bfrom\b/i.test(raw) || leftoverSegments.some((seg) => isKnownState(normalizeText(seg)));
  const allowDistrictFromLeftover = !(hasAddressKeyword && !hasDistrictKeyword && !hasExplicitStateOrFromCue);

  if (!out.district && leftoverLocation.length > 0 && allowDistrictFromLeftover) {
    const loc = leftoverLocation[0];
    const inferredOcc = normalizeOccupation(loc);
    const isGreeting = /^(hi|hello|hey|namaste|namaskar|namaskara|namaskaram)$/i.test(normalizeText(loc));
    if (!inferredOcc && !isGreeting && loc.length >= 3) {
      out.district = loc;
    }
  }

  if (!out.address && leftoverLocation.length > 1) {
    out.address = leftoverLocation.slice(1).join(', ');
  }

  if (!out.district && out.address && allowDistrictFromLeftover) {
    for (const seg of leftoverSegments) {
      const segNorm = normalizeText(seg);
      const inferredOcc = normalizeOccupation(segNorm);
      if (!inferredOcc && !isKnownState(segNorm) && !isGenderToken(segNorm) && !isCasteToken(segNorm)) {
        out.district = seg;
        break;
      }
    }
  }

  // Fallback for plain single-token state update like "karnataka"
  if (!out.state && normalized.split(/\s+/).length <= 2 && isKnownState(normalized)) {
    out.state = raw.trim();
  }

  return out;
}

function enrichProfilePatchWithContext(
  patch: Record<string, string | number>,
  transcript: string,
  sessionContext: SessionTurn[],
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...patch };
  const raw = String(transcript || '').trim();
  const assistantTurns = [...sessionContext]
    .reverse()
    .filter((t) => t.role === 'assistant')
    .slice(0, 5)
    .map((t) => normalizeText(t.content || ''));

  const addressRequested = assistantTurns.some((t) =>
    t.includes('before applying please confirm these details')
    || t.includes('missing: address')
    || (t.includes('more details needed') && t.includes('address')),
  );
  const hasStrongNonLocationPatch =
    out.name != null
    || out.phone != null
    || out.age != null
    || out.annualIncome != null
    || out.occupation != null
    || out.gender != null
    || out.casteCategory != null;

  if (addressRequested && !out.address && !hasStrongNonLocationPatch) {
    const pieces = raw
      .split(/[,\n]/)
      .map((s) => cleanLocationToken(s))
      .filter(Boolean);
    const locationPieces = pieces.filter((p) => {
      const pn = normalizeText(p);
      const numericLike = /^\d[\d,]*$/.test(String(p).replace(/\s+/g, ''));
      return !numericLike && !isCasteToken(pn) && !isGenderToken(pn);
    });
    if (locationPieces.length >= 2) {
      if (!out.district) out.district = locationPieces[0];
      out.address = locationPieces.slice(1).join(', ');
    } else if (locationPieces.length === 1 && !isKnownState(locationPieces[0])) {
      out.address = locationPieces[0];
    }
  }

  return out;
}

function refineProfilePatchForWrite(
  patch: Record<string, string | number>,
  transcript: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...patch };
  const raw = String(transcript || '').trim();
  const normalized = normalizeText(raw);
  const hasAddressKeyword = /\b(address|adress|addr)\b/i.test(raw);
  const hasDistrictKeyword = /\bdistrict\b/i.test(raw);
  const hasNameKeyword = /\bname\b/i.test(raw);
  const hasPhoneKeyword = /\b(phone|mobile|number|contact)\b/i.test(raw);

  if (/^(yes|ok|okay|confirm|haan|haanji|no|nahi|nahin|cancel)$/i.test(normalized)) {
    return {};
  }

  if (out.name != null) {
    const cleaned = normalizeFieldValueForConfirmation('name', String(out.name));
    if (cleaned) out.name = cleaned;
    else delete out.name;
  }

  if (out.phone != null) {
    const cleaned = normalizeFieldValueForConfirmation('phone', String(out.phone));
    if (cleaned) out.phone = cleaned;
    else delete out.phone;
  }

  if (!out.phone && /^\+?\d{10,13}$/.test(raw.replace(/\s+/g, ''))) {
    const digits = raw.replace(/\D/g, '');
    out.phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    delete out.annualIncome;
  }

  if (out.state != null) {
    const cleaned = normalizeFieldValueForConfirmation('state', String(out.state));
    if (cleaned) out.state = cleaned;
    else delete out.state;
  }

  if (out.district != null) {
    const cleaned = normalizeFieldValueForConfirmation('district', String(out.district));
    if (cleaned) out.district = cleaned;
    else delete out.district;
  }

  if (out.address != null) {
    const cleaned = normalizeFieldValueForConfirmation('address', String(out.address));
    if (cleaned) out.address = cleaned;
    else delete out.address;
  }

  if (hasAddressKeyword && !hasDistrictKeyword) {
    delete out.district;
  }
  if (hasNameKeyword && !hasAddressKeyword && !hasDistrictKeyword && !/\bstate\b/i.test(raw)) {
    delete out.district;
    delete out.address;
  }
  if (hasPhoneKeyword && out.phone != null) {
    delete out.annualIncome;
  }

  if (out.annualIncome != null) {
    const n = Number(out.annualIncome);
    if (!Number.isFinite(n) || n < 0) {
      delete out.annualIncome;
    }
  }

  return out;
}

function parseDocumentType(transcript: string): string | null {
  const normalized = normalizeText(transcript);
  const directMap: Array<{ key: string; type: string }> = [
    { key: 'aadhaar', type: 'aadhaar' },
    { key: 'aadhar', type: 'aadhaar' },
    { key: 'pan', type: 'pan' },
    { key: 'passbook', type: 'bank_passbook' },
    { key: 'income certificate', type: 'income_certificate' },
    { key: 'caste certificate', type: 'caste_certificate' },
    { key: 'domicile', type: 'domicile_certificate' },
    { key: 'residence', type: 'residence_proof' },
    { key: 'ration card', type: 'ration_card' },
    { key: 'photo', type: 'photo' },
  ];
  for (const entry of directMap) {
    if (normalized.includes(entry.key)) return entry.type;
  }
  const simple = normalized.match(/(?:upload|reupload|attach)\s+([a-z0-9_ -]{3,40})/i);
  if (simple?.[1]) return simple[1].trim().replace(/\s+/g, '_');
  return null;
}

function extractDocumentId(text: string): string | null {
  const normalized = String(text || '');
  const uuid = normalized.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  if (uuid?.[0]) return uuid[0].toLowerCase();
  const prefixed = normalized.match(/\bDOC-[A-Z0-9-]{6,}\b/i);
  if (prefixed?.[0]) return prefixed[0];
  return null;
}

function extractPendingSchemeFromContext(sessionContext: SessionTurn[]): string | null {
  // Scan most recent turns first
  for (const turn of [...sessionContext].reverse()) {
    const text = turn.content || '';

    if (turn.role === 'assistant') {
      // Patterns for assistant proposing, confirming or listing schemes
      const patterns = [
        /applying for\s+([^.(\n,]+)/i,
        /confirm application for\s+([^.(\n,]+)/i,
        /can apply for\s+([^.(\n,]+)/i,
        /applying for\s+([^.(\n,]+)/i,
        /scheme:\s+([^.(\n,]+)/i,
        // "You are applying for Pradhan Mantri Suraksha Bima Yojana"
        /you are applying for\s+([^.(\n,]+)/i,
        // "I can help you apply for X"
        /help you apply for\s+([^.(\n,]+)/i,
        // "Consider X for a benefit"
        /consider\s+([^.(\n,]+?)\s+for\s+a\s+/i,
        // Numbered list items like "1. PM Awas Yojana (Urban) with a benefit..."
        /\d+\.\s+([^.(\n,]+?)\s+(?:with|for|offering|provides?)\s+/i,
      ];
      for (const p of patterns) {
        const m = text.match(p);
        if (m?.[1]) {
          const candidate = cleanSchemeCandidate(m[1]);
          if (candidate.length >= 4 && !isGenericWord(candidate)) return candidate;
        }
      }
    } else if (turn.role === 'user') {
      // Also check user turns for explicit scheme names they mentioned
      const hint = extractSchemeHintFromTranscript(text);
      if (hint && !isGenericWord(hint)) return hint;
    }
  }
  return null;
}

function extractApplicationRef(text: string): string | null {
  const match = (text || '').match(/\bVS-[A-Z0-9-]{6,}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function extractApplicationRefFromContext(sessionContext: SessionTurn[]): string | null {
  for (const turn of [...sessionContext].reverse()) {
    const ref = extractApplicationRef(turn.content || '');
    if (ref) return ref;
  }
  return null;
}

async function fetchUserProfile(userId: string): Promise<Record<string, any>> {
  if (!userId) return {};
  try {
    const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { user_id: userId } }));
    return (res.Item ?? {}) as Record<string, any>;
  } catch (err) {
    logger.warn('Failed to fetch user profile for workflow', { userId, error: String(err) });
    return {};
  }
}

function extractStateHint(transcript: string, fallbackState: string): string {
  const cleaned = (transcript || '').trim();
  const m = cleaned.match(/\bin\s+([A-Za-z ]{3,30})/i);
  if (m?.[1]) return m[1].trim();
  return fallbackState || '';
}

// Generic words that are NOT scheme names — if the extracted hint is one of these,
// we should fall back to context rather than returning a useless hint.
const GENERIC_APPLY_WORDS = new Set([
  'this', 'it', 'that', 'scheme', 'here', 'one', 'now', 'please',
  'the scheme', 'this scheme', 'that scheme', 'for this', 'for it',
]);

function cleanSchemeCandidate(raw: string): string {
  return raw
    .replace(/\b(for this|for it|this scheme|now|fucking|please|kindly|apply for this|apply for it)\b/gi, '')
    .replace(/[.?!,]+$/, '')
    // Strip leading list prefix (e.g. "1. ", "2. ", "3. ")
    .replace(/^\s*\d+\.\s*/, '')
    // Strip trailing benefit/description noise like "with a benefit of up to ₹1,00,000"
    .replace(/\s+with\s+a\s+benefit.*/i, '')
    .replace(/\s+offering\s+.*/i, '')
    .replace(/\s+provides?\s+.*/i, '')
    .trim();
}

function isGenericWord(candidate: string): boolean {
  const lower = candidate.toLowerCase().trim();
  return GENERIC_APPLY_WORDS.has(lower) || lower.length < 4;
}

function extractSchemeHintFromTranscript(transcript: string): string | null {
  if (!transcript?.trim()) return null;

  // STEP 1: Try the first non-empty line as a direct scheme name hint.
  // Users commonly type the scheme name on line 1, then "i want to apply" on line 2.
  const lines = transcript.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const firstLine = lines[0];
    const restText = lines.slice(1).join(' ').toLowerCase();
    const hasApplyInRest = /\b(apply|application|submit|register|apply for|i want to apply|ಅಪ್ಲೈ|आवेदन)\b/.test(restText);
    if (hasApplyInRest && firstLine.length >= 5 && firstLine.split(' ').length >= 2) {
      const cleaned = cleanSchemeCandidate(firstLine);
      if (cleaned.length >= 5 && !isGenericWord(cleaned)) return cleaned;
    }
  }

  // STEP 2: Collapse into single line for regex matching
  const text = transcript.replace(/\r?\n/g, ' ').trim();

  // Patterns ordered from most specific to least specific.
  // Each pattern tries to capture the scheme name BEFORE the apply verb.
  const patterns: RegExp[] = [
    // "PM Awas Yojana (Urban) apply for this" — scheme name BEFORE "apply"
    /^(.+?)\s+(?:apply|apply for this|apply for it|i want to apply|apply now)\b/i,
    // "apply for PM Awas Yojana (Urban)"
    /\bapply\s+for\s+["']?([^"'\n]+?)["']?\s*(?:scheme|yojana|portal|mission|programme|program|card|nidhi|bima|yojana)?\s*$/i,
    // "application for X"
    /\bapplication\s+(?:for\s+)?([^"'\n]+?)$/i,
    // "confirm application for X"
    /\bconfirm\s+application\s+(?:for\s+)?([^"'\n]+?)$/i,
    // "i want to apply for X"
    /\bi\s+want\s+to\s+apply\s+(?:for\s+)?([^"'\n]+?)$/i,
    // "i am looking for X"
    /\bi\s+am\s+looking\s+(?:for\s+)?([^"'\n]+?)$/i,
    // Kannada / Hindi patterns
    /(.+?)\s+apply\s+ಮಾಡಬೇಕು/i,
    /(.+?)\s+ಅಪ್ಲೈ\s+ಮಾಡಬೇಕು/i,
    /(.+?)\s+के\s+लिए\s+आवेदन/i,
    /(.+?)\s+yojana\s+apply/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      const candidate = cleanSchemeCandidate(m[1]);
      if (candidate.length >= 3 && !isGenericWord(candidate)) return candidate;
    }
  }
  return null;
}

function extractSchemeHintFromDocumentQuery(transcript: string): string | null {
  const text = transcript.trim();
  const patterns = [
    /documents?\s+required\s+for\s+(.+)/i,
    /required\s+documents?\s+for\s+(.+)/i,
    /docs?\s+for\s+(.+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) {
      const candidate = m[1].replace(/[.?!]+$/, '').trim();
      if (candidate.length >= 3) return candidate;
    }
  }
  return null;
}

function getAgentAliases(): string[] {
  const configured = (process.env.BEDROCK_AGENT_ALIAS_ID || '').trim();
  const fallback = (process.env.BEDROCK_AGENT_FALLBACK_ALIAS_ID || '').trim();
  const ordered = [configured, fallback, 'TSTALIASID'].filter(Boolean);
  return [...new Set(ordered)];
}

async function invokeAgentWithAlias(params: {
  agentId: string;
  agentAliasId: string;
  sessionId: string;
  inputText: string;
  userId: string;
  language: string;
}): Promise<{ responseText: string; actionCalled: string | null }> {
  const {
    agentId, agentAliasId, sessionId, inputText, userId, language,
  } = params;

  const cmd = new InvokeAgentCommand({
    agentId,
    agentAliasId,
    sessionId,
    inputText,
    enableTrace: AGENT_TRACE_ENABLED,
    sessionState: {
      sessionAttributes: {
        userId,
        language,
      },
    },
  });

  const resp = await sendAgentCommandWithTimeout(cmd, AGENT_TIMEOUT_MS);
  let responseText = '';
  let actionCalled: string | null = null;
  let returnControl: any = null;

  if (resp.completion) {
    for await (const ev of resp.completion) {
      if (ev.chunk?.bytes) {
        responseText += Buffer.from(ev.chunk.bytes).toString('utf-8');
      }
      if ((ev as any).returnControl) {
        returnControl = (ev as any).returnControl;
      }
      if ((ev as any).trace?.trace?.orchestrationTrace?.invocationInput?.actionGroupInvocationInput) {
        const inp = (ev as any).trace.trace.orchestrationTrace.invocationInput.actionGroupInvocationInput;
        actionCalled = inp.function ?? null;
      }
    }
  }

  // ROCA: execute action locally and send function result back to agent
  if (returnControl) {
    const { handler: actionHandler } = await import('../api/agent/action-handler.js');
    const rco = returnControl.invocationInputs?.[0]?.actionGroupInvocationInput ?? {};
    actionCalled = rco.function ?? actionCalled;

    logger.info('ROCA: Executing action locally', { action: rco.function, agentAliasId });

    const actionResult = await actionHandler({
      actionGroup: rco.actionGroupName,
      function: rco.function,
      parameters: rco.parameters ?? [],
      userId,
      language,
      sessionAttributes: { userId, language },
    });

    const feedbackCmd = new InvokeAgentCommand({
      agentId,
      agentAliasId,
      sessionId,
      sessionState: {
        sessionAttributes: {
          userId,
          language,
        },
        invocationId: returnControl.invocationId,
        returnControlInvocationResults: [{
          functionResult: {
            actionGroup: rco.actionGroupName,
            function: rco.function,
            responseBody: {
              TEXT: { body: extractActionBody(actionResult) },
            },
          },
        }],
      },
    });

    responseText = '';
    const feedbackResp = await sendAgentCommandWithTimeout(feedbackCmd, AGENT_TIMEOUT_MS);
    if (feedbackResp.completion) {
      for await (const ev of feedbackResp.completion) {
        if (ev.chunk?.bytes) {
          responseText += Buffer.from(ev.chunk.bytes).toString('utf-8');
        }
      }
    }
  }

  return { responseText: responseText.trim(), actionCalled };
}

async function sendAgentCommandWithTimeout(command: InvokeAgentCommand, timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    return await bedrockAgent.send(command, { abortSignal: ac.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Bedrock Agent request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function extractActionBody(actionResult: any): string {
  const maybeBody = actionResult?.response?.functionResponse?.responseBody?.TEXT?.body;
  if (typeof maybeBody === 'string' && maybeBody.trim()) return maybeBody;
  if (typeof actionResult === 'string') return actionResult;
  return JSON.stringify(actionResult ?? {});
}

async function directModelCall(
  transcript: string,
  language: string,
  sessionContext: { role: string; content: string }[],
): Promise<string> {
  const langLabel = getLangLabel(language);
  const systemPrompt = `You are VaaniSetu, a warm and helpful assistant for rural Indian citizens.
Always respond in ${langLabel} using its native script.
Keep answers concise (2-4 sentences), warm, and practical.

Capabilities you can highlight:
- Government welfare schemes discovery and eligibility checking
- Application submission and status tracking
- Job matching based on profile
- Profile updates and document management

Reliability rules:
- If the user asks for specific scheme names, amounts, or status, guide them to use the assistant commands (e.g. "tell me schemes available", "check my application status").
- You can offer general guidance, explain how to use the service, and have friendly conversation.
- For greetings and general help, be warm and conversational.
- AWS services powering VaaniSetu: Amazon Bedrock Nova Pro, DynamoDB, Lambda, Aurora.`;

  const messages = [
    ...sessionContext.slice(-6).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    })),
    { role: 'user' as const, content: [{ text: transcript }] },
  ];

  const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID || '';
  const converseParams: any = {
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: { maxTokens: 512, temperature: 0.55, topP: 0.85 },
  };
  if (GUARDRAIL_ID) {
    converseParams.guardrailConfig = {
      guardrailIdentifier: GUARDRAIL_ID,
      guardrailVersion: process.env.BEDROCK_GUARDRAIL_VERSION || 'DRAFT',
      trace: 'enabled',
    };
  }

  const response = await bedrockRuntime.send(new ConverseCommand(converseParams));

  return response.output?.message?.content?.[0]?.text?.trim() ?? '';
}

async function safeDirectModelCall(
  transcript: string,
  language: string,
  sessionContext: { role: string; content: string }[],
): Promise<string> {
  try {
    return await directModelCall(transcript, language, sessionContext);
  } catch (err: any) {
    logger.warn('Direct model fallback failed', { error: err?.message || String(err) });
    return 'I can help with scheme search, applications, status tracking, jobs, profile updates, and language changes right now.';
  }
}

function deriveIdempotencyKeyFromToken(token: string): string {
  if (!token) return '';
  return `confirm-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
}

