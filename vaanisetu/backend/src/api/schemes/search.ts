import type { APIGatewayProxyHandler } from 'aws-lambda';
import { BedrockAgentRuntimeClient, InvokeAgentCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const bedrockAgent = new BedrockAgentRuntimeClient({ region: process.env.REGION });
const rds = new RDSDataClient({ region: process.env.REGION });

interface UserProfile {
  age?: number;
  gender?: string;
  occupation?: string;
  annualIncome?: number;
  casteCategory?: string;
  state?: string;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { userProfile, query } = body as { userProfile?: UserProfile; query?: string };

    logger.info('Searching schemes with AI', { userProfile, query });

    let responseText = '';
    const agentId = process.env.BEDROCK_AGENT_ID;
    const agentAliasId = process.env.BEDROCK_AGENT_ALIAS_ID || 'TSTALIASID';

    if (agentId && agentAliasId) {
      try {
        const agentCommand = new InvokeAgentCommand({
          agentId,
          agentAliasId,
          sessionId: `session-${Date.now()}`,
          inputText: `Find eligible schemes for user: ${JSON.stringify(userProfile || {})}. Query: ${query || 'all schemes'}`,
        });

        const agentResponse = await bedrockAgent.send(agentCommand);
        if (agentResponse.completion) {
          for await (const ev of agentResponse.completion) {
            if (ev.chunk?.bytes) {
              responseText += Buffer.from(ev.chunk.bytes).toString('utf-8');
            }
          }
        }
      } catch (agentError) {
        logger.warn('Bedrock agent invocation failed, falling back to DB', { agentError });
      }
    }

    const schemeIds = extractSchemeIds(responseText);

    const schemes = schemeIds.length > 0
      ? await fetchSchemeDetails(schemeIds)
      : await fetchAllSchemes(10);

    const profile = userProfile || {};
    const rankedSchemes = schemes
      .map((scheme) => ({
        ...scheme,
        eligibilityScore: calculateEligibility(profile, scheme.eligibilityCriteria as Record<string, unknown>),
      }))
      .sort((a, b) => (b.eligibilityScore ?? 0) - (a.eligibilityScore ?? 0));

    return sendSuccessResponse({
      schemes: rankedSchemes.slice(0, 10),
      agentInsights: responseText || 'Scheme list from database.',
    });
  } catch (error) {
    logger.error('Error searching schemes', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};

function extractSchemeIds(text: string): string[] {
  const matches = text.match(/SCHEME-\d+/g);
  return matches ? [...new Set(matches)] : [];
}

interface SchemeRow {
  schemeId: string;
  nameEn: string;
  description: string;
  eligibilityCriteria: Record<string, unknown>;
  benefitAmountMax: number;
}

async function fetchSchemeDetails(schemeIds: string[]): Promise<SchemeRow[]> {
  if (schemeIds.length === 0) return [];

  const placeholders = schemeIds.map((_, i) => `:id${i}`).join(',');
  const parameters = schemeIds.map((id, i) => ({
    name: `id${i}`,
    value: { stringValue: id },
  }));

  const result = await rds.send(new ExecuteStatementCommand({
    resourceArn: process.env.DB_CLUSTER_ARN!,
    secretArn: process.env.DB_SECRET_ARN!,
    database: process.env.DB_NAME!,
    sql: `SELECT scheme_id, name_en, description, eligibility_criteria, benefit_amount_max FROM schemes WHERE scheme_id IN (${placeholders}) AND is_active = true`,
    parameters,
  }));

  return (result.records ?? []).map((record) => ({
    schemeId: record[0]?.stringValue ?? '',
    nameEn: record[1]?.stringValue ?? '',
    description: record[2]?.stringValue ?? '',
    eligibilityCriteria: safeJsonParse(record[3]?.stringValue),
    benefitAmountMax: record[4]?.longValue ?? record[4]?.doubleValue ?? 0,
  }));
}

async function fetchAllSchemes(limit: number): Promise<SchemeRow[]> {
  const result = await rds.send(new ExecuteStatementCommand({
    resourceArn: process.env.DB_CLUSTER_ARN!,
    secretArn: process.env.DB_SECRET_ARN!,
    database: process.env.DB_NAME!,
    sql: `SELECT scheme_id, name_en, description, eligibility_criteria, benefit_amount_max FROM schemes WHERE is_active = true ORDER BY benefit_amount_max DESC NULLS LAST LIMIT :lim`,
    parameters: [{ name: 'lim', value: { longValue: limit } }],
  }));

  return (result.records ?? []).map((record) => ({
    schemeId: record[0]?.stringValue ?? '',
    nameEn: record[1]?.stringValue ?? '',
    description: record[2]?.stringValue ?? '',
    eligibilityCriteria: safeJsonParse(record[3]?.stringValue),
    benefitAmountMax: record[4]?.longValue ?? record[4]?.doubleValue ?? 0,
  }));
}

function safeJsonParse(str: string | undefined): Record<string, unknown> {
  if (!str) return {};
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function calculateEligibility(userProfile: UserProfile, criteria: Record<string, unknown>): number {
  let score = 0;
  let total = 0;

  const ageMin = criteria.ageMin as number | undefined;
  const ageMax = criteria.ageMax as number | undefined;
  if (ageMin != null && ageMax != null) {
    total += 20;
    if (userProfile.age != null && userProfile.age >= ageMin && userProfile.age <= ageMax) {
      score += 20;
    }
  }

  const incomeMax = criteria.incomeMax as number | undefined;
  if (incomeMax != null) {
    total += 25;
    if (userProfile.annualIncome != null && userProfile.annualIncome <= incomeMax) {
      score += 25;
    }
  }

  const gender = criteria.gender as string | undefined;
  if (gender) {
    total += 15;
    if (gender === 'all' || userProfile.gender === gender) {
      score += 15;
    }
  }

  const casteCategories = criteria.casteCategories as string[] | undefined;
  if (casteCategories?.length) {
    total += 20;
    if (userProfile.casteCategory && casteCategories.includes(userProfile.casteCategory)) {
      score += 20;
    }
  }

  const states = criteria.states as string[] | undefined;
  if (states?.length) {
    total += 20;
    if (userProfile.state && states.includes(userProfile.state)) {
      score += 20;
    }
  }

  return total > 0 ? Math.round((score / total) * 100) : 50;
}
