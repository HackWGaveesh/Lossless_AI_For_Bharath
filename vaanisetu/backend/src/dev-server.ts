import express, { type Request, type Response } from 'express';
import { handler as schemesListHandler } from './api/schemes/list.js';
import { handler as schemesSearchHandler } from './api/schemes/search.js';
import { handler as documentUploadHandler } from './api/documents/upload.js';
import { handler as applicationCreateHandler } from './api/applications/create.js';
import { handler as applicationListHandler } from './api/applications/list.js';

const app = express();
app.use(express.json());

function toApiGatewayEvent(req: Request): Parameters<typeof schemesListHandler>[0] {
  return {
    body: req.method !== 'GET' ? JSON.stringify(req.body) : null,
    queryStringParameters: req.query as Record<string, string> || null,
    pathParameters: req.params,
    requestContext: { requestId: 'local-' + Date.now() },
  } as Parameters<typeof schemesListHandler>[0];
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
    const result = await schemesListHandler(event, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/schemes/search', async (req, res) => {
  try {
    const event = { ...toApiGatewayEvent(req), body: JSON.stringify(req.body) };
    const result = await schemesSearchHandler(event, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/documents/upload', async (req, res) => {
  try {
    const event = { ...toApiGatewayEvent(req), body: JSON.stringify(req.body) };
    const result = await documentUploadHandler(event, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/api/applications', async (req, res) => {
  try {
    const event = { ...toApiGatewayEvent(req), queryStringParameters: { ...req.query, userId: req.query.userId ?? 'demo-user-1' } };
    const result = await applicationListHandler(event, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.post('/api/applications', async (req, res) => {
  try {
    const event = { ...toApiGatewayEvent(req), body: JSON.stringify(req.body) };
    const result = await applicationCreateHandler(event, {} as never, () => {}) as { statusCode: number; headers?: Record<string, string>; body: string };
    sendLambdaResponse(res, result);
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'vaanisetu-backend' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`VaaniSetu backend dev server running at http://localhost:${PORT}`);
});
