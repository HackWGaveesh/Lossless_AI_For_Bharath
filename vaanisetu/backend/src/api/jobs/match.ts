import type { APIGatewayProxyHandler } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';
import { getUserIdFromEvent, parseJsonBody } from '../../utils/user-id.js';

const bedrock = new BedrockRuntimeClient({
  region: 'us-east-1',
  token: process.env.AWS_BEARER_TOKEN_BEDROCK ? {
    token: process.env.AWS_BEARER_TOKEN_BEDROCK,
    expiration: new Date(Date.now() + 3600000)
  } : undefined
});
const rds = new RDSDataClient({ region: process.env.REGION });
const MODEL_ID = 'us.amazon.nova-pro-v1:0';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const userId = getUserIdFromEvent(event) ?? 'demo-user-1';
    const body = parseJsonBody(event);
    const userProfile = body as Record<string, unknown>;

    let jobs = [];
    try {
      const result = await rds.send(
        new ExecuteStatementCommand({
          resourceArn: process.env.DB_CLUSTER_ARN!,
          secretArn: process.env.DB_SECRET_ARN!,
          database: process.env.DB_NAME!,
          sql: 'SELECT job_id, title, company, state, district, job_type, salary_min, salary_max, skills, description FROM jobs ORDER BY created_at DESC LIMIT 30',
        })
      );

      jobs = (result.records ?? []).map((row) => ({
        job_id: row[0]?.stringValue,
        title: row[1]?.stringValue,
        company: row[2]?.stringValue,
        state: row[3]?.stringValue,
        district: row[4]?.stringValue,
        job_type: row[5]?.stringValue,
        salary_min: row[6]?.longValue ?? row[6]?.doubleValue,
        salary_max: row[7]?.longValue ?? row[7]?.doubleValue,
        skills: row[8]?.stringValue ?? '[]',
        description: row[9]?.stringValue,
      }));
    } catch (dbError) {
      logger.warn('RDS failed during job match, using local JSON fallback', { dbError });
      const fs = await import('fs/promises');
      const path = await import('path');
      const dataPath = path.resolve(process.cwd(), '../data/jobs/sample-jobs.json');
      const rawData = await fs.readFile(dataPath, 'utf-8');
      const seedData = JSON.parse(rawData);
      jobs = seedData.slice(0, 30).map((j: any) => ({
        job_id: j.job_id,
        title: j.title,
        company: j.company,
        state: j.state,
        district: j.district,
        job_type: j.job_type,
        salary_min: j.salary_min,
        salary_max: j.salary_max,
        skills: JSON.stringify(j.skills),
        description: j.description
      }));
    }

    const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const prompt = `You are a job matching assistant. Given this user profile and list of jobs, return the top 10 job IDs ranked by fit, with a short reason for each. Format as JSON array: [{"jobId":"...","score":0-100,"reason":"..."}]. Return only the JSON array. User profile: ${JSON.stringify(userProfile)}. Jobs: ${JSON.stringify(jobs.slice(0, 15))}`;

    let ranked: { jobId: string; score: number; reason: string }[] = [];
    try {
      const modelResponse = await bedrock.send(
        new ConverseCommand({
          modelId: MODEL_ID,
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 1000, temperature: 0.2 }
        })
      );

      const text = modelResponse.output?.message?.content?.[0]?.text ?? '[]';
      const matchJson = text.replace(/```json?\s*|\s*```/g, '').trim();
      ranked = JSON.parse(matchJson);
    } catch (aiError) {
      logger.warn('AI job matching failed, using simple fallback', { aiError });
      ranked = jobs.slice(0, 10).map((j: any, i: number) => ({ jobId: j.job_id ?? '', score: 90 - i * 5, reason: 'Relevant to your profile' }));
    }

    const jobMap = new Map(jobs.map((j: any) => [j.job_id, j]));
    const matchedJobs = ranked.slice(0, 10).map((r) => {
      const j = jobMap.get(r.jobId);
      if (!j) return null;
      return {
        ...j,
        matchScore: r.score,
        matchReason: r.reason,
      };
    }).filter(Boolean);

    return sendSuccessResponse({ jobs: matchedJobs });
  } catch (error) {
    logger.error('Jobs match error', { error });
    return sendErrorResponse(500, 'Internal server error');
  }
};
