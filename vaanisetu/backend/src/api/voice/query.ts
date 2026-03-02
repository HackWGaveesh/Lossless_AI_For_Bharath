import type { APIGatewayProxyHandler } from 'aws-lambda';
import crypto from 'crypto';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';
import { executeAgentAction } from '../agent/action-handler.js';

// Agent in us-east-1 where Nova Pro is natively available
const bedrockAgent = new BedrockAgentRuntimeClient({ region: 'us-east-1' });
const bedrockRuntime = new BedrockRuntimeClient({ region: 'us-east-1' });
const MODEL_ID = 'us.amazon.nova-pro-v1:0';
const AGENT_TRACE_ENABLED = process.env.BEDROCK_AGENT_ENABLE_TRACE === 'true';
const AGENT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.BEDROCK_AGENT_TIMEOUT_MS ?? 18000);
  return Number.isFinite(raw) && raw > 0 ? raw : 18000;
})();
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION || process.env.AWS_REGION || 'ap-south-1' }));
const USERS_TABLE = process.env.USERS_TABLE || 'vaanisetu-users';

type SessionTurn = { role: string; content: string };
type ApplyFlowResult = {
  responseText: string;
  actionCalled: string | null;
  applicationSubmitted?: boolean;
  applicationId?: string;
  pendingConfirmation?: Record<string, any> | null;
  execution?: Record<string, any> | null;
  actionResultType?: string | null;
};
type WorkflowIntent =
  | 'apply'
  | 'status'
  | 'jobs'
  | 'schemes'
  | 'scheme_lookup'
  | 'scheme_detail'
  | 'profile_update'
  | 'language_update'
  | 'none';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = parseJsonBody(event);
    const userId = getUserIdFromEvent(event, body) ?? 'anonymous';
    const {
      transcript,
      language = 'hi-IN',
      sessionContext = [],
      sessionId = userId || 'anonymous',
      idempotencyKey = '',
      channel = 'voice',
      forceLanguage = '',
      confirmationToken = '',
    } = body as {
      transcript?: string;
      language?: string;
      sessionContext?: { role: string; content: string }[];
      sessionId?: string;
      idempotencyKey?: string;
      channel?: string;
      forceLanguage?: string;
      confirmationToken?: string;
    };

    if (!transcript?.trim()) {
      return sendErrorResponse(400, 'Missing transcript');
    }

    const applyFlowResult = await maybeHandleStructuredWorkflow({
      transcript,
      language,
      userId,
      sessionContext,
      idempotencyKey,
      channel,
      forceLanguage,
      confirmationToken,
    });
    if (applyFlowResult) {
      return sendSuccessResponse({
        responseText: applyFlowResult.responseText,
        language: forceLanguage || language,
        agentUsed: false,
        responseMode: 'workflow',
        applicationSubmitted: !!applyFlowResult.applicationSubmitted,
        applicationId: applyFlowResult.applicationId ?? null,
        pendingConfirmation: applyFlowResult.pendingConfirmation ?? null,
        execution: applyFlowResult.execution ?? null,
        actionResultType: applyFlowResult.actionResultType ?? null,
        agentTrace: applyFlowResult.actionCalled ? { actionCalled: applyFlowResult.actionCalled, agentUsed: false } : null,
        guardrailApplied: false,
        budgetMode: getBudgetMode(),
      });
    }

    const budgetMode = getBudgetMode();
    if (budgetMode === 'strict') {
      return sendSuccessResponse({
        responseText: 'I can currently run only grounded workflow actions due to cost-safe mode. Please ask for scheme lookup, apply, status, jobs, profile, or language update.',
        language: forceLanguage || language,
        agentUsed: false,
        responseMode: 'workflow',
        applicationSubmitted: false,
        applicationId: null,
        pendingConfirmation: null,
        execution: null,
        actionResultType: 'budget_guardrail',
        agentTrace: null,
        guardrailApplied: false,
        budgetMode,
      });
    }

    const agentId = process.env.BEDROCK_AGENT_ID;
    const agentAliases = getAgentAliases();

    logger.info('Voice query', {
      userId,
      language,
      hasAgent: !!agentId,
      agentId,
      agentAliases,
      agentTraceEnabled: AGENT_TRACE_ENABLED,
      agentTimeoutMs: AGENT_TIMEOUT_MS,
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
        responseText = await safeDirectModelCall(transcript, language, sessionContext);
        responseMode = 'direct_model';
      }
    } else {
      responseText = await safeDirectModelCall(transcript, language, sessionContext);
      responseMode = 'direct_model';
    }

    if (!responseText) {
      if (agentUsed) {
        logger.warn('Agent returned empty response, falling back to direct Nova Pro');
        agentUsed = false;
        responseMode = 'direct_model';
        actionCalled = null;
      }
      responseText = await safeDirectModelCall(transcript, language, sessionContext);
    }

    return sendSuccessResponse({
      responseText,
      language: forceLanguage || language,
      agentUsed,
      responseMode,
      agentTrace: actionCalled ? { actionCalled, agentUsed: true } : null,
      guardrailApplied: false,
      budgetMode,
    });
  } catch (err: any) {
    logger.error('Voice query crashed', { error: err.message });
    return sendErrorResponse(500, 'Failed to process voice query');
  }
};

