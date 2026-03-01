/**
 * VaaniSetu Agent Action Handler
 * Called by Bedrock Agent when it invokes an Action Group function.
 * This is the "hands" of the orchestrator agent.
 */

import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { logger } from '../../utils/logger.js';

const rds = new RDSDataClient({ region: process.env.REGION || 'ap-south-1' });
const dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.REGION || 'ap-south-1' })
);
const sns = new SNSClient({ region: process.env.REGION || 'ap-south-1' });

export const handler = async (event: any) => {
    const { actionGroup, function: funcName, parameters = [] } = event;
    const getParam = (name: string): string => parameters.find((p: any) => p.name === name)?.value ?? '';

    logger.info('Agent action invoked', { actionGroup, funcName, parameters });

    try {
        switch (funcName) {

            case 'getSchemesByProfile': {
                const age = parseInt(getParam('age') || '0');
                const income = parseInt(getParam('annualIncome') || '0');
                const gender = getParam('gender');
                const state = getParam('state');
                const occupation = getParam('occupation');
                const casteCategory = getParam('casteCategory');

                // Load schemes from DB or fallback to JSON
                let schemes: any[] = [];
                try {
                    const result = await rds.send(new ExecuteStatementCommand({
                        resourceArn: process.env.DB_CLUSTER_ARN!,
                        secretArn: process.env.DB_SECRET_ARN!,
                        database: process.env.DB_NAME || 'vaanisetu',
                        sql: `SELECT scheme_id, name_en, name_hi, description, 
                         benefit_amount_max, eligibility_criteria, category
                  FROM schemes WHERE is_active = true 
                  ORDER BY benefit_amount_max DESC NULLS LAST LIMIT 25`,
                    }));
                    schemes = (result.records ?? []).map(r => ({
                        id: r[0]?.stringValue ?? '',
                        nameEn: r[1]?.stringValue ?? '',
                        nameHi: r[2]?.stringValue ?? '',
                        description: r[3]?.stringValue ?? '',
                        benefit: r[4]?.longValue ?? r[4]?.doubleValue ?? 0,
                        criteria: safeJson(r[5]?.stringValue),
                        category: r[6]?.stringValue ?? '',
                    }));
                } catch {
                    const fs = await import('fs/promises');
                    const path = await import('path');
                    const raw = await fs.readFile(
                        path.resolve(process.cwd(), '../data/schemes/central-schemes.json'), 'utf-8'
                    );
                    schemes = JSON.parse(raw).map((s: any) => ({
                        id: s.scheme_id,
                        nameEn: s.name_en,
                        nameHi: s.name_hi ?? s.name_en,
                        description: s.description,
                        benefit: s.benefit_amount_max ?? 0,
                        criteria: s.eligibility_criteria ?? {},
                        category: s.category ?? '',
                    }));
                }

                // Score and rank
                const profile = { age, income, gender, state, occupation, casteCategory };
                const scored = schemes
                    .map(s => ({ ...s, score: scoreScheme(s.criteria, profile) }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 8)
                    .map(s => ({
                        id: s.id,
                        name: s.nameEn,
                        nameHi: s.nameHi,
                        benefitRs: s.benefit,
                        matchPercent: s.score,
                        category: s.category,
                        summary: s.description.slice(0, 120) + '...',
                    }));

                return ok(actionGroup, funcName, {
                    schemes: scored,
                    totalFound: scored.length,
                    topScheme: scored[0]?.name ?? 'None',
                    topBenefit: scored[0]?.benefitRs ?? 0,
                });
            }

            case 'createApplication': {
                const userId = getParam('userId');
                const schemeId = getParam('schemeId');
                const schemeName = getParam('schemeName');

                if (!userId || !schemeId) {
                    return ok(actionGroup, funcName, { success: false, message: 'userId and schemeId are required' });
                }

                const applicationId = `VS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()
                    }`;

                await dynamo.send(new PutCommand({
                    TableName: process.env.APPLICATIONS_TABLE || 'vaanisetu-applications',
                    Item: {
                        user_id: userId,
                        application_id: applicationId,
                        scheme_id: schemeId,
                        scheme_name: schemeName || schemeId,
                        status: 'submitted',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        source: 'bedrock_agent',
                    },
                }));

                // Send SMS notification via SNS
                try {
                    if (process.env.NOTIFICATION_TOPIC_ARN) {
                        await sns.send(new PublishCommand({
                            TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
                            Subject: 'VaaniSetu Application Submitted',
                            Message: `Your application for ${schemeName || schemeId} has been submitted. Reference: ${applicationId}`,
                        }));
                    }
                } catch (snsErr) {
                    logger.warn('SNS notification failed', { snsErr });
                }

                return ok(actionGroup, funcName, {
                    success: true,
                    applicationId,
                    message: `Application submitted! Your reference number is ${applicationId}. You will receive updates via SMS.`,
                });
            }

            case 'getApplicationStatus': {
                const applicationId = getParam('applicationId');
                if (!applicationId) {
                    return ok(actionGroup, funcName, { success: false, message: 'applicationId is required' });
                }

                // Status map (real implementations would query DynamoDB)
                const statusMessages: Record<string, string> = {
                    submitted: 'Your application has been received and is pending review.',
                    under_review: 'Your application is under review by the concerned department.',
                    approved: 'Congratulations! Your application has been approved.',
                    rejected: 'Your application was not approved. You may reapply with correct documents.',
                };

                return ok(actionGroup, funcName, {
                    applicationId,
                    status: 'under_review',
                    message: statusMessages['under_review'],
                    expectedDecision: '30-45 days',
                });
            }

            case 'getJobsByProfile': {
                const state = getParam('state');
                const occupation = getParam('occupation');

                let jobs: any[] = [];
                try {
                    const result = await rds.send(new ExecuteStatementCommand({
                        resourceArn: process.env.DB_CLUSTER_ARN!,
                        secretArn: process.env.DB_SECRET_ARN!,
                        database: process.env.DB_NAME || 'vaanisetu',
                        sql: `SELECT job_id, title, company, state, district, job_type, 
                         salary_min, salary_max, description
                  FROM jobs ORDER BY created_at DESC LIMIT 15`,
                    }));
                    jobs = (result.records ?? []).map(r => ({
                        id: r[0]?.stringValue,
                        title: r[1]?.stringValue,
                        company: r[2]?.stringValue,
                        state: r[3]?.stringValue,
                        district: r[4]?.stringValue,
                        type: r[5]?.stringValue,
                        salaryMin: r[6]?.longValue ?? 0,
                        salaryMax: r[7]?.longValue ?? 0,
                        description: (r[8]?.stringValue ?? '').slice(0, 100),
                    }));
                } catch {
                    const fs = await import('fs/promises');
                    const path = await import('path');
                    const raw = await fs.readFile(
                        path.resolve(process.cwd(), '../data/jobs/sample-jobs.json'), 'utf-8'
                    );
                    jobs = JSON.parse(raw).slice(0, 10);
                }

                // Filter by state if provided
                const filtered = state
                    ? jobs.filter(j => j.state?.toLowerCase().includes(state.toLowerCase()))
                    : jobs;

                return ok(actionGroup, funcName, {
                    jobs: (filtered.length > 0 ? filtered : jobs).slice(0, 8),
                    totalFound: filtered.length || jobs.length,
                });
            }

            default:
                return ok(actionGroup, funcName, {
                    success: false,
                    message: `Unknown function: ${funcName}`,
                });
        }
    } catch (error: any) {
        logger.error('Agent action failed', { funcName, error: error.message });
        return ok(actionGroup, funcName, { success: false, error: error.message });
    }
};

// Bedrock Agent response format
function ok(actionGroup: string, funcName: string, data: any) {
    return {
        messageVersion: '1.0',
        response: {
            actionGroup,
            function: funcName,
            functionResponse: {
                responseBody: { TEXT: { body: JSON.stringify(data) } },
            },
        },
    };
}

function safeJson(s?: string): any {
    try { return JSON.parse(s ?? '{}'); } catch { return {}; }
}

function scoreScheme(criteria: any, profile: any): number {
    let score = 50;
    if (criteria.ageMin != null && criteria.ageMax != null && profile.age > 0) {
        score += (profile.age >= criteria.ageMin && profile.age <= criteria.ageMax) ? 20 : -10;
    }
    if (criteria.incomeMax != null && profile.income > 0) {
        score += (profile.income <= criteria.incomeMax) ? 20 : -15;
    }
    if (criteria.gender && profile.gender) {
        score += (criteria.gender === 'all' || criteria.gender === profile.gender) ? 10 : -5;
    }
    if (criteria.states?.length && profile.state) {
        score += criteria.states.some((s: string) =>
            s.toLowerCase() === profile.state.toLowerCase()
        ) ? 10 : 0;
    }
    if (criteria.casteCategories?.length && profile.casteCategory) {
        score += criteria.casteCategories.includes(profile.casteCategory) ? 15 : 0;
    }
    return Math.max(0, Math.min(100, score));
}
