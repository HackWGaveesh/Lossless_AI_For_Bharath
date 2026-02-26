import type { APIGatewayProxyHandler } from 'aws-lambda';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const rds = new RDSDataClient({ region: process.env.REGION });

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const { state, type, salary_min, limit = '20', offset = '0' } = event.queryStringParameters ?? {};

    let sql = `SELECT job_id, title, company, state, district, job_type, salary_min, salary_max, skills, created_at FROM jobs WHERE 1=1`;
    const parameters: { name: string; value: { stringValue?: string; longValue?: number } }[] = [];

    if (state) {
      sql += ' AND state = :state';
      parameters.push({ name: 'state', value: { stringValue: state } });
    }
    if (type) {
      sql += ' AND job_type = :type';
      parameters.push({ name: 'type', value: { stringValue: type } });
    }
    if (salary_min) {
      sql += ' AND salary_max >= :salary_min';
      parameters.push({ name: 'salary_min', value: { longValue: parseInt(salary_min, 10) } });
    }

    sql += ' ORDER BY created_at DESC LIMIT :limit OFFSET :offset';
    parameters.push(
      { name: 'limit', value: { longValue: Math.min(50, parseInt(limit, 10) || 20) } },
      { name: 'offset', value: { longValue: parseInt(offset, 10) || 0 } }
    );

    const result = await rds.send(
      new ExecuteStatementCommand({
        resourceArn: process.env.DB_CLUSTER_ARN!,
        secretArn: process.env.DB_SECRET_ARN!,
        database: process.env.DB_NAME!,
        sql,
        parameters: parameters as never,
      })
    );

    const jobs = (result.records ?? []).map((row) => ({
      jobId: row[0]?.stringValue,
      title: row[1]?.stringValue,
      company: row[2]?.stringValue,
      state: row[3]?.stringValue,
      district: row[4]?.stringValue,
      jobType: row[5]?.stringValue,
      salaryMin: row[6]?.longValue ?? row[6]?.doubleValue,
      salaryMax: row[7]?.longValue ?? row[7]?.doubleValue,
      skills: safeJsonParse(row[8]?.stringValue),
      createdAt: row[9]?.stringValue,
    }));

    return sendSuccessResponse({ jobs, total: jobs.length });
  } catch (error) {
    logger.error('Jobs list error', { error });
    return sendErrorResponse(500, 'Failed to list jobs');
  }
};

function safeJsonParse(s: string | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