async function maybeHandleStructuredWorkflow(args: {
  transcript: string;
  language: string;
  userId: string;
  sessionContext: SessionTurn[];
  idempotencyKey: string;
  channel: string;
  forceLanguage: string;
  confirmationToken: string;
}): Promise<ApplyFlowResult | null> {
  const { transcript, userId, sessionContext, idempotencyKey, confirmationToken } = args;
  const normalized = normalizeText(transcript);
  const intent = detectWorkflowIntent(normalized);
  if (intent === 'none') return null;
  const profile = await fetchUserProfile(userId);
  const runAction = async (functionName: string, parameters: Array<{ name: string; value: string }>) =>
    executeAgentAction({
      actionGroup: 'vaanisetu-actions',
      function: functionName,
      parameters,
      userId,
      sessionAttributes: { userId },
    });

  if (intent === 'status') {
    const appRef = extractApplicationRef(transcript) || extractApplicationRefFromContext(sessionContext);
    if (!appRef) {
      return {
        actionCalled: 'getApplicationStatus',
        responseText: 'Please share your application reference number (for example: VS-XXXX).',
        actionResultType: 'needs_application_reference',
        execution: { intent, confidence: 0.95, entities: { applicationRef: null }, steps: ['extract_ref_failed'] },
      };
    }
    const parsed = await runAction('getApplicationStatus', [
      { name: 'userId', value: userId },
      { name: 'applicationId', value: appRef },
    ]);
    if (parsed?.success === false) {
      return {
        actionCalled: 'getApplicationStatus',
        responseText: parsed.message || 'Unable to fetch application status right now.',
        actionResultType: 'status_error',
        execution: { intent, confidence: 0.98, entities: { applicationRef: appRef }, steps: ['getApplicationStatus'] },
      };
    }
    return {
      actionCalled: 'getApplicationStatus',
      responseText: `${parsed.message || `Application ${appRef} is ${parsed.status || 'under_review'}.`}${parsed.expectedDecision ? ` Expected decision: ${parsed.expectedDecision}.` : ''}`,
      actionResultType: 'status',
      execution: { intent, confidence: 0.98, entities: { applicationRef: appRef }, steps: ['getApplicationStatus'] },
    };
  }

  if (intent === 'language_update') {
    const preferred = parsePreferredLanguage(normalized);
    if (!preferred) {
      return {
        actionCalled: 'setPreferredLanguage',
        responseText: 'Please tell me which language to set: English, Hindi, Tamil, Telugu, Marathi, or Kannada.',
        actionResultType: 'language_validation_error',
        execution: { intent, confidence: 0.9, entities: {}, steps: ['language_parse_failed'] },
      };
    }
    const parsed = await runAction('setPreferredLanguage', [
      { name: 'userId', value: userId },
      { name: 'language', value: preferred },
    ]);
    return {
      actionCalled: 'setPreferredLanguage',
      responseText: parsed?.message || `Default language updated to ${preferred}.`,
      actionResultType: parsed?.success ? 'language_updated' : 'language_error',
      execution: { intent, confidence: 0.93, entities: { preferredLanguage: preferred }, steps: ['setPreferredLanguage'] },
    };
  }

  if (intent === 'profile_update') {
    const patch = parseProfilePatchFromTranscript(transcript);
    if (!Object.keys(patch).length) {
      return {
        actionCalled: 'updateUserProfile',
        responseText: 'I could not detect profile fields to update. Try: update my age 35 and occupation entrepreneur.',
        actionResultType: 'profile_validation_error',
        execution: { intent, confidence: 0.82, entities: {}, steps: ['profile_parse_failed'] },
      };
    }
    const parameters = Object.entries(patch).map(([name, value]) => ({ name, value: String(value) }));
    parameters.push({ name: 'userId', value: userId });
    const parsed = await runAction('updateUserProfile', parameters);
    const updatedFields = Array.isArray(parsed?.updatedFields) ? parsed.updatedFields.join(', ') : '';
    return {
      actionCalled: 'updateUserProfile',
      responseText: parsed?.success
        ? `Profile updated successfully.${updatedFields ? ` Updated fields: ${updatedFields}.` : ''}`
        : (parsed?.message || 'Could not update profile right now.'),
      actionResultType: parsed?.success ? 'profile_updated' : 'profile_error',
      execution: { intent, confidence: 0.88, entities: patch, steps: ['updateUserProfile'] },
    };
  }

  if (intent === 'jobs') {
    const state = extractStateHint(transcript, profile?.state || '');
    const occupation = String(profile?.occupation || '').trim();
    const parsed = await runAction('getJobsByProfile', [
      { name: 'state', value: state },
      { name: 'occupation', value: occupation },
    ]);
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
        execution: { intent, confidence: 0.92, entities: { state, occupation }, steps: ['getJobsByProfile'] },
      };
    }
    const lines = jobs.map((j: any, i: number) =>
      `${i + 1}. ${j.title} - ${j.company} (${j.state}) ${j.salaryRange ? `- ${j.salaryRange}` : ''}`.trim());
    return {
      actionCalled: 'getJobsByProfile',
      responseText: `Top job matches for you:\n${lines.join('\n')}`,
      actionResultType: 'jobs',
      execution: { intent, confidence: 0.92, entities: { state, occupation }, steps: ['getJobsByProfile'] },
    };
  }

  if (intent === 'schemes') {
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
    const schemes = Array.isArray(parsed?.schemes) ? parsed.schemes.slice(0, 5) : [];
    if (!schemes.length) {
      return {
        actionCalled: 'getSchemesByProfile',
        responseText: 'I could not find matching schemes. Please update your profile details (age, income, occupation, state).',
        actionResultType: 'schemes_empty',
        execution: { intent, confidence: 0.9, entities: { age, annualIncome, gender, state, occupation }, steps: ['getSchemesByProfile'] },
      };
    }
    const lines = schemes.map((s: any, i: number) =>
      `${i + 1}. ${s.name}${s.benefitRs ? ` - Rs ${Number(s.benefitRs).toLocaleString('en-IN')}` : ''} (${s.matchPercent || 0}% match)`);
    return {
      actionCalled: 'getSchemesByProfile',
      responseText: `Top schemes for you:\n${lines.join('\n')}\nSay: apply for <scheme name> to continue.`,
      actionResultType: 'schemes',
      execution: { intent, confidence: 0.9, entities: { age, annualIncome, gender, state, occupation }, steps: ['getSchemesByProfile'] },
    };
  }

  if (intent === 'scheme_lookup' || intent === 'scheme_detail') {
    const fn = intent === 'scheme_detail' ? 'getSchemeDetails' : 'resolveScheme';
    const parsed = await runAction(fn, [{ name: 'query', value: transcript }]);
    if (parsed?.success && parsed?.scheme) {
      const s = parsed.scheme;
      const benefit = s.benefitRs ? ` Benefit: Rs ${Number(s.benefitRs).toLocaleString('en-IN')}.` : '';
      return {
        actionCalled: fn,
        responseText: `${s.nameEn || s.name || s.code || 'Scheme'}${s.nameHi ? ` (${s.nameHi})` : ''}.${benefit} ${s.description || ''}`.trim(),
        actionResultType: intent === 'scheme_detail' ? 'scheme_detail' : 'scheme_lookup',
        execution: { intent, confidence: 0.86, entities: { query: transcript }, steps: [fn] },
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
          options: opts.map((o: any) => ({ id: o.id, code: o.code, name: o.name, benefitRs: o.benefitRs })),
        },
        actionResultType: 'scheme_disambiguation',
        execution: { intent, confidence: 0.78, entities: { query: transcript }, steps: [fn] },
      };
    }
    return {
      actionCalled: fn,
      responseText: parsed?.message || 'I could not find that scheme.',
      actionResultType: 'scheme_not_found',
      execution: { intent, confidence: 0.74, entities: { query: transcript }, steps: [fn] },
    };
  }

  const isConfirmIntent = /\b(confirm|yes|proceed|submit now|go ahead|haan|haanji)\b/.test(normalized);
  if (intent !== 'apply') return null;

  const explicitFromTurn = extractSchemeHintFromTranscript(transcript);
  const fromContext = extractPendingSchemeFromContext(sessionContext);
  const schemeHint = explicitFromTurn || fromContext || transcript;

  if (isConfirmIntent) {
    const stableConfirmIdempotencyKey = idempotencyKey || deriveIdempotencyKeyFromToken(confirmationToken);
    const parsed = await runAction('submitApplication', [
      { name: 'userId', value: userId },
      { name: 'confirm', value: 'true' },
      { name: 'confirmationToken', value: confirmationToken || '' },
      { name: 'query', value: schemeHint },
      { name: 'schemeName', value: schemeHint },
      { name: 'idempotencyKey', value: stableConfirmIdempotencyKey },
    ]);
    if (parsed?.success === true) {
      return {
        actionCalled: 'submitApplication',
        responseText: parsed.message || 'Application submitted.',
        applicationSubmitted: true,
        applicationId: parsed.applicationId,
        actionResultType: 'submitted',
        execution: { intent, confidence: 0.94, entities: { schemeHint }, steps: ['submitApplication'] },
      };
    }
    if (parsed?.code === 'AMBIGUOUS_TOP3' && Array.isArray(parsed?.options)) {
      const opts = parsed.options.slice(0, 3);
      return {
        actionCalled: 'submitApplication',
        responseText: `${parsed.message || 'I found multiple matching schemes.'} Please choose one option.`,
        pendingConfirmation: {
          type: 'scheme_disambiguation',
          options: opts.map((o: any) => ({ id: o.id, code: o.code, name: o.name, benefitRs: o.benefitRs })),
        },
        actionResultType: 'scheme_disambiguation',
        execution: { intent, confidence: 0.84, entities: { schemeHint }, steps: ['submitApplication'] },
      };
    }
    return {
      actionCalled: 'submitApplication',
      responseText: parsed?.message || 'Could not submit application right now.',
      actionResultType: 'submit_error',
      execution: { intent, confidence: 0.84, entities: { schemeHint }, steps: ['submitApplication'] },
    };
  }

  const parsed = await runAction('prepareApplication', [
    { name: 'userId', value: userId },
    { name: 'query', value: schemeHint },
    { name: 'schemeName', value: schemeHint },
  ]);
  if (parsed?.success === true && parsed?.code === 'NEEDS_CONFIRMATION' && parsed?.scheme) {
    const missing = Array.isArray(parsed.missingDocuments) && parsed.missingDocuments.length > 0
      ? ` Missing documents: ${parsed.missingDocuments.join(', ')}.`
      : '';
    return {
      actionCalled: 'prepareApplication',
      responseText: `You are applying for ${parsed.scheme.nameEn || parsed.scheme.name} (benefit up to Rs ${Number(parsed.scheme.benefitRs || 0).toLocaleString('en-IN')}).${missing} Say: confirm application for ${(parsed.scheme.nameEn || parsed.scheme.name)}.`,
      pendingConfirmation: {
        type: 'application_confirm',
        confirmationToken: parsed.confirmationToken || null,
        scheme: parsed.scheme,
        missingDocuments: parsed.missingDocuments || [],
      },
      actionResultType: 'prepare_apply',
      execution: { intent, confidence: 0.94, entities: { schemeHint }, steps: ['prepareApplication'] },
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
        options: opts.map((o: any) => ({ id: o.id, code: o.code, name: o.nameEn || o.name, benefitRs: o.benefitRs })),
      },
      actionResultType: 'scheme_disambiguation',
      execution: { intent, confidence: 0.82, entities: { schemeHint }, steps: ['prepareApplication'] },
    };
  }
  return {
    actionCalled: 'prepareApplication',
    responseText: parsed?.message || 'Please share the exact scheme name to continue.',
    actionResultType: 'apply_error',
    execution: { intent, confidence: 0.8, entities: { schemeHint }, steps: ['prepareApplication'] },
  };
}

