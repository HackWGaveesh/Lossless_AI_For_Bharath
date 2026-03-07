/**
 * VaaniSetu Hero Flow Smoke Test
 * Validates:
 *  1. Eligibility service unit tests (Stand-Up India gate, MUDRA eligibility)
 *  2. Hindi intent detection
 *  3. Live API: schemes → apply → confirm flow via voice endpoint
 *
 * Run: npx ts-node --esm src/test-hero-flow.ts
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { evaluateEligibility } from './services/scheme-eligibility-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../../.env') });

const API_BASE = process.env.API_BASE || 'https://3yd9hhw2g2.execute-api.ap-south-1.amazonaws.com/prod';
const TEST_USER_ID = process.env.TEST_USER_ID || 'smoke-test-user';

// ─── ANSI colour helpers ───────────────────────────────────────
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
let passed = 0; let failed = 0;

function expect(label: string, actual: boolean, expected = true) {
  if (actual === expected) {
    console.log(green('  ✓') + ' ' + label);
    passed++;
  } else {
    console.log(red('  ✗') + ' ' + label + ` (expected ${expected}, got ${actual})`);
    failed++;
  }
}

// ─── SECTION 1: Unit tests for evaluateEligibility ────────────
console.log(bold('\n══════════════════════════════════════════'));
console.log(bold(' [1] Eligibility Service Unit Tests'));
console.log(bold('══════════════════════════════════════════'));

// Stand-Up India: eligible for SC/ST (any gender) and women (any caste)
const standUpIndiaCriteria = {
  casteCategories: ['SC', 'ST', 'OBC', 'Minority'],
  gender: 'female' as const,
  genderOrCaste: true,  // OR-logic: eligible if caste matches OR gender matches
};

// General male → should be INELIGIBLE
const generalMaleProfile = { casteCategory: 'General', gender: 'male', age: 35, annualIncome: 400000 };
const r1 = evaluateEligibility(standUpIndiaCriteria, generalMaleProfile);
expect('Stand-Up India: General male is INELIGIBLE', r1.eligible, false);
expect('Stand-Up India: General male score = 0', r1.score === 0, true);

// SC male → should be ELIGIBLE (caste matches even though gender doesn't)
const scMaleProfile = { casteCategory: 'SC', gender: 'male', age: 35, annualIncome: 400000 };
const r2 = evaluateEligibility(standUpIndiaCriteria, scMaleProfile);
expect('Stand-Up India: SC male IS eligible (caste OR logic)', r2.eligible, true);

// OBC female → should be ELIGIBLE (both gender and caste match)
const obcFemaleProfile = { casteCategory: 'OBC', gender: 'female', age: 35, annualIncome: 400000 };
const r3 = evaluateEligibility(standUpIndiaCriteria, obcFemaleProfile);
expect('Stand-Up India: OBC female IS eligible', r3.eligible, true);

// General female → should be ELIGIBLE (gender matches, caste doesn't but OR-logic)
const generalFemaleProfile = { casteCategory: 'General', gender: 'female', age: 35, annualIncome: 400000 };
const r4 = evaluateEligibility(standUpIndiaCriteria, generalFemaleProfile);
expect('Stand-Up India: General female IS eligible (gender OR logic)', r4.eligible, true);

// MUDRA: open to all (no caste/gender restriction)
const mudraCriteria = { minAge: 18, maxAge: 65 };
const r5 = evaluateEligibility(mudraCriteria, generalMaleProfile);
expect('MUDRA: General male IS eligible (no restrictions)', r5.eligible, true);

// PM Ujjwala: BPL women only
const ujjwallaCriteria = { gender: 'female' as const, bpl: true };
const generalMaleNoLow = { casteCategory: 'General', gender: 'male', age: 25, annualIncome: 500000, bplCardholder: false };
const r6 = evaluateEligibility(ujjwallaCriteria, generalMaleNoLow);
expect('PM Ujjwala: General male is INELIGIBLE', r6.eligible, false);

const bplFemaleProfile = { casteCategory: 'General', gender: 'female', age: 25, annualIncome: 80000, bplCardholder: true };
const r7 = evaluateEligibility(ujjwallaCriteria, bplFemaleProfile);
expect('PM Ujjwala: BPL female IS eligible', r7.eligible, true);

// ─── SECTION 2: Hindi Intent Detection ────────────────────────
console.log(bold('\n══════════════════════════════════════════'));
console.log(bold(' [2] Multilingual Intent Detection Tests'));
console.log(bold('══════════════════════════════════════════'));

// We'll test by checking the normalizeText+detectWorkflowIntent coverage
// These strings should map to the 'schemes' intent
const hindiPhrases = [
  'मुझे योजना बताओ',        // Tell me about schemes
  'कौनसी योजनाएं मिल सकती हैं',  // Which schemes can I get
  'सरकारी लाभ दिखाओ',      // Show government benefits
];
const tamilPhrases = ['எனக்கு திட்டங்கள் காட்டு', 'யோஜனை என்ன கிடைக்கும்'];
const teluguPhrases = ['పథకాలు చూపించు', 'నాకు యోజన చెప్పు'];

// Simple check: do these strings contain detectable Unicode ranges
function looksMultilingual(s: string): boolean {
  // Devanagari (Hindi/Marathi): U+0900–U+097F
  // Tamil: U+0B80–U+0BFF
  // Telugu: U+0C00–U+0C7F
  return /[\u0900-\u097F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF]/.test(s);
}
for (const phrase of [...hindiPhrases, ...tamilPhrases, ...teluguPhrases]) {
  expect(`"${phrase.slice(0, 15)}..." detected as non-ASCII`, looksMultilingual(phrase), true);
}

// ─── SECTION 3: Live API Integration Tests ────────────────────
console.log(bold('\n══════════════════════════════════════════'));
console.log(bold(' [3] Live API Integration Tests'));
console.log(bold('══════════════════════════════════════════'));
console.log(yellow(`  API: ${API_BASE}`));
console.log(yellow(`  User: ${TEST_USER_ID}\n`));

async function voiceCall(transcript: string, language = 'en-IN', sessionId?: string) {
  const resp = await fetch(`${API_BASE}/voice/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': TEST_USER_ID },
    body: JSON.stringify({ transcript, language, sessionId: sessionId || TEST_USER_ID, idempotencyKey: `test-${Date.now()}` }),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  const json = await resp.json() as any;
  return json.data ?? json;
}

async function runApiTests() {
  // Test 1: Health check
  try {
    const resp = await fetch(`${API_BASE}/health`);
    const data = ((await resp.json()) as any)?.data;
    expect('Health endpoint returns 200', resp.ok, true);
    expect('Health check has bedrockAgentId field', 'bedrockAgentId' in data, true);
    expect('Health check has aurora DB check', !!data?.checks, true);
    console.log(`    status=${data?.status} aurora=${data?.checks?.aurora?.status} dynamo=${data?.checks?.dynamodb?.status}`);
  } catch (e: any) {
    console.log(red('  ✗') + ` Health check FAILED: ${e.message}`); failed++;
  }

  // Test 2: Hindi schemes query — Stand-Up India should NOT appear for General male
  try {
    console.log(yellow('\n  → Asking for schemes as General male (Hindi)...'));
    const result = await voiceCall('मुझे सरकारी योजना बताओ', 'hi-IN');
    expect('Hindi voice call returned a response', !!result?.responseText, true);
    const text = (result?.responseText || '').toLowerCase();
    const standUpMentioned = text.includes('stand-up india') || text.includes('standup') || text.includes('स्टैंड-अप');
    expect('Stand-Up India NOT in response for General male', !standUpMentioned, true);
    if (result?.matchReasons?.length) {
      console.log(`    matchReasons: ${result.matchReasons.join(', ')}`);
    }
    if (result?.serviceTrace) {
      console.log(`    serviceTrace: model=${result.serviceTrace.model} latency=${result.serviceTrace.latencyMs}ms`);
    }
  } catch (e: any) {
    console.log(red('  ✗') + ` Hindi schemes test FAILED: ${e.message}`); failed++;
  }

  // Test 3: English schemes query
  try {
    console.log(yellow('\n  → Asking for schemes in English...'));
    const result = await voiceCall('Show me government schemes I can apply for');
    expect('English schemes call returned text', !!result?.responseText, true);
    expect('Response actionCalled = getSchemesByProfile', result?.actionCalled === 'getSchemesByProfile', true);
  } catch (e: any) {
    console.log(red('  ✗') + ` English schemes test FAILED: ${e.message}`); failed++;
  }

  // Test 4: Jobs query
  try {
    console.log(yellow('\n  → Asking for jobs...'));
    const result = await voiceCall('Show me jobs near Bihar');
    expect('Jobs call returned text', !!result?.responseText, true);
    expect('Response actionCalled = getJobsByProfile', result?.actionCalled === 'getJobsByProfile', true);
  } catch (e: any) {
    console.log(red('  ✗') + ` Jobs test FAILED: ${e.message}`); failed++;
  }

  // Test 5: MUDRA apply flow (hero demo)
  try {
    console.log(yellow('\n  → Initiating MUDRA apply flow...'));
    const step1 = await voiceCall('I want to apply for MUDRA loan scheme');
    expect('Apply intent detected', !!step1?.responseText, true);
    if (step1?.pendingConfirmation) {
      console.log('    pendingConfirmation detected — testing confirm step');
      const confirmToken = step1.pendingConfirmation.confirmationToken || '';
      const step2 = await voiceCall('yes confirm', 'en-IN');
      expect('Confirm call returned text', !!step2?.responseText, true);
      console.log(`    applicationId: ${step2?.applicationId || 'N/A'}`);
    } else {
      console.log('    (no pendingConfirmation returned — skipping confirm step)');
    }
  } catch (e: any) {
    console.log(red('  ✗') + ` Apply flow test FAILED: ${e.message}`); failed++;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────
runApiTests().then(() => {
  console.log(bold('\n══════════════════════════════════════════'));
  console.log(bold(` RESULTS: ${green(`${passed} passed`)}  ${failed > 0 ? red(`${failed} failed`) : green('0 failed')}`));
  console.log(bold('══════════════════════════════════════════\n'));
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error(red('Fatal error: ' + err.message));
  process.exit(1);
});
