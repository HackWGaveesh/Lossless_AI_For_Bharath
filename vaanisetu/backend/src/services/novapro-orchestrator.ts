/**
 * VaaniSetu Nova Pro Orchestrator
 *
 * Replaces raw template-string responses (e.g. "Top schemes for you:\n${lines}")
 * with grounded, empathetic Amazon Nova Pro responses that:
 *   - Are in the user's language
 *   - Include real scheme data injected as context (no hallucination)
 *   - Respect Bedrock Guardrails when configured
 *   - Return serviceTrace for AWS attribution in the UI
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { logger } from '../utils/logger.js';

const bedrockRuntime = new BedrockRuntimeClient({ region: 'us-east-1' });
const MODEL_ID = 'us.amazon.nova-pro-v1:0';

const GUARDRAIL_ID = process.env.BEDROCK_GUARDRAIL_ID || '';
const GUARDRAIL_VERSION = process.env.BEDROCK_GUARDRAIL_VERSION || 'DRAFT';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface SchemeSummary {
  id: string;
  code: string;
  name: string;
  nameHi?: string;
  description: string;
  benefitRs: number;
  category: string;
  eligibilityScore?: number;
  matchReasons?: string[];
  exclusionReasons?: string[];
}

export interface JobSummary {
  title: string;
  company: string;
  state: string;
  salaryRange?: string;
}

export interface OrchestratorInput {
  intent: 'schemes' | 'scheme_detail' | 'jobs' | 'apply' | 'status' | 'profile_update' | 'language_update' | 'general';
  language: string;            // e.g. 'hi-IN', 'ta-IN', 'en-IN'
  transcript: string;
  schemes?: SchemeSummary[];
  jobs?: JobSummary[];
  userProfile?: Record<string, any>;
  additionalContext?: string;  // raw text to inject (e.g. application status)
  sessionContext?: Array<{ role: string; content: string }>;
}

export interface OrchestratorResult {
  responseText: string;
  guardrailApplied: boolean;
  tokensUsed?: number;
  serviceTrace: {
    model: string;
    region: string;
    guardrailId: string | null;
    guardrailTriggered: boolean;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Language helpers
// ──────────────────────────────────────────────────────────────────────────

function getLangLabel(language: string): string {
  const map: Record<string, string> = {
    hi: 'Hindi', ta: 'Tamil', te: 'Telugu',
    mr: 'Marathi', kn: 'Kannada', en: 'English',
  };
  for (const [k, v] of Object.entries(map)) {
    if (language.startsWith(k)) return v;
  }
  return 'English';
}

// ──────────────────────────────────────────────────────────────────────────
// System prompt builder
// ──────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(langLabel: string, intent: OrchestratorInput['intent']): string {
  const base = `You are VaaniSetu, a warm and helpful AI assistant for rural Indian citizens.
You help people discover government welfare schemes and jobs, check eligibility, and apply.
You MUST respond ENTIRELY in ${langLabel} using its native script. Do NOT mix in English unless ${langLabel} IS English.
Be concise (2-4 sentences), empathetic, and non-technical.
Use natural conversational language — no bullet-point lists unless the user asked for a list.
IMPORTANT RULES:
- Only mention schemes and facts provided in <DATA> tags below. Never invent scheme names, benefit amounts, or eligibility rules.
- If a scheme shows "exclusionReasons", NEVER suggest that scheme to the user.
- If you mention a benefit amount, use the exact ₹ value from the data provided.
- Acknowledge the user's background (occupation, state, income) when responding about eligibility.
- AWS services powering this response: Amazon Bedrock Nova Pro, Amazon DynamoDB, Amazon Lambda.

Language specific instructions for ${langLabel}:
- If ${langLabel} is Hindi: respond in Devanagari script. Use simple everyday Hindi, not Sanskritized.
- If ${langLabel} is Tamil: respond in Tamil script (தமிழ்). Use formal but friendly Tamil.
- If ${langLabel} is Telugu: respond in Telugu script (తెలుగు). Use conversational Telugu.
- If ${langLabel} is Kannada: respond in Kannada script (ಕನ್ನಡ). Use everyday Kannada.
- If ${langLabel} is Marathi: respond in Devanagari script. Use conversational Marathi.
- If ${langLabel} is English: respond in simple Indian English, using occasional Hindi terms when natural.`;

  const intentHints: Record<string, string> = {
    schemes: `When listing schemes: name 2-3 top matches with their ₹ benefit amounts. End with a prompt to apply.`,
    scheme_detail: `Describe the scheme in 2-3 sentences covering: what it gives, who qualifies, and how to apply.`,
    jobs: `List available jobs with salary ranges. Mention the location and employer.`,
    apply: `Walk the user through the application step: confirm scheme details and ask them to confirm.`,
    status: `State the application status clearly and reassure the user.`,
    profile_update: `Confirm what was updated and what it means for their eligibility.`,
    language_update: `Confirm language change warmly in the NEW language.`,
    general: `Answer helpfully. If asked about a scheme not in the data, say you'll look it up.`,
  };

  return `${base}\n\nTask context: ${intentHints[intent] ?? intentHints.general}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Data context builder
// ──────────────────────────────────────────────────────────────────────────

function buildDataContext(input: OrchestratorInput): string {
  const parts: string[] = [];

  if (input.userProfile) {
    const p = input.userProfile;
    const items = [
      p.name ? `Name: ${p.name}` : null,
      p.age ? `Age: ${p.age}` : null,
      p.gender ? `Gender: ${p.gender}` : null,
      (p.casteCategory || p.caste_category) ? `Caste: ${p.casteCategory || p.caste_category}` : null,
      p.occupation ? `Occupation: ${p.occupation}` : null,
      (p.annualIncome || p.annual_income) ? `Annual Income: ₹${(Number(p.annualIncome || p.annual_income)).toLocaleString('en-IN')}` : null,
      p.state ? `State: ${p.state}` : null,
      p.district ? `District: ${p.district}` : null,
      p.phone ? `Phone: ${p.phone}` : null,
      p.address ? `Address: ${p.address}` : null,
    ].filter(Boolean);
    if (items.length) parts.push(`<USER_PROFILE>\n${items.join('\n')}\n</USER_PROFILE>`);
  }

  if (input.schemes?.length) {
    const schemeLines = input.schemes
      .filter(s => !s.exclusionReasons?.length)   // Only include eligible schemes in data context
      .slice(0, 6)
      .map(s => {
        const reasons = s.matchReasons?.length ? ` [Eligible: ${s.matchReasons.join('; ')}]` : '';
        return `- ${s.name}${s.nameHi ? ` (${s.nameHi})` : ''}: ${s.description} Benefit: ₹${Number(s.benefitRs).toLocaleString('en-IN')}. Match: ${s.eligibilityScore ?? '?'}%.${reasons}`;
      });
    if (schemeLines.length) {
      parts.push(`<ELIGIBLE_SCHEMES>\n${schemeLines.join('\n')}\n</ELIGIBLE_SCHEMES>`);
    }

    const excluded = input.schemes.filter(s => s.exclusionReasons?.length);
    if (excluded.length) {
      const excLines = excluded.slice(0, 4).map(s =>
        `- ${s.name}: NOT eligible — ${s.exclusionReasons![0]}`
      );
      parts.push(`<INELIGIBLE_SCHEMES (DO NOT SUGGEST)>\n${excLines.join('\n')}\n</INELIGIBLE_SCHEMES>`);
    }
  }

  if (input.jobs?.length) {
    const jobLines = input.jobs.slice(0, 6).map(j =>
      `- ${j.title} at ${j.company} (${j.state})${j.salaryRange ? ` — ${j.salaryRange}` : ''}`
    );
    parts.push(`<JOBS>\n${jobLines.join('\n')}\n</JOBS>`);
  }

  if (input.additionalContext) {
    parts.push(`<ADDITIONAL_INFO>\n${input.additionalContext}\n</ADDITIONAL_INFO>`);
  }

  return parts.length ? `\n\n<DATA>\n${parts.join('\n\n')}\n</DATA>` : '';
}

// ──────────────────────────────────────────────────────────────────────────
// Main orchestrator function
// ──────────────────────────────────────────────────────────────────────────

export async function generateResponse(input: OrchestratorInput): Promise<OrchestratorResult> {
  const langLabel = getLangLabel(input.language);
  const systemPrompt = buildSystemPrompt(langLabel, input.intent);
  const dataContext = buildDataContext(input);

  // Compose user message = data context + transcript
  const userMessage = dataContext
    ? `${dataContext}\n\nUser says: ${input.transcript}`
    : input.transcript;

  const messages = [
    ...(input.sessionContext ?? []).slice(-4).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: [{ text: m.content }],
    })),
    { role: 'user' as const, content: [{ text: userMessage }] },
  ];

  const converseParams: Parameters<typeof bedrockRuntime.send>[0] extends ConverseCommand
    ? ConstructorParameters<typeof ConverseCommand>[0]
    : any = {
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: {
      maxTokens: 900,
      temperature: 0.55,
      topP: 0.85,
    },
  };

  // Wire Bedrock Guardrails when configured
  if (GUARDRAIL_ID) {
    (converseParams as any).guardrailConfig = {
      guardrailIdentifier: GUARDRAIL_ID,
      guardrailVersion: GUARDRAIL_VERSION,
      trace: 'enabled',
    };
  }

  const startMs = Date.now();
  let guardrailApplied = false;
  let guardrailTriggered = false;

  try {
    const response = await bedrockRuntime.send(new ConverseCommand(converseParams));
    const latencyMs = Date.now() - startMs;
    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;

    // Check if guardrail fired
    const guardrailTrace = (response as any).trace?.guardrail;
    if (guardrailTrace?.inputAssessment || guardrailTrace?.outputAssessments) {
      guardrailApplied = true;
      const outputA = guardrailTrace.outputAssessments?.['0'] ?? {};
      guardrailTriggered = outputA.contentPolicy?.filters?.some((f: any) => f.action === 'BLOCKED') ?? false;
    }

    const responseText = response.output?.message?.content?.[0]?.text?.trim() ?? '';

    logger.info('Nova Pro response generated', {
      intent: input.intent,
      language: input.language,
      inputTokens,
      outputTokens,
      latencyMs,
      guardrailApplied,
    });

    return {
      responseText,
      guardrailApplied,
      tokensUsed: inputTokens + outputTokens,
      serviceTrace: {
        model: MODEL_ID,
        region: 'us-east-1',
        guardrailId: GUARDRAIL_ID || null,
        guardrailTriggered,
        inputTokens,
        outputTokens,
        latencyMs,
      },
    };
  } catch (err: any) {
    logger.error('Nova Pro generation failed', { error: err?.message, intent: input.intent });
    throw err;
  }
}

/**
 * Safe wrapper — falls back to a structured template string on failure
 * so the caller always gets a response.
 */
export async function safeGenerateResponse(
  input: OrchestratorInput,
  fallbackText: string,
): Promise<OrchestratorResult> {
  try {
    return await generateResponse(input);
  } catch (err: any) {
    logger.warn('safeGenerateResponse falling back to template', { error: err?.message });
    return {
      responseText: fallbackText,
      guardrailApplied: false,
      serviceTrace: {
        model: MODEL_ID,
        region: 'us-east-1',
        guardrailId: null,
        guardrailTriggered: false,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      },
    };
  }
}
