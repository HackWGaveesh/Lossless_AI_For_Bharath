/**
 * VaaniSetu Agent Action Handler
 * Called by Bedrock Agent when it invokes an Action Group function.
 * This is the "hands" of the orchestrator agent.
 */

import crypto from 'crypto';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../utils/logger.js';

const rds = new RDSDataClient({ region: process.env.REGION || 'ap-south-1' });
const dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.REGION || 'ap-south-1' })
);
const APPLICATIONS_TABLE = process.env.APPLICATIONS_TABLE || 'vaanisetu-applications';
const USERS_TABLE = process.env.USERS_TABLE || 'vaanisetu-users';
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'vaanisetu-documents';
const CONFIRM_SECRET = process.env.APPLICATION_CONFIRMATION_SECRET || 'vaanisetu-confirm-secret';
const CONFIRM_TTL_SEC = Number(process.env.APPLICATION_CONFIRMATION_TTL_SEC || 900);

type SchemeLite = {
    id: string;
    code: string;
    nameEn: string;
    nameHi: string;
    description: string;
    benefitRs: number;
    category: string;
    criteria: Record<string, any>;
    documentsRequired: string[];
    applicationUrl?: string;
};

type ToolResultCode = 'OK' | 'NEEDS_CONFIRMATION' | 'AMBIGUOUS_TOP3' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SYSTEM_ERROR';

