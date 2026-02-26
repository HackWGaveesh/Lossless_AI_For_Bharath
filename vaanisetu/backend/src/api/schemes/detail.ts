import type { APIGatewayProxyHandler } from 'aws-lambda';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const rds = new RDSDataClient({ region: process.env.REGION });

function safeJsonParse<T>(s: string | undefined): T {
  if (!s) return {} as T;
  try {
    return JSON.parse(s) as T;
  } catch {
    return {} as T;
  }
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const schemeId = event.pathParameters?.schemeId ?? event.pathParameters?.id;
    if (!schemeId) {
      return sendErrorResponse(400, 'Missing schemeId');
    }

    logger.info('Fetching scheme detail', { schemeId });

    const result = await rds.send(
      new ExecuteStatementCommand({
        resourceArn: process.env.DB_CLUSTER_ARN!,
        secretArn: process.env.DB_SECRET_ARN!,
        database: process.env.DB_NAME!,
        sql: `SELECT scheme_id, scheme_code, name_en, name_hi, name_ta, name_te, description, category, benefit_type,
              benefit_amount_min, benefit_amount_max, ministry, level, eligibility_criteria, documents_required,
              application_url, is_active, created_at
              FROM schemes WHERE scheme_id = :id AND is_active = true LIMIT 1`,
        parameters: [{ name: 'id', value: { stringValue: schemeId } }],
      })
    );

    const row = result.records?.[0];
    if (!row) {
      return sendErrorResponse(404, 'Scheme not found');
    }

    const scheme = {
      schemeId: row[0]?.stringValue,
      schemeCode: row[1]?.stringValue,
      nameEn: row[2]?.stringValue,
      nameHi: row[3]?.stringValue,
      nameTa: row[4]?.stringValue,
      nameTe: row[5]?.stringValue,
      description: row[6]?.stringValue,
      category: row[7]?.stringValue,
      benefitType: row[8]?.stringValue,
      benefitAmountMin: row[9]?.longValue ?? row[9]?.doubleValue,
      benefitAmountMax: row[10]?.longValue ?? row[10]?.doubleValue,
      ministry: row[11]?.stringValue,
      level: row[12]?.stringValue,
      eligibilityCriteria: safeJsonParse<Record<string, unknown>>(row[13]?.stringValue),
      documentsRequired: safeJsonParse<string[]>(row[14]?.stringValue),
      applicationUrl: row[15]?.stringValue,
      isActive: row[16]?.stringValue === 'true',
      createdAt: row[17]?.stringValue,
    };

    return sendSuccessResponse({ scheme });
  } catch (error) {
    logger.error('Scheme detail error', { error });
    return sendErrorResponse(500, 'Failed to fetch scheme');
  }
};
