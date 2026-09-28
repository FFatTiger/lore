import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

const bridgeScript = path.resolve(import.meta.dirname, '..', 'lore-mcp.mjs');
const temporaryHomes = [];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function skillPackage() {
  const content = Buffer.from('---\nname: bridge-skill\ndescription: Bridge Skill\n---\n\n# Bridge Skill\n', 'utf8');
  const fileHash = sha256(content);
  const manifestHash = sha256(Buffer.from(`SKILL.md\n${fileHash}\n${content.length}\n`, 'utf8'));
  const revisionHash = sha256(Buffer.from([
    'name=bridge-skill',
    'description=Bridge Skill',
    'enabled=true',
    `manifest=${manifestHash}`,
    '',
  ].join('\n'), 'utf8'));
  return {
    project_id: 'project-1',
    skill_id: 'skill-1',
    name: 'bridge-skill',
    description: 'Bridge Skill',
    enabled: true,
    version: 1,
    revision_hash: revisionHash,
    manifest_hash: manifestHash,
    catalog_revision: 4,
    files: [{
      path: 'SKILL.md',
      media_type: 'text/markdown',
      content: content.toString('utf8'),
      content_sha256: fileHash,
      size_bytes: content.length,
    }],
  };
}

function runBridge(message, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgeScript], {
      env: { ...process.env, LORE_API_TOKEN: '', API_TOKEN: '', LORE_SKILLS_ENABLED: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`bridge timed out: ${stderr}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      child.stdin.end();
      resolve({ payload: JSON.parse(stdout.slice(0, newline)), stderr });
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

async function withCore(handler) {
  const requests = [];
  const headers = [];
  const urls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push(body);
    headers.push(req.headers);
    urls.push(req.url);
    const response = handler(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    headers,
    urls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

afterEach(() => {
  while (temporaryHomes.length) fs.rmSync(temporaryHomes.pop(), { recursive: true, force: true });
});

test('stdio bridge materializes successful lore_skill_get and returns local execution details', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-zcode-bridge-'));
  temporaryHomes.push(home);
  const skill = skillPackage();
  const core = await withCore((request) => ({
    jsonrpc: '2.0',
    id: request.id,
    result: { content: [{ type: 'text', text: JSON.stringify(skill) }] },
  }));
  try {
    const { payload, stderr } = await runBridge({
      jsonrpc: '2.0',
      id: 'get-1',
      method: 'tools/call',
      params: { name: 'lore_skill_get', arguments: { skill_id: 'skill-1' } },
    }, {
      LORE_HOME: home,
      LORE_BASE_URL: core.baseUrl,
      LORE_API_TOKEN: 'bridge-token',
      LORE_SKILLS_ENABLED: '1',
    });
    assert.equal(stderr, '');
    assert.equal(core.urls[0], '/api/mcp?client_type=zcode');
    assert.equal(core.headers[0].authorization, 'Bearer bridge-token');
    const result = JSON.parse(payload.result.content[0].text);
    assert.equal(result.skill_id, 'skill-1');
    assert.equal(result.version, 1);
    assert.equal(result.skill_markdown, skill.files[0].content);
    assert.deepEqual(result.managed_files, ['SKILL.md']);
    assert.equal(fs.readFileSync(path.join(result.local_directory, 'SKILL.md'), 'utf8'), skill.files[0].content);
    assert.equal(fs.existsSync(path.join(result.local_directory, '.lore-skill-marker.json')), true);
  } finally {
    await core.close();
  }
});

test('stdio bridge forwards non-get and Core error responses without touching Skill storage', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-zcode-bridge-'));
  temporaryHomes.push(home);
  const core = await withCore((request) => {
    if (request.params?.name === 'lore_skill_get') {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { isError: true, content: [{ type: 'text', text: 'Lore skill get failed: skill not found' }] },
      };
    }
    return { jsonrpc: '2.0', id: request.id, result: { tools: [{ name: 'lore_status' }] } };
  });
  try {
    const normal = await runBridge({ jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} }, {
      LORE_HOME: home,
      LORE_BASE_URL: core.baseUrl,
    });
    assert.deepEqual(normal.payload.result.tools, [{ name: 'lore_status' }]);

    const failedGet = await runBridge({
      jsonrpc: '2.0',
      id: 'get-missing',
      method: 'tools/call',
      params: { name: 'lore_skill_get', arguments: { skill_id: 'missing' } },
    }, {
      LORE_HOME: home,
      LORE_BASE_URL: core.baseUrl,
      LORE_SKILLS_ENABLED: '1',
    });
    assert.equal(failedGet.payload.result.isError, true);
    assert.match(failedGet.payload.result.content[0].text, /skill not found/);
    assert.equal(fs.existsSync(path.join(home, 'skill-artifacts')), false);
  } finally {
    await core.close();
  }
});

test('stdio bridge keeps Skill tools hidden unless the configured server advertises Skills', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lore-zcode-bridge-'));
  temporaryHomes.push(home);
  const core = await withCore((request) => ({
    jsonrpc: '2.0',
    id: request.id,
    result: { tools: [{ name: 'lore_status' }, { name: 'lore_skill_get' }, { name: 'lore_skill_list' }] },
  }));
  try {
    const list = await runBridge({ jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} }, {
      LORE_HOME: home,
      LORE_BASE_URL: core.baseUrl,
    });
    assert.deepEqual(list.payload.result.tools, [{ name: 'lore_status' }]);

    const get = await runBridge({
      jsonrpc: '2.0',
      id: 'get-1',
      method: 'tools/call',
      params: { name: 'lore_skill_get', arguments: { skill_id: 'skill-1' } },
    }, { LORE_HOME: home, LORE_BASE_URL: core.baseUrl });
    assert.equal(get.payload.result.isError, true);
    assert.match(get.payload.result.content[0].text, /does not advertise Skills/);
    assert.equal(core.requests.length, 1);

    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
      base_url: core.baseUrl,
      server_profile: { base_url: core.baseUrl, capabilities: { skills: true } },
    }));
    const advertised = await runBridge({ jsonrpc: '2.0', id: 'list-2', method: 'tools/list', params: {} }, { LORE_HOME: home });
    assert.equal(advertised.payload.result.tools.length, 3);
  } finally {
    await core.close();
  }
});