function normalizeText(value: string): string {
    return (value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function compact(value: string): string {
    return normalizeText(value).replace(/\s+/g, '');
}

function parseNum(field: any): number {
    return field?.longValue ?? field?.doubleValue ?? 0;
}

function safeJson(s?: string): any {
    try { return JSON.parse(s ?? '{}'); } catch { return {}; }
}

function toAppId() {
    return `VS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function toPublicScheme(s: SchemeLite) {
    return {
        id: s.id,
        code: s.code,
        name: s.nameEn,
        nameEn: s.nameEn,
        nameHi: s.nameHi,
        description: s.description,
        benefitRs: s.benefitRs,
        category: s.category,
        criteria: s.criteria,
        documentsRequired: s.documentsRequired,
        applicationUrl: s.applicationUrl || '',
    };
}

function scoreSchemeQuery(s: SchemeLite, query: string): number {
    const q = normalizeText(query);
    if (!q) return 0;
    const id = normalizeText(s.id);
    const code = normalizeText(s.code);
    const en = normalizeText(s.nameEn);
    const hi = normalizeText(s.nameHi);
    const qCompact = compact(q);
    let score = 0;
    if (q === id || q === code || q === en || q === hi) score += 140;
    if (qCompact === compact(id) || qCompact === compact(code) || qCompact === compact(en)) score += 120;
    if (id.includes(q) || code.includes(q) || en.includes(q) || hi.includes(q)) score += 70;
    for (const token of q.split(' ').filter(Boolean)) {
        if (id.includes(token)) score += 12;
        if (code.includes(token)) score += 12;
        if (en.includes(token) || hi.includes(token)) score += 10;
    }
    return score;
}

function normalizeRequiredDoc(name: string): string {
    return normalizeText(name).replace(/\s+/g, '_');
}

function signToken(payload: Record<string, any>): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', CONFIRM_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

function verifyToken(token: string): Record<string, any> | null {
    const [body, sig] = (token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', CONFIRM_SECRET).update(body).digest('base64url');
    if (sig !== expected) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch {
        return null;
    }
}

function makeConfirmationToken(userId: string, schemeId: string): string {
    return signToken({
        u: userId,
        s: schemeId,
        exp: Math.floor(Date.now() / 1000) + Math.max(120, CONFIRM_TTL_SEC),
        n: crypto.randomBytes(8).toString('hex'),
    });
}

async function loadSchemes(): Promise<SchemeLite[]> {
    try {
        const result = await rds.send(new ExecuteStatementCommand({
            resourceArn: process.env.DB_CLUSTER_ARN!,
            secretArn: process.env.DB_SECRET_ARN!,
            database: process.env.DB_NAME || 'vaanisetu',
            sql: `SELECT scheme_id, scheme_code, name_en, name_hi, description, benefit_amount_max, eligibility_criteria, category, documents_required, application_url
                  FROM schemes WHERE is_active = true ORDER BY benefit_amount_max DESC NULLS LAST LIMIT 500`,
        }));
        return (result.records ?? []).map((r) => {
            const docsRaw = safeJson(r[8]?.stringValue);
            return ({
            id: r[0]?.stringValue ?? '',
            code: r[1]?.stringValue ?? r[0]?.stringValue ?? '',
            nameEn: r[2]?.stringValue ?? '',
            nameHi: r[3]?.stringValue ?? '',
            description: r[4]?.stringValue ?? '',
            benefitRs: parseNum(r[5]),
            criteria: safeJson(r[6]?.stringValue),
            category: r[7]?.stringValue ?? '',
            documentsRequired: Array.isArray(docsRaw) ? docsRaw : [],
            applicationUrl: r[9]?.stringValue ?? '',
        });
        });
    } catch {
        const fs = await import('fs/promises');
        const path = await import('path');
        const raw = await fs.readFile(path.resolve(process.cwd(), '../data/schemes/central-schemes.json'), 'utf-8');
        return JSON.parse(raw).map((s: any) => ({
            id: s.scheme_id,
            code: s.scheme_code ?? s.scheme_id,
            nameEn: s.name_en ?? '',
            nameHi: s.name_hi ?? '',
            description: s.description ?? '',
            benefitRs: Number(s.benefit_amount_max ?? 0),
            criteria: s.eligibility_criteria ?? {},
            category: s.category ?? '',
            documentsRequired: Array.isArray(s.documents_required) ? s.documents_required : [],
            applicationUrl: s.application_url ?? '',
        }));
    }
}

function resolveSchemesTop3(schemes: SchemeLite[], query: string): { code: ToolResultCode; best?: SchemeLite; top3?: SchemeLite[] } {
    const ranked = schemes
        .map((s) => ({ s, score: scoreSchemeQuery(s, query) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
    if (!ranked.length) return { code: 'NOT_FOUND' };
    if (ranked[0].score >= 130 || (ranked[1]?.score ?? 0) + 18 <= ranked[0].score) {
        return { code: 'OK', best: ranked[0].s };
    }
    return { code: 'AMBIGUOUS_TOP3', top3: ranked.slice(0, 3).map((x) => x.s) };
}

async function getProfileAndDocumentSummary(userId: string) {
    const [userRes, docRes] = await Promise.all([
        dynamo.send(new GetCommand({ TableName: USERS_TABLE, Key: { user_id: userId } })).catch(() => ({ Item: undefined } as any),
        ),
        dynamo.send(new QueryCommand({
            TableName: DOCUMENTS_TABLE,
            KeyConditionExpression: 'user_id = :uid',
            ExpressionAttributeValues: { ':uid': userId },
            ScanIndexForward: false,
            Limit: 100,
        })).catch(() => ({ Items: [] } as any)),
    ]);

    const profile = (userRes.Item ?? {}) as Record<string, any>;
    const docs = (docRes.Items ?? []) as Record<string, any>[];
    const byType = new Map<string, Record<string, any>>();
    for (const d of docs) {
        const t = String(d.document_type || d.documentType || 'unknown');
        if (!byType.has(t)) byType.set(t, d);
    }
    const summary = Array.from(byType.values()).map((d) => ({
        documentType: String(d.document_type || d.documentType || 'unknown'),
        status: String(d.status || 'unknown'),
    }));
    const providedDocTypes = summary
        .filter((d) => ['processed', 'verified', 'approved'].includes(normalizeText(d.status)))
        .map((d) => normalizeText(d.documentType));
    return { profile, documentSummary: summary, providedDocTypes };
}

export async function executeAgentAction(event: any): Promise<Record<string, any>> {
    const { function: funcName = '', parameters = [] } = event;
    const getParam = (name: string): string => parameters.find((p: any) => p.name === name)?.value ?? '';
    const effectiveUserId = String(getParam('userId') || event?.userId || event?.sessionAttributes?.userId || '').trim();
    try {
        switch (funcName) {
        case 'resolveScheme':
        case 'getSchemeDetails': {
            const schemes = await loadSchemes();
            const query = `${getParam('query')} ${getParam('schemeName')} ${getParam('schemeId')}`.trim();
            if (!query) return { success: false, code: 'VALIDATION_ERROR', message: 'Please provide a scheme name.' };
            const resolved = resolveSchemesTop3(schemes, query);
            if (resolved.code === 'OK' && resolved.best) {
                return { success: true, code: 'OK', scheme: toPublicScheme(resolved.best) };
            }
            if (resolved.code === 'AMBIGUOUS_TOP3' && resolved.top3) {
                return { success: false, code: 'AMBIGUOUS_TOP3', message: 'I found multiple matching schemes. Please pick one.', options: resolved.top3.map(toPublicScheme) };
            }
            return { success: false, code: 'NOT_FOUND', message: 'No matching scheme found.', options: schemes.slice(0, 3).map(toPublicScheme) };
        }

        case 'prepareApplication': {
            if (!effectiveUserId) return { success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' };
            const schemes = await loadSchemes();
            const query = `${getParam('query')} ${getParam('schemeName')} ${getParam('schemeId')}`.trim();
            const resolved = resolveSchemesTop3(schemes, query);
            if (resolved.code === 'AMBIGUOUS_TOP3' && resolved.top3) {
                return { success: false, code: 'AMBIGUOUS_TOP3', message: 'I found multiple matching schemes. Please pick one.', options: resolved.top3.map(toPublicScheme) };
            }
            if (resolved.code !== 'OK' || !resolved.best) {
                return { success: false, code: 'NOT_FOUND', message: 'I could not identify the scheme.', options: schemes.slice(0, 3).map(toPublicScheme) };
            }

            const { profile, documentSummary, providedDocTypes } = await getProfileAndDocumentSummary(effectiveUserId);
            const required = (resolved.best.documentsRequired || []).map((d) => normalizeRequiredDoc(d));
            const missingDocuments = required.filter((req) => !providedDocTypes.some((p) => p.includes(req) || req.includes(p)));
            const confirmationToken = makeConfirmationToken(effectiveUserId, resolved.best.id);

            return {
                success: true,
                code: 'NEEDS_CONFIRMATION',
                message: `Please confirm application for ${resolved.best.nameEn}.`,
                scheme: toPublicScheme(resolved.best),
                userProfile: profile,
                documents: documentSummary,
                missingDocuments,
                confirmationToken,
                expiresInSeconds: Math.max(120, CONFIRM_TTL_SEC),
            };
        }

        case 'confirmApplication': {
            if (!effectiveUserId) return { success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' };
            const confirm = normalizeText(getParam('confirm') || 'true');
            if (!['true', 'yes', '1', 'confirm'].includes(confirm)) {
                return { success: false, code: 'NEEDS_CONFIRMATION', message: 'Please confirm to continue.' };
            }
            const payload = verifyToken(getParam('confirmationToken'));
            if (!payload || payload.u !== effectiveUserId) {
                return { success: false, code: 'VALIDATION_ERROR', message: 'Confirmation expired. Please start again.' };
            }
            return { success: true, code: 'OK', confirmationToken: getParam('confirmationToken'), message: 'Confirmation accepted.' };
        }

        case 'submitApplication': {
            if (!effectiveUserId) return { success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' };
            const confirm = normalizeText(getParam('confirm') || 'true');
            if (!['true', 'yes', '1', 'confirm'].includes(confirm)) {
                return { success: false, code: 'NEEDS_CONFIRMATION', message: 'Please confirm before submit.' };
            }
            const idempotencyKey = getParam('idempotencyKey');
            if (idempotencyKey) {
                const q = await dynamo.send(new QueryCommand({
                    TableName: APPLICATIONS_TABLE,
                    KeyConditionExpression: 'user_id = :uid',
                    ExpressionAttributeValues: { ':uid': effectiveUserId },
                    ScanIndexForward: false,
                    Limit: 50,
                })).catch(() => ({ Items: [] } as any));
                const existing = (q.Items ?? []).find((i: any) => String(i.idempotency_key || '') === idempotencyKey);
                if (existing) {
                    return { success: true, code: 'OK', idempotent: true, applicationId: existing.application_id, status: existing.status, schemeId: existing.scheme_id, schemeName: existing.scheme_name, schemeCode: existing.scheme_code, message: `Application already submitted. Reference: ${existing.application_id}.` };
                }
            }

            const schemes = await loadSchemes();
            let selected = null as SchemeLite | null;
            const tokenPayload = verifyToken(getParam('confirmationToken'));
            if (tokenPayload && tokenPayload.u === effectiveUserId) {
                selected = schemes.find((s) => s.id === tokenPayload.s) || null;
            }
            if (!selected) {
                const query = `${getParam('query')} ${getParam('schemeName')} ${getParam('schemeId')}`.trim();
                const resolved = resolveSchemesTop3(schemes, query);
                if (resolved.code === 'AMBIGUOUS_TOP3' && resolved.top3) {
                    return { success: false, code: 'AMBIGUOUS_TOP3', message: 'I found multiple matching schemes. Please pick one.', options: resolved.top3.map(toPublicScheme) };
                }
                if (resolved.code !== 'OK' || !resolved.best) return { success: false, code: 'NOT_FOUND', message: 'Could not identify the scheme to submit.' };
                selected = resolved.best;
            }

            const { profile, documentSummary, providedDocTypes } = await getProfileAndDocumentSummary(effectiveUserId);
            const required = (selected.documentsRequired || []).map((d) => normalizeRequiredDoc(d));
            const missingDocuments = required.filter((req) => !providedDocTypes.some((p) => p.includes(req) || req.includes(p)));

            const applicationId = toAppId();
            const now = new Date().toISOString();
            await dynamo.send(new PutCommand({
                TableName: APPLICATIONS_TABLE,
                Item: {
                    user_id: effectiveUserId,
                    application_id: applicationId,
                    scheme_id: selected.id,
                    scheme_name: selected.nameEn,
                    scheme_code: selected.code,
                    status: 'submitted',
                    created_at: now,
                    updated_at: now,
                    source: 'agent_workflow',
                    idempotency_key: idempotencyKey || null,
                    missing_documents: missingDocuments,
                    profile_snapshot: profile,
                    documents_snapshot: documentSummary,
                },
            }));
            return { success: true, code: 'OK', applicationId, schemeId: selected.id, schemeCode: selected.code, schemeName: selected.nameEn, status: 'submitted', missingDocuments, message: `Application submitted for ${selected.nameEn}. Reference: ${applicationId}. Keep this number for tracking.` };
        }

        case 'createApplication': {
            const confirm = normalizeText(getParam('confirm') || '');
            if (!['true', 'yes', '1', 'confirm'].includes(confirm)) {
                return executeAgentAction({
                    ...event,
                    function: 'prepareApplication',
                    parameters: [
                        { name: 'userId', value: effectiveUserId },
                        { name: 'query', value: getParam('query') },
                        { name: 'schemeName', value: getParam('schemeName') },
                        { name: 'schemeId', value: getParam('schemeId') },
                    ],
                });
            }
            return executeAgentAction({
                ...event,
                function: 'submitApplication',
                parameters: [
                    { name: 'userId', value: effectiveUserId },
                    { name: 'confirm', value: 'true' },
                    { name: 'query', value: getParam('query') },
                    { name: 'schemeName', value: getParam('schemeName') },
                    { name: 'schemeId', value: getParam('schemeId') },
                    { name: 'confirmationToken', value: getParam('confirmationToken') },
                    { name: 'idempotencyKey', value: getParam('idempotencyKey') },
                ],
            });
        }

        case 'updateUserProfile': {
            if (!effectiveUserId) return { success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' };
            const patch: Record<string, any> = {};
            const directFields = ['name', 'fullName', 'phone', 'state', 'district', 'gender', 'occupation', 'email', 'pincode', 'address', 'casteCategory', 'preferredLanguage'];
            for (const field of directFields) {
                const v = getParam(field);
                if (v) patch[field] = v;
            }
            if (getParam('age')) patch.age = Number(getParam('age'));
            if (getParam('annualIncome')) patch.annualIncome = Number(getParam('annualIncome'));
            if (getParam('bplCardholder')) patch.bplCardholder = ['true', '1', 'yes'].includes(normalizeText(getParam('bplCardholder')));
            if (!Object.keys(patch).length) return { success: false, code: 'VALIDATION_ERROR', message: 'No profile fields provided.' };
            if (patch.annualIncome != null) patch.annual_income = patch.annualIncome;
            if (patch.casteCategory != null) patch.caste_category = patch.casteCategory;
            if (patch.preferredLanguage != null) patch.preferred_language = patch.preferredLanguage;
            const current = await dynamo.send(new GetCommand({ TableName: USERS_TABLE, Key: { user_id: effectiveUserId } })).catch(() => ({ Item: {} } as any));
            const merged = { ...(current.Item ?? {}), ...patch, user_id: effectiveUserId, updated_at: new Date().toISOString() };
            await dynamo.send(new PutCommand({ TableName: USERS_TABLE, Item: merged }));
            return { success: true, code: 'OK', message: 'Profile updated successfully.', updatedFields: Object.keys(patch), profile: merged };
        }

        case 'setPreferredLanguage': {
            const langRaw = normalizeText(getParam('language') || getParam('preferredLanguage'));
            const map: Record<string, string> = { english: 'en', en: 'en', hindi: 'hi', hi: 'hi', tamil: 'ta', ta: 'ta', telugu: 'te', te: 'te', marathi: 'mr', mr: 'mr', kannada: 'kn', kn: 'kn' };
            const language = map[langRaw] || langRaw;
            if (!['en', 'hi', 'ta', 'te', 'mr', 'kn'].includes(language)) return { success: false, code: 'VALIDATION_ERROR', message: 'Unsupported language.' };
            return executeAgentAction({
                ...event,
                function: 'updateUserProfile',
                parameters: [
                    { name: 'userId', value: effectiveUserId },
                    { name: 'preferredLanguage', value: language },
                ],
            }).then((r) => ({ ...r, preferredLanguage: language, message: `Default language updated to ${language}.` }));
        }

        case 'getSchemesByProfile': {
            const age = parseInt(getParam('age') || '0', 10);
            const income = parseInt(getParam('annualIncome') || '0', 10);
            const gender = getParam('gender');
            const state = getParam('state');
            const occupation = getParam('occupation');
            const casteCategory = getParam('casteCategory');
            const profile = { age, income, gender, state, occupation, casteCategory };
            const schemes = await loadSchemes();
            const scored = schemes
                .map((s) => ({ ...s, score: scoreScheme(s.criteria, profile) }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 8)
                .map((s) => ({
                    id: s.id,
                    code: s.code,
                    name: s.nameEn,
                    nameHi: s.nameHi,
                    benefitRs: s.benefitRs,
                    matchPercent: s.score,
                    category: s.category,
                    summary: s.description.slice(0, 120),
                    documentsRequired: s.documentsRequired,
                }));
            return { success: true, code: 'OK', schemes: scored, totalFound: scored.length, topScheme: scored[0]?.name ?? 'None', topBenefit: scored[0]?.benefitRs ?? 0 };
        }

        case 'getApplicationStatus': {
            const applicationId = getParam('applicationId');
            if (!applicationId) return { success: false, code: 'VALIDATION_ERROR', message: 'applicationId is required' };
            if (!effectiveUserId) return { success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' };
            const res = await dynamo.send(new GetCommand({ TableName: APPLICATIONS_TABLE, Key: { user_id: effectiveUserId, application_id: applicationId } })).catch(() => ({ Item: undefined } as any));
            if (res.Item) {
                const item: any = res.Item;
                return { success: true, code: 'OK', applicationId, schemeId: item.scheme_id, schemeName: item.scheme_name, status: item.status || 'submitted', createdAt: item.created_at, updatedAt: item.updated_at, message: `Your application status is ${item.status || 'submitted'}.` };
            }
            return { success: false, code: 'NOT_FOUND', applicationId, message: 'No application found for this reference under your account.' };
        }

        case 'getJobsByProfile': {
            const state = normalizeText(getParam('state'));
            const occupation = normalizeText(getParam('occupation'));
            let jobs: any[] = [];
            try {
                const result = await rds.send(new ExecuteStatementCommand({
                    resourceArn: process.env.DB_CLUSTER_ARN!,
                    secretArn: process.env.DB_SECRET_ARN!,
                    database: process.env.DB_NAME || 'vaanisetu',
                    sql: `SELECT job_id, title, company, state, district, job_type, salary_min, salary_max, description FROM jobs ORDER BY created_at DESC LIMIT 30`,
                }));
                jobs = (result.records ?? []).map((r) => ({
                    id: r[0]?.stringValue,
                    title: r[1]?.stringValue,
                    company: r[2]?.stringValue,
                    state: r[3]?.stringValue,
                    district: r[4]?.stringValue,
                    type: r[5]?.stringValue,
                    salaryMin: r[6]?.longValue ?? 0,
                    salaryMax: r[7]?.longValue ?? 0,
                    description: (r[8]?.stringValue ?? ''),
                    salaryRange: `Rs ${(r[6]?.longValue ?? 0).toLocaleString('en-IN')} - Rs ${(r[7]?.longValue ?? 0).toLocaleString('en-IN')}/month`,
                }));
            } catch {
                const fs = await import('fs/promises');
                const path = await import('path');
                const raw = await fs.readFile(path.resolve(process.cwd(), '../data/jobs/sample-jobs.json'), 'utf-8');
                jobs = JSON.parse(raw).slice(0, 20).map((j: any) => ({
                    id: j.job_id, title: j.title, company: j.company, state: j.state, district: j.district, type: j.job_type,
                    salaryMin: j.salary_min ?? 0, salaryMax: j.salary_max ?? 0, description: j.description ?? '',
                    salaryRange: `Rs ${(j.salary_min ?? 0).toLocaleString('en-IN')} - Rs ${(j.salary_max ?? 0).toLocaleString('en-IN')}/month`,
                }));
            }
            const filtered = jobs.filter((j) => {
                const stateOk = !state || normalizeText(j.state || '').includes(state) || normalizeText(j.district || '').includes(state);
                const occText = normalizeText(`${j.title || ''} ${j.description || ''}`);
                const occOk = !occupation || occText.includes(occupation);
                return stateOk && occOk;
            });
            const out = (filtered.length ? filtered : jobs).slice(0, 8);
            return { success: true, code: 'OK', jobs: out, totalFound: out.length };
        }

        default:
            return { success: false, code: 'VALIDATION_ERROR', message: `Unknown function: ${funcName}` };
        }
    } catch (error: any) {
        logger.error('executeAgentAction failed', { funcName, error: error?.message || String(error) });
        return { success: false, code: 'SYSTEM_ERROR', message: 'Could not complete the requested action right now.' };
    }
}

export const handler = async (event: any) => {
    const actionGroup = event?.actionGroup || 'vaanisetu-actions';
    const funcName = event?.function || '';
    try {
        logger.info('Agent action invoked', { actionGroup, funcName, parameters: event?.parameters ?? [] });
        const data = await executeAgentAction(event);
        return ok(actionGroup, funcName, data);
    } catch (error: any) {
        logger.error('Agent action failed', { funcName, error: error.message });
        return ok(actionGroup, funcName, { success: false, code: 'SYSTEM_ERROR', error: error.message });
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
