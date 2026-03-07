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
import { evaluateEligibility } from '../../services/scheme-eligibility-service.js';
import { getCurrentDocumentsByType } from '../../utils/document-selection.js';
import LOCAL_SCHEMES_DATA from '../../../../data/schemes/central-schemes.json';
import LOCAL_JOBS_DATA from '../../../../data/jobs/sample-jobs.json';

const rds = new RDSDataClient({ region: process.env.REGION || 'ap-south-1' });
const dynamo = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: process.env.REGION || 'ap-south-1' })
);
const APPLICATIONS_TABLE = process.env.APPLICATIONS_TABLE || 'vaanisetu-applications';
const USERS_TABLE = process.env.USERS_TABLE || 'vaanisetu-users';
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'vaanisetu-documents';
const CONFIRM_SECRET = process.env.APPLICATION_CONFIRMATION_SECRET || 'vaanisetu-confirm-secret';
const CONFIRM_TTL_SEC = Number(process.env.APPLICATION_CONFIRMATION_TTL_SEC || 900);
const ALLOW_LOCAL_DATA_FALLBACK = process.env.ALLOW_LOCAL_DATA_FALLBACK === 'true';
const INLINE_UPLOADABLE_DOCUMENTS = new Set(['aadhaar', 'pan', 'bank_passbook', 'income']);

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

type ToolResultCode = 'OK' | 'NEEDS_CONFIRMATION' | 'AMBIGUOUS_TOP3' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'SYSTEM_ERROR' | 'DATA_UNAVAILABLE';

function withToolMeta<T extends Record<string, any>>(payload: T): T & { source: string; timestamp: string } {
    return {
        ...payload,
        source: 'agent_action_handler',
        timestamp: new Date().toISOString(),
    };
}

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

    // Exact full match
    if (q === id || q === code || q === en || q === hi) score += 140;
    // Compact (no-space) exactly equal
    if (qCompact === compact(id) || qCompact === compact(code) || qCompact === compact(en)) score += 120;
    // Query contains full scheme name (e.g. "3. National Scholarship Portal with a benefit of up to ₹1,00,000")
    if (en.length >= 5 && q.includes(en)) score += 95;
    if (hi.length >= 5 && q.includes(hi)) score += 85;
    // Substring inclusion (scheme name contains query)
    if (id.includes(q) || code.includes(q)) score += 75;
    if (en.includes(q)) score += 70;
    if (hi.includes(q)) score += 60;

    // Per-token scoring
    const qTokens = q.split(' ').filter(Boolean);
    const enTokens = en.split(' ').filter(Boolean);
    for (const token of qTokens) {
        if (token.length < 2) continue; // skip single-char noise
        if (id.includes(token)) score += 12;
        if (code.includes(token)) score += 12;
        if (en.includes(token) || hi.includes(token)) score += 10;
    }

    // COVERAGE BONUS: if the query tokens cover >= 60% of the scheme's English name tokens,
    // it's likely a match for that scheme specifically. Boost it significantly.
    if (enTokens.length > 0 && qTokens.length > 0) {
        const matchedSchemeTokens = enTokens.filter((et) =>
            qTokens.some((qt) => qt.length >= 3 && (et.includes(qt) || qt.includes(et)))
        ).length;
        const coverage = matchedSchemeTokens / enTokens.length;
        if (coverage >= 0.7) score += 65;
        else if (coverage >= 0.5) score += 35;
        else if (coverage >= 0.35) score += 15;

        // Also check reverse: how much of the QUERY does the scheme name cover?
        const matchedQueryTokens = qTokens.filter((qt) =>
            qt.length >= 3 && enTokens.some((et) => et.includes(qt) || qt.includes(et))
        ).length;
        const queryCoverage = matchedQueryTokens / qTokens.length;
        if (queryCoverage >= 0.7) score += 40;
        else if (queryCoverage >= 0.5) score += 20;
    }

    return score;
}

function normalizeRequiredDoc(name: string): string {
    return normalizeText(name).replace(/\s+/g, '_');
}

