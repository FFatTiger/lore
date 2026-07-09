/**
 * MCP Streamable HTTP endpoint.
 *
 * Uses Next.js Pages Router (gives native Node.js req/res)
 * so the MCP SDK's StreamableHTTPServerTransport works directly.
 *
 * Supports:
 *   POST /api/mcp  — JSON-RPC messages (including initialize)
 *   GET  /api/mcp  — not used in stateless JSON response mode
 *   DELETE /api/mcp — no-op session teardown
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { normalizeClientType } from '../../server/auth';
import { createMcpServer } from '../../server/mcpServer';

// Disable Next.js body parsing — the SDK reads the raw body itself for GET/DELETE,
// and we pass the parsed JSON for POST.
export const config = {
  api: { bodyParser: false },
};

/**
 * Read and parse the request body as JSON (only for POST).
 */
async function readJsonBody(req: NextApiRequest): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function jsonRpcError(res: NextApiResponse, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  // Optional bearer-token auth (reuse the same env var as the REST API)
  const expectedToken = process.env.API_TOKEN || '';
  if (expectedToken) {
    const auth = (req.headers.authorization as string) || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7).trim() !== expectedToken) {
      res.status(401).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Unauthorized' }, id: null });
      return;
    }
  }

  if (req.method === 'GET') {
    res.setHeader('Allow', 'POST, DELETE');
    jsonRpcError(res, 405, -32000, 'Method not allowed in stateless JSON response mode.');
    return;
  }

  if (req.method === 'DELETE') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, DELETE');
    jsonRpcError(res, 405, -32000, 'Method not allowed.');
    return;
  }

  try {
    const requestClientType = normalizeClientType(req.query.client_type);
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      jsonRpcError(res, 400, -32700, 'Parse error: Invalid JSON');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = await createMcpServer({ clientType: requestClientType });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error('MCP endpoint error:', error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
}