function detectWorkflowIntent(normalized: string): WorkflowIntent {
  const hasRef = /\bvs-[a-z0-9-]{6,}\b/i.test(normalized);
  const isStatus = hasRef || /\b(status|track|tracking|application status)\b/.test(normalized);
  const isLanguageUpdate = /\b(change|set|update)\b.*\b(language|lang)\b|\bdefault language\b/.test(normalized);
  const isProfileUpdate = /\b(update|change|edit)\b.*\b(profile|age|income|occupation|state|district|gender|caste)\b/.test(normalized);
  const isApply = /\b(apply|submit)\b/.test(normalized) || (/\bapplication\b/.test(normalized) && !isStatus);
  const isJobs = /\b(job|jobs|employment|vacancy|work)\b/.test(normalized);
  const isSchemes = /\b(scheme|schemes|yojana|benefit|eligible|eligibility)\b/.test(normalized);
  const isSchemeDetails = /\b(detail|details|about|information|info)\b/.test(normalized);
  const hasDevanagari = /[\u0900-\u097F]/.test(normalized);
  const likelySchemeName = /\b(pm|kisan|mudra|india|yojana|yojna|bharat|aawas|stand|startup|ayushman|ujjwala|nrega|svanidhi|udyam|scholarship|subsidy|loan)\b/.test(normalized)
    || (hasDevanagari && normalized.split(' ').filter(Boolean).length >= 2);

  if (isStatus) return 'status';
  if (isLanguageUpdate) return 'language_update';
  if (isProfileUpdate) return 'profile_update';
  if (isJobs) return 'jobs';
  if (isApply) return 'apply';
  if (isSchemeDetails) return 'scheme_detail';
  if (isSchemes) return 'schemes';
  if (likelySchemeName) return 'scheme_lookup';
  return 'none';
}

