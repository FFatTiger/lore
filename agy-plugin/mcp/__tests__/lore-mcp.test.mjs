import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('MCP bridge identifies agy and forwards JSON-RPC', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'lore-agy-mcp-'));
  let url;
  const server = createServer(async (req, res) => {
    url = req.url;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'lore_status' }] } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../lore-mcp.mjs')], {
        env: { ...process.env, HOME: home, LORE_HOME: home, XDG_CONFIG_HOME: home, LORE_BASE_URL: `http://127.0.0.1:${server.address().port}`, LORE_API_TOKEN: '', API_TOKEN: '', LORE_SKILLS_ENABLED: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.includes('\n')) child.stdin.end();
      });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout }));
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
    });
    assert.equal(result.code, 0);
    assert.equal(url, '/api/mcp?client_type=agy');
    assert.deepEqual(JSON.parse(result.stdout).result.tools, [{ name: 'lore_status' }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(home, { recursive: true, force: true });
  }
});
