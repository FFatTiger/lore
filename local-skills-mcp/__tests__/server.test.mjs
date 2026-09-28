import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { PassThrough } from 'node:stream';
import { createLocalSkillsMcpServer } from '../src/server.mjs';
import { encodeContentLength, encodeNdjson, StdioJsonRpcFramer } from '../src/stdio.mjs';
import { callTool, TOOL_DEFINITIONS, createToolState } from '../src/tools.mjs';
import { computeManifestHash, sha256Text } from '../vendor/skill-workcopy.mjs';
import { loadConfig } from '../src/config.mjs';

const temps = [];
function rmWritable(dir) {
  const walk = (current) => {
    try {
      const st = lstatSync(current);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        try { chmodSync(current, 0o755); } catch { /* ignore */ }
        for (const entry of readdirSync(current)) walk(path.join(current, entry));
      } else if (st.isFile()) {
        try { chmodSync(current, 0o644); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  };
  walk(dir);
  rmSync(dir, { recursive: true, force: true });
}
after(() => {
  for (const dir of temps) rmWritable(dir);
});

function tempDir(prefix = 'lore-skills-mcp-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

async function withFakeSkillsServer(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body,
    });
    const result = await handler({ req, url, body, headers: req.headers });
    const status = result?.status || 200;
    const payload = result?.json !== undefined ? result.json : result;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function skillDetail(overrides = {}) {
  return {
    skill_id: 'skill-1',
    id: 'skill-1',
    name: 'demo-skill',
    description: 'Demo',
    version: 3,
    project_id: 'proj-1',
    files: [
      {
        path: 'SKILL.md',
        content: '# Demo Skill\n\nDo the thing.\n',
      },
    ],
    ...overrides,
  };
}

test('tools/list exposes all lore_skill_* names without artifact create', () => {
  const names = TOOL_DEFINITIONS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'lore_skill_create',
    'lore_skill_delete',
    'lore_skill_get',
    'lore_skill_list',
    'lore_skill_search',
    'lore_skill_status',
    'lore_skill_update',
  ]);
  assert.equal(TOOL_DEFINITIONS.some((t) => t.name === 'lore_skill_artifact_create'), false);
  const get = TOOL_DEFINITIONS.find((tool) => tool.name === 'lore_skill_get');
  const update = TOOL_DEFINITIONS.find((tool) => tool.name === 'lore_skill_update');
  const remove = TOOL_DEFINITIONS.find((tool) => tool.name === 'lore_skill_delete');
  assert.deepEqual(get.inputSchema.required, ['skill_id']);
  assert.deepEqual(update.inputSchema.required, ['skill_id', 'expected_version']);
  assert.deepEqual(remove.inputSchema.required, ['skill_id']);
});

