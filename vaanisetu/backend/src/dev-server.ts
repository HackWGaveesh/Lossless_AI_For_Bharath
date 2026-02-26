import express, { type Request, type Response } from 'express';
import { handler as schemesListHandler } from './api/schemes/list.js';
import { handler as schemeDetailHandler } from './api/schemes/detail.js';
import { handler as schemesSearchHandler } from './api/schemes/search.js';
import { handler as documentUploadHandler } from './api/documents/upload.js';
import { handler as documentStatusHandler } from './api/documents/status.js';
import { handler as applicationCreateHandler } from './api/applications/create.js';
import { handler as applicationListHandler } from './api/applications/list.js';
import { handler as voiceQueryHandler } from './api/voice/query.js';
import { handler as jobsListHandler } from './api/jobs/list.js';
import { handler as jobsMatchHandler } from './api/jobs/match.js';
import { handler as userProfileHandler } from './api/user/profile.js';
import { handler as healthHandler } from './api/health.js';

const app = express();
app.use(express.json());

function getUserId(req: Request): string {
  return (req.headers['x-user-id'] as string) ?? 'demo-user-1';
}

function toApiGatewayEvent(req: Request, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : null,
    queryStringParameters: (req.query as Record<string, string>) || null,
    pathParameters: req.params,
    httpMethod: req.method,
    requestContext: {
      requestId: 'local-' + Date.now(),
      authorizer: { claims: { sub: getUserId(req) } },
    },
    ...overrides,
  };
}

function sendLambdaResponse(res: Response, result: { statusCode: number; headers?: Record<string, string>; body: string }) {
  res.status(result.statusCode);
  if (result.headers) {
    Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
  }
  res.send(result.body);
}

app.get('/api/schemes', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await schemesListHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/schemes/:schemeId', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { pathParameters: { schemeId: req.params.schemeId } });
    const result = await schemeDetailHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/schemes/search', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { body: JSON.stringify(req.body) });
    const result = await schemesSearchHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/documents/upload', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { body: JSON.stringify(req.body) });
    const result = await documentUploadHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/applications', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { queryStringParameters: { ...req.query, userId: req.query.userId ?? getUserId(req) } });
    const result = await applicationListHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/applications', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { body: JSON.stringify(req.body) });
    const result = await applicationCreateHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/documents/:id/status', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { pathParameters: { id: req.params.id }, queryStringParameters: { ...req.query, userId: getUserId(req) } });
    const result = await documentStatusHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/voice/query', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { body: JSON.stringify(req.body) });
    const result = await voiceQueryHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await jobsListHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/jobs/match', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { body: JSON.stringify(req.body) });
    const result = await jobsMatchHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/user/profile', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req);
    const result = await userProfileHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.put('/api/user/profile', async (req, res) => {
  try {
    const event = toApiGatewayEvent(req, { body: JSON.stringify(req.body) });
    const result = await userProfileHandler(event as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    const result = await healthHandler({} as never, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch {
    res.status(503).json({ status: 'error', service: 'vaanisetu-backend' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'vaanisetu-backend' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`VaaniSetu backend dev server running at http://localhost:${PORT}`);
});
