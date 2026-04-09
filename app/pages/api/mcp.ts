/**
 * MCP Streamable HTTP endpoint.
 *
 * Uses Next.js Pages Router (gives native Node.js req/res)
 * so the MCP SDK's StreamableHTTPServerTransport works directly.
 *
 * Supports:
 *   POST /api/mcp  — JSON-RPC messages (including initialize)
 *   GET  /api/mcp  — SSE stream for server-to-client notifications
 *   DELETE /api/mcp — session teardown
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../server/mcpServer';

// Disable Next.js body parsing — the SDK reads the raw body itself for GET/DELETE,
// and we pass the parsed JSON for POST.
export const config = {
  api: { bodyParser: false },
};

const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Read and parse the request body as JSON (only for POST).
 */
async function readJsonBody(req: NextApiRequest): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
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

  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && req.method === 'POST') {
      // Could be an initialize request — parse body first to check
      const body = await readJsonBody(req);

      if (body && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid: string) => {
            transports.set(sid, transport!);
          },
        });

        transport.onclose = () => {
          const sid = transport!.sessionId;
          if (sid) transports.delete(sid);
        };

        const server = createMcpServer();
        await server.connect(transport);

        // Pass the already-parsed body
        await transport.handleRequest(req, res, body);
        return;
      }

      // Not an initialize request and no session — reject
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    // For existing sessions: POST needs parsed body, GET/DELETE do not
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      await transport!.handleRequest(req, res, body);
    } else {
      await transport!.handleRequest(req, res);
    }
  } catch (error) {
    console.error('MCP endpoint error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}
