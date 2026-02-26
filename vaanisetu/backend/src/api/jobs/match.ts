import type { APIGatewayProxyHandler } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { logger } from '../../utils/logger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/responses.js';

const bedrock = new BedrockRuntimeClient({ region: process.env.REGION });
const rds = new RDSDataClient({ region: process.env.REGION });
const MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const userId = event.requestContext?.authorizer?.claims?.sub;
    const body = JSON.parse(event.body ?? '{}');
    const userProfile = body as Record<string, unknown>;

    const result = await rds.send(
      new ExecuteStatementCommand({
        resourceArn: process.env.DB_CLUSTER_ARN!,
        secretArn: process.env.DB_SECRET_ARN!,
        database: process.env.DB_NAME!,
        sql: 'SELECT job_id, title, company, state, district, job_type, salary_min, salary_max, skills, description FROM jobs ORDER BY created_at DESC LIMIT 30',
      })
    );

    const jobs = (result.records ?? []).map((row) => ({
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

    const prompt = `You are a job matching assistant. Given this user profile (JSON) and list of jobs (JSON), return the top 10 job IDs ranked by fit, with a short reason for each (one line). Format as JSON array: [{"jobId":"...","score":0-100,"reason":"..."}]. User profile: ${JSON.stringify(userProfile)}. Jobs: ${JSON.stringify(jobs)}. Return only the JSON array.`;

    const modelResponse = await bedrock.send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
    );

    const parsed = JSON.parse(Buffer.from(modelResponse.body).toString()) as { content?: { text?: string }[] };
    const text = parsed.content?.[0]?.text ?? '[]';
    const matchJson = text.replace(/```json?\s*|\s*```/g, '').trim();
    let ranked: { jobId: string; score: number; reason: string }[] = [];
    try {
      ranked = JSON.parse(matchJson);
    } catch {
      ranked = jobs.slice(0, 10).map((j, i) => ({ jobId: j.job_id ?? '', score: 90 - i * 5, reason: 'Based on your profile' }));
    }

    const jobMap = new Map(jobs.map((j) => [j.job_id, j]));
    const matchedJobs = ranked.slice(0, 10).map((r) => ({
      ...jobMap.get(r.jobId),
      matchScore: r.score,
      matchReason: r.reason,
    })).filter(Boolean);

    return sendSuccessResponse({ jobs: matchedJobs });
  } catch (error) {
    logger.error('Jobs match error', { error });
    return sendErrorResponse(500, 'Failed to match jobs');
  }
};
