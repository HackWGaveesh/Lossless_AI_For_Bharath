import type { APIGatewayProxyHandler } from 'aws-lambda';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const rds = new RDSDataClient({ region: process.env.REGION });

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    logger.info('Fetching schemes list', { requestId: event.requestContext?.requestId });

    const { category, benefitType, limit = '50', offset = '0' } = event.queryStringParameters || {};

    let sql = `SELECT scheme_id, name_en, name_hi, description, benefit_amount_min, benefit_amount_max, eligibility_criteria FROM schemes WHERE is_active = true`;
    const parameters: { name: string; value: { stringValue?: string; longValue?: number } }[] = [];

    if (category) {
      sql += ' AND category = :category';
      parameters.push({ name: 'category', value: { stringValue: category } });
    }

    if (benefitType) {
      sql += ' AND benefit_type = :benefitType';
      parameters.push({ name: 'benefitType', value: { stringValue: benefitType } });
    }

    sql += ' ORDER BY benefit_amount_max DESC NULLS LAST LIMIT :limit OFFSET :offset';
    parameters.push(
      { name: 'limit', value: { longValue: parseInt(limit, 10) || 50 } },
      { name: 'offset', value: { longValue: parseInt(offset, 10) || 0 } }
    );

    const result = await rds.send(new ExecuteStatementCommand({
      resourceArn: process.env.DB_CLUSTER_ARN!,
      secretArn: process.env.DB_SECRET_ARN!,
      database: process.env.DB_NAME!,
      sql,
      parameters: parameters as never,
    }));

    const schemes = (result.records ?? []).map((record) => ({
      schemeId: record[0]?.stringValue,
      nameEn: record[1]?.stringValue,
      nameHi: record[2]?.stringValue,
      description: record[3]?.stringValue,
      benefitAmountMin: record[4]?.longValue ?? record[4]?.doubleValue,
      benefitAmountMax: record[5]?.longValue ?? record[5]?.doubleValue,
      eligibilityCriteria: safeJsonParse(record[6]?.stringValue),
    }));

    return sendSuccessResponse({ schemes, total: schemes.length });
  } catch (error) {
    logger.error('Error fetching schemes', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};

function safeJsonParse(str: string | undefined): Record<string, unknown> {
  if (!str) return {};
  try {
    return JSON.parse(str) as Record<string, unknown>;
  } catch {
    return {};
  }
}