function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function parseProfilePatchFromTranscript(transcript: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const text = transcript.toLowerCase();
  const age = text.match(/\bage\s+(\d{1,3})\b/);
  const income = text.match(/\b(?:income|annual income)\s+(\d{3,})\b/);
  const occupation = text.match(/\boccupation\s+([a-z_ ]{3,40})\b/);
  const state = text.match(/\bstate\s+([a-z ]{3,30})\b/);
  const district = text.match(/\bdistrict\s+([a-z ]{3,30})\b/);
  const gender = text.match(/\bgender\s+(male|female|other|m|f)\b/);
  const caste = text.match(/\bcaste\s+(general|obc|sc|st|ews)\b/);

  if (age?.[1]) out.age = Number(age[1]);
  if (income?.[1]) out.annualIncome = Number(income[1]);
  if (occupation?.[1]) out.occupation = occupation[1].trim().replace(/\s+/g, '_');
  if (state?.[1]) out.state = state[1].trim();
  if (district?.[1]) out.district = district[1].trim();
  if (gender?.[1]) out.gender = gender[1].toUpperCase();
  if (caste?.[1]) out.casteCategory = caste[1].toUpperCase();
  return out;
}

function getBudgetMode(): 'normal' | 'guarded' | 'strict' {
  const mode = String(process.env.BUDGET_MODE || 'normal').toLowerCase();
  if (mode === 'strict') return 'strict';
  if (mode === 'guarded') return 'guarded';
  return 'normal';
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

function extractToolBody(actionResponse: any): Record<string, any> {
  const rawBody = actionResponse?.response?.functionResponse?.responseBody?.TEXT?.body;
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
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
  const { agentId, agentAliasId, sessionId, inputText, userId, language } = params;

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
    const { handler: actionHandler } = await import('../agent/action-handler.js');
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
  const systemPrompt = `You are VaaniSetu, an AI assistant helping rural Indian citizens access government welfare schemes and jobs.
You know about PM-KISAN (₹6000/year for farmers), Ayushman Bharat (₹5 lakh health cover), PM Aawas Yojana (housing), MNREGA (employment), Ujjwala Yojana (gas connections), scholarship schemes, PM Mudra Loan, PM SVANidhi, and many more.
Always respond in ${langLabel}. Be warm, helpful, and concise (2-3 sentences). 
When asked about schemes, list them with benefit amounts. When asked to apply, say they can apply from the Schemes page.`;

  const messages = [
    ...sessionContext.slice(-6).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    })),
    { role: 'user' as const, content: [{ text: transcript }] },
  ];

  const response = await bedrockRuntime.send(new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: { maxTokens: 512, temperature: 0.6 },
  }));

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

function getLangLabel(language: string): string {
  const map: Record<string, string> = {
    'hi': 'Hindi', 'ta': 'Tamil', 'te': 'Telugu',
    'mr': 'Marathi', 'kn': 'Kannada', 'en': 'English',
  };
  for (const [k, v] of Object.entries(map)) {
    if (language.startsWith(k)) return v;
  }
  return 'English';
}

function deriveIdempotencyKeyFromToken(token: string): string {
  if (!token) return '';
  return `confirm-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
}