function canonicalDocTag(name: string): string {
    const raw = normalizeRequiredDoc(name)
        .replace(/_card$/g, '')
        .replace(/_certificate$/g, '')
        .replace(/_proof$/g, '')
        .replace(/^pm_/g, '');
    const aliases: Record<string, string> = {
        aadhar: 'aadhaar',
        aadhaar_number: 'aadhaar',
        pan_number: 'pan',
        bank_pass_book: 'bank_passbook',
        bank_account: 'bank_passbook',
        passbook: 'bank_passbook',
        domicile: 'domicile',
        residence: 'residence',
        address: 'residence',
        income: 'income',
        caste: 'caste',
    };
    return aliases[raw] || raw;
}

function docsMatch(required: string, provided: string): boolean {
    const req = canonicalDocTag(required);
    const got = canonicalDocTag(provided);
    if (!req || !got) return false;
    return got.includes(req) || req.includes(got);
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
    const AURORA_TIMEOUT_MS = 10000;
    try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), AURORA_TIMEOUT_MS);
        try {
            const result = await rds.send(new ExecuteStatementCommand({
                resourceArn: process.env.DB_CLUSTER_ARN!,
                secretArn: process.env.DB_SECRET_ARN!,
                database: process.env.DB_NAME || 'vaanisetu',
                sql: `SELECT scheme_id, scheme_code, name_en, name_hi, description, benefit_amount_max, eligibility_criteria, category, documents_required, application_url
                      FROM schemes WHERE is_active = true ORDER BY benefit_amount_max DESC NULLS LAST LIMIT 500`,
            }), { abortSignal: ac.signal });
            clearTimeout(timer);
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
        } catch (auroraErr: any) {
            clearTimeout(timer);
            const isTimeout = auroraErr?.name === 'AbortError' || (auroraErr?.message || '').includes('abort');
            logger.warn('Aurora query failed', { isTimeout, error: auroraErr?.message || String(auroraErr) });
            throw auroraErr;
        }
    } catch {
        if (!ALLOW_LOCAL_DATA_FALLBACK) {
            throw new Error('DATA_UNAVAILABLE: schemes datasource is currently unavailable');
        }
        if (!LOCAL_SCHEMES_DATA.length) {
            throw new Error('DATA_UNAVAILABLE: no local fallback data available');
        }
        logger.info('Falling back to bundled JSON for schemes', { count: LOCAL_SCHEMES_DATA.length });
        return LOCAL_SCHEMES_DATA.map((s: any) => ({
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
    const topScore = ranked[0].score;
    const secondScore = ranked[1]?.score ?? 0;
    // Return OK if: score is high enough AND clearly better than 2nd place
    if (topScore >= 70 && (secondScore + 25 <= topScore || topScore >= 130)) {
        return { code: 'OK', best: ranked[0].s };
    }
    // If multiple high scorers within 25 pts, ask user to disambiguate
    if (ranked.filter((x) => x.score >= 40).length >= 2) {
        return { code: 'AMBIGUOUS_TOP3', top3: ranked.slice(0, 3).map((x) => x.s) };
    }
    // Only one hit above threshold — return it
    if (topScore >= 40) {
        return { code: 'OK', best: ranked[0].s };
    }
    return { code: 'NOT_FOUND' };
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
    const currentByType = getCurrentDocumentsByType(docs);
    const summary = Array.from(currentByType.values()).map((d) => ({
        documentType: String(d.document_type || d.documentType || 'unknown'),
        status: String(d.status || 'unknown'),
    }));
    const providedDocTypes = summary
        .filter((d) => ['processed', 'verified', 'approved', 'completed'].includes(normalizeText(d.status)))
        .map((d) => canonicalDocTag(d.documentType));
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
                if (!query) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please provide a scheme name.' });
                const resolved = resolveSchemesTop3(schemes, query);
                if (resolved.code === 'OK' && resolved.best) {
                    return withToolMeta({ success: true, code: 'OK', scheme: toPublicScheme(resolved.best) });
                }
                if (resolved.code === 'AMBIGUOUS_TOP3' && resolved.top3) {
                    return withToolMeta({ success: false, code: 'AMBIGUOUS_TOP3', message: 'I found multiple matching schemes. Please pick one.', options: resolved.top3.map(toPublicScheme) });
                }
                return withToolMeta({ success: false, code: 'NOT_FOUND', message: 'No matching scheme found.', options: schemes.slice(0, 3).map(toPublicScheme) });
            }

            case 'prepareApplication': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const schemes = await loadSchemes();
                const query = `${getParam('query')} ${getParam('schemeName')} ${getParam('schemeId')}`.trim();
                const resolved = resolveSchemesTop3(schemes, query);
                if (resolved.code === 'AMBIGUOUS_TOP3' && resolved.top3) {
                    return withToolMeta({ success: false, code: 'AMBIGUOUS_TOP3', message: 'I found multiple matching schemes. Please pick one.', options: resolved.top3.map(toPublicScheme) });
                }
                if (resolved.code !== 'OK' || !resolved.best) {
                    return withToolMeta({ success: false, code: 'NOT_FOUND', message: 'I could not identify the scheme.', options: schemes.slice(0, 3).map(toPublicScheme) });
                }

                const { profile, documentSummary, providedDocTypes } = await getProfileAndDocumentSummary(effectiveUserId);
                const required = (resolved.best.documentsRequired || []).map((d) => normalizeRequiredDoc(d));
                const missingDocuments = required.filter((req) => !providedDocTypes.some((p) => docsMatch(req, p)));
                const availableDocuments = required.filter((req) => providedDocTypes.some((p) => docsMatch(req, p)));
                const confirmationToken = makeConfirmationToken(effectiveUserId, resolved.best.id);

                return withToolMeta({
                    success: true,
                    code: 'NEEDS_CONFIRMATION',
                    message: `Please confirm application for ${resolved.best.nameEn}.`,
                    scheme: toPublicScheme(resolved.best),
                    userProfile: profile,
                    documents: documentSummary,
                    missingDocuments,
                    availableDocuments,
                    confirmationToken,
                    expiresInSeconds: Math.max(120, CONFIRM_TTL_SEC),
                });
            }

            case 'confirmApplication': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const confirm = normalizeText(getParam('confirm') || 'true');
                if (!['true', 'yes', '1', 'confirm'].includes(confirm)) {
                    return withToolMeta({ success: false, code: 'NEEDS_CONFIRMATION', message: 'Please confirm to continue.' });
                }
                const payload = verifyToken(getParam('confirmationToken'));
                if (!payload || payload.u !== effectiveUserId) {
                    return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Confirmation expired. Please start again.' });
                }
                return withToolMeta({ success: true, code: 'OK', confirmationToken: getParam('confirmationToken'), message: 'Confirmation accepted.' });
            }

            case 'submitApplication': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const confirm = normalizeText(getParam('confirm') || 'true');
                if (!['true', 'yes', '1', 'confirm'].includes(confirm)) {
                    return withToolMeta({ success: false, code: 'NEEDS_CONFIRMATION', message: 'Please confirm before submit.' });
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
                        return withToolMeta({ success: true, code: 'OK', idempotent: true, applicationId: existing.application_id, status: existing.status, schemeId: existing.scheme_id, schemeName: existing.scheme_name, schemeCode: existing.scheme_code, message: `Application already submitted. Reference: ${existing.application_id}.` });
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
                        return withToolMeta({ success: false, code: 'AMBIGUOUS_TOP3', message: 'I found multiple matching schemes. Please pick one.', options: resolved.top3.map(toPublicScheme) });
                    }
                    if (resolved.code !== 'OK' || !resolved.best) return withToolMeta({ success: false, code: 'NOT_FOUND', message: 'Could not identify the scheme to submit.' });
                    selected = resolved.best;
                }

                const { profile, documentSummary, providedDocTypes } = await getProfileAndDocumentSummary(effectiveUserId);
                const required = (selected.documentsRequired || []).map((d) => normalizeRequiredDoc(d));
                const missingDocuments = required.filter((req) => !providedDocTypes.some((p) => docsMatch(req, p)));
                const uploadableMissingDocuments = missingDocuments.filter((req) => INLINE_UPLOADABLE_DOCUMENTS.has(canonicalDocTag(req)));
                const manualMissingDocuments = missingDocuments.filter((req) => !INLINE_UPLOADABLE_DOCUMENTS.has(canonicalDocTag(req)));

                if (uploadableMissingDocuments.length > 0) {
                    return withToolMeta({
                        success: false,
                        code: 'MISSING_DOCUMENTS',
                        message: `Please upload all required documents before submitting. Missing: ${uploadableMissingDocuments.join(', ')}.`,
                        missingDocuments: uploadableMissingDocuments,
                        additionalDocuments: manualMissingDocuments,
                        schemeId: selected.id,
                        schemeName: selected.nameEn,
                    });
                }

                const applicationId = toAppId();
                const now = new Date().toISOString();
                const applicationStatus = manualMissingDocuments.length > 0 ? 'pending_documents' : 'submitted';
                await dynamo.send(new PutCommand({
                    TableName: APPLICATIONS_TABLE,
                    Item: {
                        user_id: effectiveUserId,
                        application_id: applicationId,
                        scheme_id: selected.id,
                        scheme_name: selected.nameEn,
                        scheme_code: selected.code,
                        status: applicationStatus,
                        created_at: now,
                        updated_at: now,
                        source: 'agent_workflow',
                        idempotency_key: idempotencyKey || null,
                        missing_documents: manualMissingDocuments,
                        profile_snapshot: profile,
                        documents_snapshot: documentSummary,
                    },
                }));
                return withToolMeta({
                    success: true,
                    code: 'OK',
                    applicationId,
                    schemeId: selected.id,
                    schemeCode: selected.code,
                    schemeName: selected.nameEn,
                    status: applicationStatus,
                    missingDocuments: manualMissingDocuments,
                    message: manualMissingDocuments.length > 0
                        ? `Application created for ${selected.nameEn}. Reference: ${applicationId}. Additional documents still needed: ${manualMissingDocuments.join(', ')}.`
                        : `Application submitted for ${selected.nameEn}. Reference: ${applicationId}. Keep this number for tracking.`,
                });
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
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const patch: Record<string, any> = {};
                const directFields = ['name', 'fullName', 'phone', 'state', 'district', 'gender', 'occupation', 'email', 'pincode', 'address', 'casteCategory', 'preferredLanguage'];
                for (const field of directFields) {
                    const v = getParam(field);
                    if (v) patch[field] = v;
                }
                if (getParam('age')) patch.age = Number(getParam('age'));
                if (getParam('annualIncome')) patch.annualIncome = Number(getParam('annualIncome'));
                if (getParam('bplCardholder')) patch.bplCardholder = ['true', '1', 'yes'].includes(normalizeText(getParam('bplCardholder')));
                if (!Object.keys(patch).length) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'No profile fields provided.' });
                if (patch.annualIncome != null) patch.annual_income = patch.annualIncome;
                if (patch.casteCategory != null) patch.caste_category = patch.casteCategory;
                if (patch.preferredLanguage != null) patch.preferred_language = patch.preferredLanguage;
                const current = await dynamo.send(new GetCommand({ TableName: USERS_TABLE, Key: { user_id: effectiveUserId } })).catch(() => ({ Item: {} } as any));
                const merged = { ...(current.Item ?? {}), ...patch, user_id: effectiveUserId, updated_at: new Date().toISOString() };
                await dynamo.send(new PutCommand({ TableName: USERS_TABLE, Item: merged }));
                return withToolMeta({ success: true, code: 'OK', message: 'Profile updated successfully.', updatedFields: Object.keys(patch), profile: merged });
            }

            case 'setPreferredLanguage': {
                const langRaw = normalizeText(getParam('language') || getParam('preferredLanguage'));
                const map: Record<string, string> = { english: 'en', en: 'en', hindi: 'hi', hi: 'hi', tamil: 'ta', ta: 'ta', telugu: 'te', te: 'te', marathi: 'mr', mr: 'mr', kannada: 'kn', kn: 'kn' };
                const language = map[langRaw] || langRaw;
                if (!['en', 'hi', 'ta', 'te', 'mr', 'kn'].includes(language)) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Unsupported language.' });
                return executeAgentAction({
                    ...event,
                    function: 'updateUserProfile',
                    parameters: [
                        { name: 'userId', value: effectiveUserId },
                        { name: 'preferredLanguage', value: language },
                    ],
                }).then((r) => withToolMeta({ ...r, preferredLanguage: language, message: `Default language updated to ${language}.` }));
            }

            case 'updateUserProfilePatch': {
                return executeAgentAction({
                    ...event,
                    function: 'updateUserProfile',
                    parameters,
                });
            }

            case 'collectProfileGaps': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const flowType = normalizeText(getParam('flowType') || 'apply');
                const userRes = await dynamo.send(new GetCommand({ TableName: USERS_TABLE, Key: { user_id: effectiveUserId } })).catch(() => ({ Item: {} } as any));
                const profile = (userRes.Item ?? {}) as Record<string, any>;
                const commonRequired = ['name', 'phone', 'state', 'district'];
                const applyOnly = ['address'];
                // Scheme discovery should not block on name/phone. Focus on eligibility-driving fields.
                const schemeRequired = ['age', 'annual_income', 'gender', 'occupation', 'caste_category', 'state'];
                const required = flowType === 'schemes'
                    ? schemeRequired
                    : flowType === 'jobs'
                        ? ['state', 'occupation']
                        : [...commonRequired, ...applyOnly];
                const missing = required.filter((f) => {
                    const val = profile[f] ?? profile[f.replace('_', '')] ?? profile[f === 'name' ? 'fullName' : f];
                    return val == null || String(val).trim() === '';
                });
                return withToolMeta({
                    success: true,
                    code: 'OK',
                    flowType,
                    requiredFields: required,
                    missingFields: missing,
                    profile,
                    message: missing.length ? `Missing required profile fields: ${missing.join(', ')}` : 'Profile is complete for this flow.',
                });
            }

            case 'confirmApplicationField': {
                const field = String(getParam('field') || '').trim();
                const value = String(getParam('value') || '').trim();
                if (!field || !value) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'field and value are required.' });
                return executeAgentAction({
                    ...event,
                    function: 'updateUserProfile',
                    parameters: [
                        { name: 'userId', value: effectiveUserId },
                        { name: field, value },
                    ],
                });
            }

            case 'getRequiredDocuments': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const schemes = await loadSchemes();
                const query = `${getParam('query')} ${getParam('schemeName')} ${getParam('schemeId')}`.trim();
                const resolved = resolveSchemesTop3(schemes, query);
                if (resolved.code !== 'OK' || !resolved.best) {
                    return withToolMeta({ success: false, code: resolved.code, message: 'Unable to identify scheme for required documents.' });
                }
                const { providedDocTypes } = await getProfileAndDocumentSummary(effectiveUserId);
                const required = (resolved.best.documentsRequired || []).map((d) => normalizeRequiredDoc(d));
                const missing = required.filter((req) => !providedDocTypes.some((p) => docsMatch(req, p)));
                return withToolMeta({
                    success: true,
                    code: 'OK',
                    schemeId: resolved.best.id,
                    requiredDocuments: required,
                    missingDocuments: missing,
                    message: missing.length ? `Missing documents: ${missing.join(', ')}` : 'All required documents are available.',
                });
            }

            case 'requestDocumentUploadSlot': {
                const documentType = normalizeRequiredDoc(getParam('documentType'));
                if (!documentType) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'documentType is required.' });
                return withToolMeta({
                    success: true,
                    code: 'OK',
                    documentType,
                    uploadApiPath: '/documents/upload',
                    message: `Upload slot ready for ${documentType}.`,
                });
            }

            case 'verifyDocument': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const documentId = getParam('documentId');
                if (!documentId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'documentId is required.' });
                const res = await dynamo.send(new GetCommand({ TableName: DOCUMENTS_TABLE, Key: { user_id: effectiveUserId, document_id: documentId } })).catch(() => ({ Item: undefined } as any));
                if (!res.Item) return withToolMeta({ success: false, code: 'NOT_FOUND', message: 'Document not found.' });
                const item: any = res.Item;
                return withToolMeta({
                    success: true,
                    code: 'OK',
                    documentId,
                    status: item.status || 'processing',
                    structuredData: item.structured_data || {},
                    message: `Document ${documentId} status: ${item.status || 'processing'}.`,
                });
            }

            case 'getSchemesByProfile': {
                const age = parseInt(getParam('age') || '0', 10);
                const annualIncome = parseInt(getParam('annualIncome') || '0', 10);
                const gender = getParam('gender');
                const state = getParam('state');
                const occupation = getParam('occupation');
                const casteCategory = getParam('casteCategory');
                const bplCardholder = ['true', '1', 'yes'].includes((getParam('bplCardholder') || '').toLowerCase()) ? true
                    : ['false', '0', 'no'].includes((getParam('bplCardholder') || '').toLowerCase()) ? false
                        : undefined;
                const profile = { age, annualIncome, income: annualIncome, gender, state, occupation, casteCategory, bplCardholder };
                const schemes = await loadSchemes();
                const scored = schemes
                    .map((s) => {
                        const result = evaluateEligibility(s.criteria, profile);
                        return { ...s, eligibilityScore: result.score, matchReasons: result.matchReasons, exclusionReasons: result.exclusionReasons, eligible: result.eligible };
                    })
                    .filter((s) => s.eligible)   // only return eligible schemes
                    .sort((a, b) => b.eligibilityScore - a.eligibilityScore)
                    .slice(0, 8)
                    .map((s) => ({
                        id: s.id,
                        code: s.code,
                        name: s.nameEn,
                        nameHi: s.nameHi,
                        benefitRs: s.benefitRs,
                        matchPercent: s.eligibilityScore,
                        category: s.category,
                        summary: s.description.slice(0, 120),
                        documentsRequired: s.documentsRequired,
                        matchReasons: s.matchReasons,
                    }));
                return withToolMeta({ success: true, code: 'OK', schemes: scored, totalFound: scored.length, topScheme: scored[0]?.name ?? 'None', topBenefit: scored[0]?.benefitRs ?? 0 });
            }

            case 'getApplicationStatus': {
                const applicationId = getParam('applicationId');
                if (!applicationId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'applicationId is required' });
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const res = await dynamo.send(new GetCommand({ TableName: APPLICATIONS_TABLE, Key: { user_id: effectiveUserId, application_id: applicationId } })).catch(() => ({ Item: undefined } as any));
                if (res.Item) {
                    const item: any = res.Item;
                    return withToolMeta({ success: true, code: 'OK', applicationId, schemeId: item.scheme_id, schemeName: item.scheme_name, status: item.status || 'submitted', createdAt: item.created_at, updatedAt: item.updated_at, message: `Your application status is ${item.status || 'submitted'}.` });
                }
                return withToolMeta({ success: false, code: 'NOT_FOUND', applicationId, message: 'No application found for this reference under your account.' });
            }

            case 'getUserApplicationsSummary': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const q = await dynamo.send(new QueryCommand({
                    TableName: APPLICATIONS_TABLE,
                    KeyConditionExpression: 'user_id = :uid',
                    ExpressionAttributeValues: { ':uid': effectiveUserId },
                    ScanIndexForward: false,
                    Limit: 100,
                })).catch(() => ({ Items: [] } as any));
                const items = (q.Items ?? []) as Record<string, any>[];
                const jobStatus = (x: Record<string, any>) =>
                    (x.application_type === 'job' && x.status === 'interested') ? 'submitted' : (x.status || 'submitted');
                const summary = {
                    total: items.length,
                    submitted: items.filter((x) => jobStatus(x) === 'submitted').length,
                    pending: items.filter((x) => x.status === 'pending').length,
                    approved: items.filter((x) => x.status === 'approved').length,
                    rejected: items.filter((x) => x.status === 'rejected').length,
                };
                return withToolMeta({
                    success: true,
                    code: 'OK',
                    summary,
                    applications: items.slice(0, 20).map((x) => ({
                        applicationId: x.application_id,
                        schemeId: x.scheme_id,
                        schemeCode: x.scheme_code,
                        schemeName: x.scheme_name,
                        jobId: x.job_id,
                        jobTitle: x.job_title,
                        company: x.company,
                        status: jobStatus(x),
                        createdAt: x.created_at,
                    })),
                });
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
                    if (!ALLOW_LOCAL_DATA_FALLBACK) {
                        throw new Error('DATA_UNAVAILABLE: jobs datasource is currently unavailable');
                    }
                    logger.info('Falling back to bundled JSON for jobs', { count: LOCAL_JOBS_DATA.length });
                    jobs = LOCAL_JOBS_DATA.slice(0, 20).map((j: any) => ({
                        id: j.job_id,
                        title: j.title,
                        company: j.company,
                        state: j.state,
                        district: j.district ?? '',
                        type: j.job_type ?? '',
                        salaryMin: j.salary_min ?? 0,
                        salaryMax: j.salary_max ?? 0,
                        description: j.description ?? '',
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
                return withToolMeta({ success: true, code: 'OK', jobs: out, totalFound: out.length });
            }

            case 'createJobApplication': {
                if (!effectiveUserId) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'Please login and try again.' });
                const jobId = String(getParam('jobId') || '').trim();
                const jobTitle = String(getParam('jobTitle') || '').trim();
                const company = String(getParam('company') || '').trim();
                if (!jobId && !jobTitle) return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: 'jobId or jobTitle is required.' });

                const existingRes = await dynamo.send(new QueryCommand({
                    TableName: APPLICATIONS_TABLE,
                    KeyConditionExpression: 'user_id = :uid',
                    ExpressionAttributeValues: { ':uid': effectiveUserId },
                    Limit: 100,
                })).catch(() => ({ Items: [] } as any));
                const existing = (existingRes.Items ?? []).find((i: any) => {
                    if (jobId) return String(i.job_id || '') === jobId;
                    if (jobTitle) return String(i.job_title || '') === jobTitle;
                    return false;
                });
                if (existing) {
                    return withToolMeta({
                        success: false,
                        code: 'ALREADY_APPLIED',
                        applicationId: existing.application_id,
                        message: 'You have already applied for this job.',
                    });
                }

                const profileRes = await dynamo.send(new GetCommand({
                    TableName: USERS_TABLE,
                    Key: { user_id: effectiveUserId },
                })).catch(() => ({ Item: {} } as any));
                const profile = (profileRes.Item ?? {}) as Record<string, unknown>;
                const state = String(profile.state ?? (profile as any).State ?? '').trim();
                const occupation = String(profile.occupation ?? (profile as any).Occupation ?? '').trim();
                if (!state || !occupation) {
                    return withToolMeta({
                        success: false,
                        code: 'VALIDATION_ERROR',
                        message: 'Please complete your profile (state, occupation) before applying for jobs.',
                    });
                }

                const now = new Date().toISOString();
                const applicationId = `JOB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                await dynamo.send(new PutCommand({
                    TableName: APPLICATIONS_TABLE,
                    Item: {
                        user_id: effectiveUserId,
                        application_id: applicationId,
                        application_type: 'job',
                        job_id: jobId || null,
                        job_title: jobTitle || null,
                        company: company || null,
                        scheme_id: '',
                        scheme_name: jobTitle || company || 'Job application',
                        scheme_code: jobId || '',
                        status: 'submitted',
                        created_at: now,
                        updated_at: now,
                        source: 'agent',
                        idempotency_key: null,
                        missing_documents: [],
                        profile_snapshot: profile,
                        documents_snapshot: [],
                    },
                }));

                return withToolMeta({
                    success: true,
                    code: 'OK',
                    applicationId,
                    status: 'submitted',
                    message: `Job application created for ${jobTitle || company || 'this job'}. Reference: ${applicationId}.`,
                });
            }

            default:
                return withToolMeta({ success: false, code: 'VALIDATION_ERROR', message: `Unknown function: ${funcName}` });
        }
    } catch (error: any) {
        logger.error('executeAgentAction failed', { funcName, error: error?.message || String(error) });
        const isDataUnavailable = String(error?.message || '').includes('DATA_UNAVAILABLE');
        return withToolMeta({
            success: false,
            code: isDataUnavailable ? 'DATA_UNAVAILABLE' : 'SYSTEM_ERROR',
            message: isDataUnavailable
                ? 'Data is temporarily unavailable. Please try again shortly.'
                : 'Could not complete the requested action right now.',
        });
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

// scoreScheme is now imported from ../../services/scheme-eligibility-service.js
// The old implementation starting at score=50 has been replaced with the grounded
// evaluateEligibility() function that applies hard-exclusion gates.