test('unsupported local MCP exposes no tools and never calls Core', async () => {
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  const server = createLocalSkillsMcpServer({
    config: {
      loreHome: tempDir(),
      baseUrl: 'http://127.0.0.1:9',
      apiToken: '',
      clientType: 'codex',
      timeoutMs: 1000,
      skillsEnabled: false,
    },
    stdout,
    frameMode: 'content-length',
    responseMode: 'content-length',
  });
  await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  await server.handleMessage({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'lore_skill_list', arguments: {} },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const framer = new StdioJsonRpcFramer({ mode: 'content-length' });
  const messages = [];
  framer.onMessage = ({ message }) => messages.push(message);
  framer.push(Buffer.concat(chunks).toString('utf8'));
  assert.deepEqual(messages[0].result.tools, []);
  assert.equal(messages[1].result.isError, true);
  assert.match(messages[1].result.content[0].text, /does not advertise Skills support/);
});

test('stdio process handshake works with Codex/Claude NDJSON transport', async () => {
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, '../src/server.mjs'), '--client-type', 'codex'], {
    env: { ...process.env, LORE_HOME: tempDir(), LORE_BASE_URL: 'http://127.0.0.1:9', LORE_API_TOKEN: '', LORE_SKILLS_ENABLED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdin.end();
  await new Promise((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  const messages = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(messages[0].result.serverInfo.name, 'lore-skills');
  assert.equal(messages[1].result.tools.length, 7);
});

test('stdio initialize + tools/list with Content-Length framing', async () => {
  const stdout = new PassThrough();
  const chunks = [];
  stdout.on('data', (c) => chunks.push(Buffer.from(c)));

  const server = createLocalSkillsMcpServer({
    config: {
      loreHome: tempDir(),
      baseUrl: 'http://127.0.0.1:9',
      apiToken: '',
      clientType: 'codex',
      timeoutMs: 1000,
      skillsEnabled: true,
    },
    stdout,
    frameMode: 'content-length',
    responseMode: 'content-length',
  });

  server.push(encodeContentLength({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  }));
  server.push(encodeContentLength({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }));

  await new Promise((r) => setTimeout(r, 30));
  const raw = Buffer.concat(chunks).toString('utf8');
  assert.match(raw, /Content-Length:/i);

  const framer = new StdioJsonRpcFramer({ mode: 'content-length' });
  const messages = [];
  framer.onMessage = ({ message }) => messages.push(message);
  framer.push(raw);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].result.serverInfo.name, 'lore-skills');
  assert.equal(messages[1].result.tools.length, 7);
  assert.ok(messages[1].result.tools.every((t) => t.name.startsWith('lore_skill_')));
});

test('NDJSON framing is accepted and mirrored', async () => {
  const stdout = new PassThrough();
  let out = '';
  stdout.on('data', (c) => { out += c.toString('utf8'); });

  const server = createLocalSkillsMcpServer({
    config: {
      loreHome: tempDir(),
      baseUrl: 'http://127.0.0.1:9',
      apiToken: '',
      clientType: 'claudecode',
      timeoutMs: 1000,
      skillsEnabled: true,
    },
    stdout,
  });

  server.push(encodeNdjson({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(server.responseMode, 'ndjson');
  assert.match(out, /\{"jsonrpc":"2\.0","id":1,"result":\{\}\}\n/);
});

test('lore_skill_get materializes work copy via fake HTTP and returns SKILL.md + skill_dir', async () => {
  const loreHome = tempDir();
  const fake = await withFakeSkillsServer(({ url }) => {
    if (url.pathname === '/api/skills/skill-1') {
      return skillDetail();
    }
    return { status: 404, json: { error: 'not found' } };
  });

  try {
    const config = {
      loreHome,
      baseUrl: fake.baseUrl,
      apiToken: 'secret-token',
      clientType: 'codex',
      timeoutMs: 5000,
      skillsEnabled: true,
    };
    const state = createToolState();
    const result = await callTool(config, 'lore_skill_get', { skill_id: 'skill-1' }, state);
    assert.equal(result.isError, undefined);
    const text = result.content[0].text;
    assert.match(text, /Skill read-only mirror ready: demo-skill/);
    assert.match(text, /skill_dir:/);
    assert.match(text, /# Demo Skill/);
    assert.match(text, /downloaded: true/);

    assert.equal(fake.requests.length, 1);
    assert.equal(fake.requests[0].query.client_type, 'codex');
    assert.equal(fake.requests[0].headers.authorization, 'Bearer secret-token');

    const dirMatch = text.match(/skill_dir: (.+)/);
    assert.ok(dirMatch);
    const skillDir = dirMatch[1].trim();
    assert.equal(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Demo Skill\n\nDo the thing.\n');
    assert.ok(readFileSync(path.join(skillDir, '.lore-skill-marker.json'), 'utf8'));
  } finally {
    await fake.close();
  }
});

test('lore_skill_get same-version reuse: extra local files do not trigger tamper and survive (downloaded=false)', async () => {
  const loreHome = tempDir();
  const fake = await withFakeSkillsServer(({ url }) => {
    if (url.pathname === '/api/skills/skill-1') {
      return skillDetail();
    }
    return { status: 404, json: { error: 'not found' } };
  });
  try {
    const config = {
      loreHome,
      baseUrl: fake.baseUrl,
      apiToken: 'secret-token',
      clientType: 'codex',
      timeoutMs: 5000,
      skillsEnabled: true,
    };
    const state = createToolState();
    const first = await callTool(config, 'lore_skill_get', { skill_id: 'skill-1' }, state);
    const firstDir = first.content[0].text.match(/skill_dir: (.+)/);
    assert.ok(firstDir);
    const skillDir = firstDir[1].trim();
    assert.match(first.content[0].text, /downloaded: true/);

    // Agent creates local outputs directly inside the writable skill directory.
    mkdirSync(path.join(skillDir, 'local-output'), { recursive: true });
    writeFileSync(path.join(skillDir, 'local-output', 'notes.md'), '# local notes\n');
    writeFileSync(path.join(skillDir, 'scratch.txt'), 'scratch\n');

    // Same-version fetch reuses the local copy; extra files never trigger tamper.
    const second = await callTool(config, 'lore_skill_get', { skill_id: 'skill-1' }, state);
    assert.match(second.content[0].text, /downloaded: false/);
    assert.equal(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Demo Skill\n\nDo the thing.\n');
    assert.equal(readFileSync(path.join(skillDir, 'local-output', 'notes.md'), 'utf8'), '# local notes\n');
    assert.equal(readFileSync(path.join(skillDir, 'scratch.txt'), 'utf8'), 'scratch\n');
    assert.equal(fake.requests.length, 2);
  } finally {
    await fake.close();
  }
});

test('lore_skill_get restores tampered managed files (downloaded=true) while extra local files survive', async () => {
  const loreHome = tempDir();
  const fake = await withFakeSkillsServer(({ url }) => {
    if (url.pathname === '/api/skills/skill-1') {
      return skillDetail();
    }
    return { status: 404, json: { error: 'not found' } };
  });
  try {
    const config = {
      loreHome,
      baseUrl: fake.baseUrl,
      apiToken: 'secret-token',
      clientType: 'codex',
      timeoutMs: 5000,
      skillsEnabled: true,
    };
    const state = createToolState();
    const first = await callTool(config, 'lore_skill_get', { skill_id: 'skill-1' }, state);
    const firstDir = first.content[0].text.match(/skill_dir: (.+)/);
    assert.ok(firstDir);
    const skillDir = firstDir[1].trim();

    // Extra local output (writable, not managed).
    writeFileSync(path.join(skillDir, 'local-output.txt'), 'agent output v1\n');
    // Tamper with a server-managed file (installed read-only; make writable first).
    chmodSync(path.join(skillDir, 'SKILL.md'), 0o644);
    writeFileSync(path.join(skillDir, 'SKILL.md'), '# Tampered\n');
    writeFileSync(path.join(skillDir, 'local-output.txt'), 'agent output v2\n');

    // Managed-file modification triggers restore; the extra file survives.
    const second = await callTool(config, 'lore_skill_get', { skill_id: 'skill-1' }, state);
    assert.match(second.content[0].text, /downloaded: true/);
    assert.equal(readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8'), '# Demo Skill\n\nDo the thing.\n');
    assert.equal(readFileSync(path.join(skillDir, 'local-output.txt'), 'utf8'), 'agent output v2\n');
  } finally {
    await fake.close();
  }
});

test('lore_skill_status lists local work copies without server project context', async () => {
  const loreHome = tempDir();
  mkdirSync(path.join(loreHome, 'skill-artifacts', 'project-a', 'demo-skill'), { recursive: true });
  writeFileSync(path.join(loreHome, 'skill-artifacts', 'project-a', 'demo-skill', 'SKILL.md'), '# demo\n');
  const markerContent = '# demo\n';
  const markerHash = computeManifestHash([{
    path: 'SKILL.md',
    sha256: sha256Text(markerContent),
    size: Buffer.byteLength(markerContent, 'utf-8'),
  }]);
  writeFileSync(path.join(loreHome, 'skill-artifacts', 'project-a', 'demo-skill', '.lore-skill-marker.json'), JSON.stringify({
    schema: 'lore.skill.workcopy.v1', project_id: 'project-a', skill_id: 'skill-a', name: 'demo-skill', version: 1,
    managed_files: ['SKILL.md'], manifest_hash: markerHash, readonly: true, synced_at: new Date().toISOString(),
  }));
  const result = await callTool({ loreHome, baseUrl: 'http://127.0.0.1:1', apiToken: '', clientType: 'codex', timeoutMs: 10, skillsEnabled: true }, 'lore_skill_status', {}, createToolState());
  assert.match(result.content[0].text, /demo-skill/);
  assert.match(result.content[0].text, /project-a/);
  assert.match(result.content[0].text, /ready/);
});

test('lore_skill_update rejects non-positive expected_version without crashing', async () => {
  const config = {
    loreHome: tempDir(),
    baseUrl: 'http://127.0.0.1:9',
    apiToken: '',
    clientType: 'codex',
    timeoutMs: 1000,
    skillsEnabled: true,
  };
  const result = await callTool(config, 'lore_skill_update', { skill_id: 'x', expected_version: 0 }, createToolState());
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /expected_version/);
});

test('tools/call soft-fails on HTTP error without throwing', async () => {
  const fake = await withFakeSkillsServer(() => ({ status: 500, json: { error: 'boom' } }));
  try {
    const config = {
      loreHome: tempDir(),
      baseUrl: fake.baseUrl,
      apiToken: '',
      clientType: 'claudecode',
      timeoutMs: 3000,
      skillsEnabled: true,
    };
    const result = await callTool(config, 'lore_skill_list', {}, createToolState());
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /failed/i);
    assert.equal(fake.requests[0].query.client_type, 'claudecode');
  } finally {
    await fake.close();
  }
});

test('loadConfig reads shared config and never requires token in argv', () => {
  const home = tempDir();
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    base_url: 'https://lore.example',
    api_token: 'from-file',
  }));
  const cfg = loadConfig({
    loreHome: home,
    env: { LORE_HOME: home },
    argv: ['--client-type', 'codex'],
  });
  assert.equal(cfg.baseUrl, 'https://lore.example');
  assert.equal(cfg.apiToken, 'from-file');
  assert.equal(cfg.clientType, 'codex');
});
