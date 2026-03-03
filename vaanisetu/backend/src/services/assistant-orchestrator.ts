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
import { detectWorkflowIntent, normalizeText, type WorkflowIntent } from './intent-detection.js';
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
  const raw = Number(process.env.BEDROCK_AGENT_TIMEOUT_MS ?? 18000);
  return Number.isFinite(raw) && raw > 0 ? raw : 18000;
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
  let intent = detectWorkflowIntent(normalized);
  if (intent === 'none' && sessionPendingConfirmation?.type === 'apply_field_confirmation') {
    intent = 'apply';
  }
  if (
    intent === 'none'
    && sessionPendingConfirmation?.type === 'application_confirm'
    && /\b(yes|confirm|haan|haanji|proceed)\b/.test(normalized)
  ) {
    intent = 'apply';
  }
  if (intent === 'none') {
    const patch = parseProfilePatchFromTranscript(transcript);
    if (Object.keys(patch).length > 0) intent = 'profile_update';
    else return null;
  }

  if (intent === 'greeting') {
    const langLabel = getLangLabel(language);
    const greetings: Record<string, string> = {
      Hindi: 'नमस्ते! मैं VaaniSetu हूं। मैं आपको योजनाएं, नौकरियां और आवेदन में मदद कर सकता हूं। आप क्या जानना चाहते हैं?',
      Tamil: 'வணக்கம்! நான் VaaniSetu. திட்டங்கள், வேலைகள் மற்றும் விண்ணப்பங்களில் உதவ முடியும். என்ன தேவை?',
      Telugu: 'నమస్కారం! నేను VaaniSetu. యోజనలు, ఉద్యోగాలు మరియు అప్లికేషన్లలో సహాయం చేయగలను. ఏమి కావాలి?',
      Kannada: 'ನಮಸ್ಕಾರ! ನಾನು VaaniSetu. ಯೋಜನೆಗಳು, ಉದ್ಯೋಗಗಳು ಮತ್ತು ಅರ್ಜಿಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ಏನು ಬೇಕು?',
      Marathi: 'नमस्कार! मी VaaniSetu. योजना, नोकरी आणि अर्जात मदत करू शकतो. काय हवं?',
      English: 'Hello! I\'m VaaniSetu. I can help with schemes, jobs, and applications. What would you like to know?',
    };
    const responseText = greetings[langLabel] || greetings.English;
    return {
      actionCalled: null,
      responseText,
      actionResultType: 'greeting',
      execution: { intent: 'greeting', confidence: 0.95, entities: {}, steps: ['greeting'] },
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
      return {
        actionCalled: 'getApplicationStatus',
        responseText: 'Please share your application reference number (for example: VS-XXXX).',
        actionResultType: 'needs_application_reference',
        execution: {
          intent,
          confidence: 0.95,
          entities: { applicationRef: null },
          steps: ['extract_ref_failed'],
        },
      };
    }
    const parsed = await runAction('getApplicationStatus', [
      { name: 'userId', value: userId },
      { name: 'applicationId', value: appRef },
    ]);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      return {
        actionCalled: 'getApplicationStatus',
        responseText: 'I cannot access live status data right now. Please try again shortly.',
        actionResultType: 'data_unavailable',
        execution: {
          intent,
          confidence: 0.98,
          entities: { applicationRef: appRef },
          steps: ['getApplicationStatus', 'data_unavailable'],
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
        },
      };
    }
    return {
      actionCalled: 'getApplicationStatus',
      responseText: `${parsed.message || `Application ${appRef} is ${parsed.status || 'under_review'}.`}${
        parsed.expectedDecision ? ` Expected decision: ${parsed.expectedDecision}.` : ''
      }`,
      cards: [{ type: 'application_status', applicationRef: appRef, status: parsed.status || 'under_review' }],
      grounding: { sources: ['applications_table'] },
      actionResultType: 'status',
      execution: {
        intent,
        confidence: 0.98,
        entities: { applicationRef: appRef },
        steps: ['getApplicationStatus'],
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
        return {
          actionCalled: 'requestDocumentUploadSlot',
          responseText:
            'Please tell me which document you want to upload, for example PAN, Aadhaar, income certificate, or bank passbook.',
          actionResultType: 'document_type_required',
          execution: {
            intent,
            confidence: 0.8,
            entities: {},
            steps: ['document_type_parse_failed'],
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
      return {
        actionCalled: 'getRequiredDocuments',
        responseText:
          'Please tell me which scheme you need documents for, for example: documents required for Stand-Up India.',
        actionResultType: 'scheme_required_for_documents',
        execution: {
          intent,
          confidence: 0.82,
          entities: {},
          steps: ['scheme_hint_missing'],
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
    return {
      actionCalled: 'getRequiredDocuments',
      responseText: missing.length
        ? `You are missing these documents: ${missing.join(', ')}. You can upload them now.`
        : 'All required documents are already available for this scheme.',
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
        steps: ['getRequiredDocuments'],
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
    return {
      actionCalled: 'setPreferredLanguage',
      responseText: parsed?.message || `Default language updated to ${preferred}.`,
      cards: [{ type: 'language_updated', language: preferred }],
      grounding: { sources: ['users_table'] },
      actionResultType: parsed?.success ? 'language_updated' : 'language_error',
      execution: {
        intent,
        confidence: 0.93,
        entities: { preferredLanguage: preferred },
        steps: ['setPreferredLanguage'],
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
    const updatedFields = Array.isArray(parsed?.updatedFields) ? parsed.updatedFields.join(', ') : '';
    const updatedFieldsArray = Array.isArray(parsed?.updatedFields) ? parsed.updatedFields : [];
    const profileUpdatedText = parsed?.success
      ? `Profile updated successfully.${updatedFields ? ` Updated fields: ${updatedFields}.` : ''}`
      : parsed?.message || 'Could not update profile right now.';

    // If the previous assistant turn asked for scheme profile gaps, auto-continue scheme discovery.
    if (parsed?.success && shouldResumeSchemesAfterProfileUpdate(sessionContext)) {
      const refreshedProfile = await fetchUserProfile(userId);
      const schemeFollowup = await buildSchemesEligibilityResponse({
        runAction,
        profile: refreshedProfile,
        transcript,
        language,
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
        actionResultType:
          schemeFollowup.actionResultType === 'schemes'
            ? 'profile_updated_and_schemes'
            : schemeFollowup.actionResultType,
        execution: {
          ...(schemeFollowup.execution ?? {}),
          intent: 'profile_update',
          steps: ['updateUserProfile', ...((schemeFollowup.execution?.steps ?? []))],
        },
      };
    }

    return {
      actionCalled: 'updateUserProfile',
      responseText: profileUpdatedText,
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
        steps: ['updateUserProfile'],
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
    const lines = jobs.map((j: any, i: number) =>
      `${i + 1}. ${j.title} - ${j.company} (${j.state}) ${j.salaryRange ? `- ${j.salaryRange}` : ''}`.trim(),
    );
    const fallback = `Top job matches for you:\n${lines.join('\n')}`;
    const orchestrated = await safeGenerateResponse(
      {
        intent: 'jobs',
        language,
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
    return {
      actionCalled: 'getJobsByProfile',
      responseText: orchestrated.responseText || fallback,
      actionResultType: 'jobs',
      cards: jobs.slice(0, 3).map((j: any) => ({
        type: 'job_card',
        title: j.title,
        company: j.company,
        state: j.state,
        salaryRange: j.salaryRange,
      })),
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
      language,
      intent,
    });
  }

  if (intent === 'scheme_lookup' || intent === 'scheme_detail') {
    const fn = intent === 'scheme_detail' ? 'getSchemeDetails' : 'resolveScheme';
    const parsed = await runAction(fn, [{ name: 'query', value: transcript }]);
    if (parsed?.code === 'DATA_UNAVAILABLE') {
      return {
        actionCalled: fn,
        responseText: 'I cannot access live scheme data right now. Please try again shortly.',
        actionResultType: 'data_unavailable',
        execution: {
          intent,
          confidence: 0.85,
          entities: { query: transcript },
          steps: [fn, 'data_unavailable'],
        },
      };
    }
    if (parsed?.success && parsed?.scheme) {
      const s = parsed.scheme;
      const benefit = s.benefitRs ? ` Benefit: Rs ${Number(s.benefitRs).toLocaleString('en-IN')}.` : '';
      return {
        actionCalled: fn,
        responseText: `${s.nameEn || s.name || s.code || 'Scheme'}${s.nameHi ? ` (${s.nameHi})` : ''}.${benefit} ${
          s.description || ''
        }`.trim(),
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
        actionResultType: intent === 'scheme_detail' ? 'scheme_detail' : 'scheme_lookup',
        execution: {
          intent,
          confidence: 0.86,
          entities: { query: transcript },
          steps: [fn],
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

  const isConfirmIntent = /\b(confirm|yes|proceed|submit now|go ahead|haan|haanji)\b/.test(normalized);
  const confirmConfidence = confirmIntentConfidence(normalized);
  if (intent !== 'apply') return null;

  const explicitFromTurn = extractSchemeHintFromTranscript(transcript);
  const fromContext = extractPendingSchemeFromContext(sessionContext);
  const schemeHint = explicitFromTurn || fromContext || transcript;
  const activePendingConfirmation = sessionPendingConfirmation && sessionPendingConfirmation.type === 'application_confirm'
    ? sessionPendingConfirmation
    : null;
  const activeFieldConfirmation = sessionPendingConfirmation && sessionPendingConfirmation.type === 'apply_field_confirmation'
    ? sessionPendingConfirmation
    : null;
  const effectiveConfirmationToken = confirmationToken || String(activePendingConfirmation?.confirmationToken || '');
  const hasPendingForSubmit = !!effectiveConfirmationToken;

  if (activeFieldConfirmation) {
    const fieldOrder = Array.isArray(activeFieldConfirmation.fieldOrder)
      ? activeFieldConfirmation.fieldOrder
      : ['name', 'phone', 'state', 'district', 'address'];
    const index = Number(activeFieldConfirmation.index || 0);
    const currentField = fieldOrder[index];
    const values = { ...(activeFieldConfirmation.values || {}) } as Record<string, string>;
    const isAffirm = /\b(yes|ok|confirm|haan|haanji|correct|right)\b/.test(normalized);
    const parsedChange = parseFieldChangeCandidate(transcript, currentField);
    const schemeHintFromFieldFlow = String(activeFieldConfirmation.schemeHint || schemeHint || '').trim();
    const prepareAfterFieldConfirmation = async (): Promise<ApplyFlowResult> => {
      const prepared = await runAction('prepareApplication', [
        { name: 'userId', value: userId },
        { name: 'query', value: schemeHintFromFieldFlow },
        { name: 'schemeName', value: schemeHintFromFieldFlow },
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
        const documentCards = missingDocs.map((d: string) => ({
          type: 'document_upload',
          documentType: d,
          uploadApiPath: '/documents/upload',
          openPage: '/documents',
        }));
        return {
          actionCalled: 'prepareApplication',
          responseText: `All details confirmed. You are applying for ${prepared.scheme.nameEn || prepared.scheme.name}. Say: confirm application.`,
          pendingConfirmation: {
            type: 'application_confirm',
            confirmationToken: prepared.confirmationToken || null,
            scheme: prepared.scheme,
            missingDocuments: missingDocs,
          },
          pendingAction: {
            type: 'application_confirm',
            confirmationToken: prepared.confirmationToken || null,
            scheme: prepared.scheme,
            missingDocuments: missingDocs,
          },
          cards: [
            {
              type: 'application_confirm',
              confirmationToken: prepared.confirmationToken || null,
              scheme: prepared.scheme,
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
        responseText: buildFieldPrompt(nextField, values[nextField]),
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
        responseText: `Updated ${currentField}. ${buildFieldPrompt(nextField, values[nextField])}`,
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
      responseText: `Please confirm only your ${currentField} for now. ${buildFieldPrompt(currentField, values[currentField] || '')}`,
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
    if (parsed?.success === true) {
      return {
        actionCalled: 'submitApplication',
        responseText: parsed.message || 'Application submitted.',
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
          steps: ['submitApplication'],
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

  const applyGapCheck = await runAction('collectProfileGaps', [
    { name: 'userId', value: userId },
    { name: 'flowType', value: 'apply' },
  ]);
  const applyMissingFields: string[] = Array.isArray(applyGapCheck?.missingFields) ? applyGapCheck.missingFields : [];
  if (applyMissingFields.length > 0) {
    return {
      actionCalled: 'collectProfileGaps',
      responseText: `Before applying, please confirm these details: ${applyMissingFields.slice(0, 4).join(', ')}.`,
      actionResultType: 'needs_profile_fields',
      cards: [{ type: 'profile_gaps', flowType: 'apply', missingFields: applyMissingFields }],
      grounding: { sources: ['users_table'] },
      execution: {
        intent,
        confidence: 0.91,
        entities: { missingFields: applyMissingFields },
        steps: ['collectProfileGaps'],
      },
    };
  }

  if (!activeFieldConfirmation && !activePendingConfirmation && currentState !== 'APPLY_SUBMIT_CONFIRMATION') {
    const fieldOrder = ['name', 'phone', 'state', 'district', 'address'];
    const values: Record<string, string> = {};
    for (const f of fieldOrder) {
      values[f] = getProfileValueForField(profile, f);
    }
    const firstField = fieldOrder[0];
    return {
      actionCalled: 'confirmApplicationField',
      responseText: `Before submitting, let's confirm details. ${buildFieldPrompt(firstField, values[firstField])}`,
      pendingConfirmation: {
        type: 'apply_field_confirmation',
        index: 0,
        fieldOrder,
        values,
        schemeHint,
      },
      pendingAction: {
        type: 'apply_field_confirmation',
        index: 0,
        fieldOrder,
        values,
        schemeHint,
      },
      cards: [{ type: 'field_confirm', field: firstField, value: values[firstField] || '' }],
      grounding: { sources: ['users_table', 'documents_table'] },
      actionResultType: 'field_confirmation_pending',
      execution: {
        intent,
        confidence: 0.9,
        entities: { field: firstField },
        steps: ['confirmApplicationField'],
      },
    };
  }

  const parsed = await runAction('prepareApplication', [
    { name: 'userId', value: userId },
    { name: 'query', value: schemeHint },
    { name: 'schemeName', value: schemeHint },
  ]);
  if (parsed?.code === 'DATA_UNAVAILABLE') {
    return {
      actionCalled: 'prepareApplication',
      responseText: 'I cannot access live scheme/application data right now. Please try again shortly.',
      actionResultType: 'data_unavailable',
      execution: {
        intent,
        confidence: 0.9,
        entities: { schemeHint },
        steps: ['prepareApplication', 'data_unavailable'],
      },
    };
  }
  if (parsed?.success === true && parsed?.code === 'NEEDS_CONFIRMATION' && parsed?.scheme) {
    const missing = Array.isArray(parsed.missingDocuments) && parsed.missingDocuments.length > 0
      ? ` Missing documents: ${parsed.missingDocuments.join(', ')}.`
      : '';
    const missingDocs = Array.isArray(parsed.missingDocuments) ? parsed.missingDocuments : [];
    const documentCards = missingDocs.map((d: string) => ({
      type: 'document_upload',
      documentType: d,
      uploadApiPath: '/documents/upload',
      openPage: '/documents',
    }));
    return {
      actionCalled: 'prepareApplication',
      responseText: `You are applying for ${
        parsed.scheme.nameEn || parsed.scheme.name
      } (benefit up to Rs ${Number(parsed.scheme.benefitRs || 0).toLocaleString('en-IN')}).${missing} Say: confirm application for ${
        parsed.scheme.nameEn || parsed.scheme.name
      }.`,
      pendingConfirmation: {
        type: 'application_confirm',
        confirmationToken: parsed.confirmationToken || null,
        scheme: parsed.scheme,
        missingDocuments: parsed.missingDocuments || [],
      },
      pendingAction: {
        type: 'application_confirm',
        confirmationToken: parsed.confirmationToken || null,
        scheme: parsed.scheme,
        missingDocuments: parsed.missingDocuments || [],
      },
      cards: [
        {
          type: 'application_confirm',
          confirmationToken: parsed.confirmationToken || null,
          scheme: parsed.scheme,
          missingDocuments: parsed.missingDocuments || [],
        },
        ...documentCards,
      ],
      grounding: { sources: ['schemes_table', 'documents_table', 'users_table'] },
      actionResultType: 'prepare_apply',
      execution: {
        intent,
        confidence: 0.94,
        entities: { schemeHint },
        steps: ['prepareApplication'],
      },
    };
  }
  if (parsed?.code === 'AMBIGUOUS_TOP3' && Array.isArray(parsed?.options)) {
    const opts = parsed.options.slice(0, 3);
    const top = opts.map((m: any) => m.nameEn || m.name || m.code || m.id).join(', ');
    return {
      actionCalled: 'prepareApplication',
      responseText: `${parsed.message || 'I found multiple matching schemes.'} Options: ${top}.`,
      pendingConfirmation: {
        type: 'scheme_disambiguation',
        options: opts.map((o: any) => ({
          id: o.id,
          code: o.code,
          name: o.nameEn || o.name,
          benefitRs: o.benefitRs,
        })),
      },
      pendingAction: {
        type: 'scheme_disambiguation',
        options: opts.map((o: any) => ({
          id: o.id,
          code: o.code,
          name: o.nameEn || o.name,
          benefitRs: o.benefitRs,
        })),
      },
      cards: [
        {
          type: 'scheme_disambiguation',
          options: opts.map((o: any) => ({
            id: o.id,
            code: o.code,
            name: o.nameEn || o.name,
            benefitRs: o.benefitRs,
          })),
        },
      ],
      grounding: { sources: ['schemes_table'] },
      actionResultType: 'scheme_disambiguation',
      execution: {
        intent,
        confidence: 0.82,
        entities: { schemeHint },
        steps: ['prepareApplication'],
      },
    };
  }
  return {
    actionCalled: 'prepareApplication',
    responseText: parsed?.message || 'Please share the exact scheme name to continue.',
    actionResultType: 'apply_error',
    execution: {
      intent,
      confidence: 0.8,
      entities: { schemeHint },
      steps: ['prepareApplication'],
    },
  };
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
  if (
    latestAssistant.includes('before applying please confirm these details')
    || latestAssistant.includes('missing: address')
    || latestAssistant.includes('before applying')
  ) {
    return false;
  }

  return latestAssistant.includes('to find suitable schemes')
    || latestAssistant.includes('missing required profile fields')
    || latestAssistant.includes('i need more profile details')
    || (latestAssistant.includes('more details needed') && latestAssistant.includes('missing'));
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
    return {
      actionCalled: 'collectProfileGaps',
      responseText: `To find suitable schemes, please share: ${missingFields.slice(0, 4).join(', ')}.`,
      actionResultType: 'needs_profile_fields',
      cards: [{ type: 'profile_gaps', flowType: 'schemes', missingFields }],
      grounding: { sources: ['users_table'] },
      execution: {
        intent,
        confidence: 0.92,
        entities: { missingFields },
        steps: ['collectProfileGaps'],
      },
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
    `${i + 1}. ${s.name}${s.benefitRs ? ` - Rs ${Number(s.benefitRs).toLocaleString('en-IN')}` : ''} (${
      s.matchPercent || 0
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

function buildFieldPrompt(field: string, value: string): string {
  const nice = field.charAt(0).toUpperCase() + field.slice(1);
  const shown = value?.trim() ? value.trim() : 'not provided';
  return `Please confirm your ${nice}: ${shown}. Say yes to confirm, or say: change ${field} to <value>.`;
}

function parseFieldChangeCandidate(transcript: string, currentField: string): string | null {
  const text = String(transcript || '').trim();
  if (!text) return null;
  if (/^(yes|ok|okay|confirm|haan|haanji)$/i.test(text)) return null;
  if (/^(no|nahi|nahin)$/i.test(text)) return null;

  let candidate = '';
  const direct = text.match(new RegExp(`change\\s+${currentField}\\s+to\\s+(.+)`, 'i'));
  if (direct?.[1]) candidate = direct[1].trim().replace(/[.?!]+$/, '');
  const generic = text.match(/change\s+to\s+(.+)/i);
  if (!candidate && generic?.[1]) candidate = generic[1].trim().replace(/[.?!]+$/, '');
  if (!candidate && text.length >= 2 && text.length <= 160) candidate = text.replace(/[.?!]+$/, '');
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
      /\b(address|adress|addr|district|state|income|salary|caste|occupation|age|gender|phone|mobile|number)\b/i.test(base)
      && !/\bname\b/i.test(base);
    if (seemsOtherField) return null;
    const v = base
      .replace(/^no[, ]*/i, '')
      .replace(/^(?:my\s+)?name\s*(?:is|:)?\s*/i, '')
      .trim();
    if (!v || v.length < 2 || !/[a-z]/i.test(v) || isOpaqueIdLike(v) || /^\+?\d{8,}$/.test(v)) return null;
    return v;
  }

  if (field === 'state') {
    const v = base.replace(/^state\s*(?:is|:)?\s*/i, '').trim();
    if (!v) return null;
    return isKnownState(v) || isKnownState(normalizeText(v)) ? v : null;
  }

  if (field === 'district') {
    if (/\b(address|adress|addr)\b/i.test(base) && !/\bdistrict\b/i.test(base)) return null;
    const v = sanitizeDistrictForPrompt(base.replace(/^district\s*(?:is|:)?\s*/i, '').trim());
    return v.length >= 2 ? v : null;
  }

  if (field === 'address') {
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
  if (/^(yes|ok|okay|confirm|haan|haanji|no|nahi|nahin|cancel)$/i.test(normalized)) {
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
    const inferredOcc = normalizeOccupation(leftoverLocation[0]);
    if (!inferredOcc) out.district = leftoverLocation[0];
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
  for (const turn of [...sessionContext].reverse()) {
    const text = turn.content || '';
    const m1 = text.match(/applying for\s+([^.(\n]+)/i);
    if (m1?.[1]) return m1[1].trim();
    const m2 = text.match(/confirm application for\s+([^.(\n]+)/i);
    if (m2?.[1]) return m2[1].trim();
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

function extractSchemeHintFromTranscript(transcript: string): string | null {
  const text = transcript.trim();
  const patterns = [
    /apply for\s+(.+)/i,
    /application for\s+(.+)/i,
    /confirm application for\s+(.+)/i,
    /apply\s+(.+)/i,
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
  const systemPrompt = `You are VaaniSetu, a helpful assistant for rural citizens.
Always respond in ${langLabel}.
Keep answers concise (2-4 sentences), warm, and practical.

Reliability rules:
- Never invent scheme names, benefit amounts, eligibility rules, job data, or application status.
- If the user asks for factual scheme/job/status/application data, ask them to use the workflow path and do not provide guessed facts.
- Do not claim profile updates, submissions, or status changes from this mode.
- This mode is only for greetings, generic guidance, and conversational help.`;

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

