import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { apply, inject as pluginInject, name as pluginName } from '../lifecycle.mjs';

const temporaryHomes = [];
const savedEnv = {};

function setEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in savedEnv)) savedEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  Object.keys(savedEnv).forEach((key) => delete savedEnv[key]);
  while (temporaryHomes.length) fs.rmSync(temporaryHomes.pop(), { recursive: true, force: true });
});

function tempHome(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryHomes.push(home);
  return home;
}

function userMessage(id, text) {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } };
}

function fakeAgent(id) {
  const agent = {
    id,
    session: { id },
    ctx: {
      systemPrompt: {
        sections: [],
        // Behave like dsh: a duplicate section name in one scope throws, and
        // the returned disposer removes the registration.
        section(spec) {
          if (agent.ctx.systemPrompt.sections.some((existing) => existing.name === spec.name)) {
            throw new Error(`prompt section "${spec.name}" is already registered in this scope`);
          }
          agent.ctx.systemPrompt.sections.push(spec);
          return () => {
            agent.ctx.systemPrompt.sections = agent.ctx.systemPrompt.sections.filter(
              (existing) => existing !== spec,
            );
          };
        },
      },
    },
  };
  return agent;
}

function harness({ cwd } = {}) {
  const listeners = new Map();
  const ctx = {
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
    },
    workingDirectory: { get: () => cwd || process.cwd() },
  };
  return {
    ctx,
    async created(agent, source = 'startup') {
      for (const listener of listeners.get('agent/created') || []) {
        await listener({ agent, source });
      }
    },
    async preStep(payload, defaultDecision = { kind: 'enter', messages: [...payload.messages] }) {
      let index = 0;
      const run = async () => {
        const list = listeners.get('agent/pre-step') || [];
        if (index >= list.length) return defaultDecision;
        const listener = list[index++];
        return listener(payload, run);
      };
      return run();
    },
  };
}

async function withLoreServer(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push({ url: req.url, headers: req.headers, body });
    const response = handler ? handler(body, res) : { host_output: { mode: 'none', value: null } };
    if (response && response.hang) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sessionStartResponse(systemContext) {
  return { ok: true, host_output: { mode: 'return_value', value: { systemContext } } };
}

function promptSubmitResponse(promptContext) {
  return { ok: true, host_output: { mode: 'return_value', value: { promptContext } } };
}

function useServer(server, home, extra = {}) {
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    base_url: server.baseUrl,
    api_token: 'lm_test',
    ...extra,
  }));
}

test('plugin exports a named cordis plugin that injects workingDirectory', () => {
  assert.equal(pluginName, 'lore-lifecycle');
  assert.deepEqual(pluginInject, ['workingDirectory']);
});

test('session.start posts a full lifecycle payload and scopes the boot section to that agent', async () => {
  const home = tempHome('lore-dsh-life-');
  const project = tempHome('lore-dsh-repo-');
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/lore-dsh-demo.git'], { cwd: project });

  const server = await withLoreServer(() => sessionStartResponse('BOOT CONTEXT'));
  useServer(server, home);
  setEnv({ LORE_HOME: home, LORE_SKILLS_ENABLED: '0' });
  try {
    const h = harness({ cwd: project });
    apply(h.ctx);
    const agent = fakeAgent('session-1');
    await h.created(agent, 'startup');

    assert.equal(server.requests.length, 1);
    const body = server.requests[0].body;
    assert.equal(server.requests[0].url, '/api/lifecycle/event');
    assert.equal(server.requests[0].headers.authorization, 'Bearer lm_test');
    assert.equal(body.protocol_version, 'lore.lifecycle.v1');
    assert.deepEqual(body.runtime, {
      runtime_id: 'dsh',
      runtime_family: 'dsh',
      plugin_version: JSON.parse(fs.readFileSync(new URL('../../.dsh-plugin/plugin.json', import.meta.url), 'utf8')).version,
    });
    assert.deepEqual(body.event, { name: 'session.start', native_name: 'agent/created' });
    assert.equal(body.features, undefined);
    assert.deepEqual(body.normalized, { session_id: 'session-1' });
    assert.equal(body.project.dir_name, path.basename(project));
    assert.equal(body.project.repo_name, 'lore-dsh-demo');
    assert.deepEqual(body.native_input_snapshot, { source: 'startup', cwd: project });

    assert.equal(agent.ctx.systemPrompt.sections.length, 1);
    const section = agent.ctx.systemPrompt.sections[0];
    assert.equal(section.name, 'lore:boot');
    assert.equal(section.text, 'BOOT CONTEXT');
    assert.equal(section.interpolate, false);
  } finally {
    await server.close();
  }
});

test('features.skills is sent when the server advertises Skills', async () => {
  const home = tempHome('lore-dsh-life-');
  const server = await withLoreServer(() => sessionStartResponse('BOOT'));
  useServer(server, home, { server_profile: { base_url: server.baseUrl, capabilities: { skills: true } } });
  setEnv({ LORE_HOME: home });
  try {
    const h = harness();
    apply(h.ctx);
    await h.created(fakeAgent('session-1'));
    assert.deepEqual(server.requests[0].body.features, { skills: true });
  } finally {
    await server.close();
  }
});

test('resume reuses the boot section without a second request; clear refetches', async () => {
  const home = tempHome('lore-dsh-life-');
  let call = 0;
  const server = await withLoreServer(() => sessionStartResponse(`BOOT ${++call}`));
  useServer(server, home);
  setEnv({ LORE_HOME: home });
  try {
    const h = harness();
    apply(h.ctx);
    const first = fakeAgent('session-1');
    await h.created(first, 'startup');
    const resumed = fakeAgent('session-1');
    await h.created(resumed, 'resume');
    assert.equal(server.requests.length, 1);
    assert.equal(resumed.ctx.systemPrompt.sections[0].text, 'BOOT 1');

    const cleared = fakeAgent('session-1');
    await h.created(cleared, 'clear');
    assert.equal(server.requests.length, 2);
    assert.equal(cleared.ctx.systemPrompt.sections[0].text, 'BOOT 2');
  } finally {
    await server.close();
  }
});

test('a repeated agent/created on the same agent replaces the boot section without a duplicate-name throw', async () => {
  const home = tempHome('lore-dsh-life-');
  let call = 0;
  const server = await withLoreServer(() => sessionStartResponse(`BOOT ${++call}`));
  useServer(server, home);
  setEnv({ LORE_HOME: home });
  try {
    const h = harness();
    apply(h.ctx);
    const agent = fakeAgent('session-1');
    await h.created(agent, 'startup');
    assert.equal(agent.ctx.systemPrompt.sections.length, 1);
    assert.equal(agent.ctx.systemPrompt.sections[0].text, 'BOOT 1');

    // clear refetches and re-registers on the same agent scope: the old
    // registration is disposed first, so dsh's duplicate-name guard never fires.
    await h.created(agent, 'clear');
    assert.equal(agent.ctx.systemPrompt.sections.length, 1);
    assert.equal(agent.ctx.systemPrompt.sections[0].name, 'lore:boot');
    assert.equal(agent.ctx.systemPrompt.sections[0].text, 'BOOT 2');
    assert.equal(server.requests.length, 2);
  } finally {
    await server.close();
  }
});

test('prompt.submit fires once per new user message, never per model step', async () => {
  const home = tempHome('lore-dsh-life-');
  const server = await withLoreServer((body) => (body.event?.name === 'session.start'
    ? sessionStartResponse('BOOT')
    : promptSubmitResponse('RECALL')));
  useServer(server, home);
  setEnv({ LORE_HOME: home });
  try {
    const h = harness();
    apply(h.ctx);
    const agent = fakeAgent('session-1');
    await h.created(agent);

    const steps = [
      { turn: 1, step: 1, messages: [userMessage('m1', 'first prompt')] },
      { turn: 1, step: 2, messages: [{ id: 't1', role: 'user', content: [], source: { kind: 'tool' } }] },
      { turn: 2, step: 1, messages: [userMessage('m2', 'second prompt')] },
      { turn: 3, step: 1, messages: [userMessage('m2', 'second prompt')] },
    ];
    for (const payload of steps) {
      await h.preStep({ agent, ...payload, signal: new AbortController().signal });
    }

    const prompts = server.requests.filter((request) => request.body.event?.name === 'prompt.submit');
    assert.equal(prompts.length, 2);
    assert.deepEqual(prompts.map((request) => request.body.normalized.prompt), ['first prompt', 'second prompt']);
    for (const request of prompts) {
      assert.equal(request.body.normalized.session_id, 'session-1');
      assert.equal(request.body.native_input_snapshot, undefined);
      assert.deepEqual(request.body.event, { name: 'prompt.submit', native_name: 'agent/pre-step' });
    }
  } finally {
    await server.close();
  }
});

test('recall context joins the step as a lore context message, after the runtime context', async () => {
  const home = tempHome('lore-dsh-life-');
  const server = await withLoreServer((body) => (body.event?.name === 'session.start'
    ? sessionStartResponse('BOOT')
    : promptSubmitResponse('RECALL CONTEXT')));
  useServer(server, home);
  setEnv({ LORE_HOME: home });
  try {
    const h = harness();
    apply(h.ctx);
    const agent = fakeAgent('session-1');
    await h.created(agent);

    const runtimeContext = {
      id: 'runtime-ctx',
      role: 'user',
      content: [{ type: 'text', text: 'runtime context' }],
      source: { kind: 'system-prompt' },
    };
    const decision = await h.preStep(
      { agent, turn: 1, step: 1, messages: [userMessage('m1', 'hello')], signal: new AbortController().signal },
      { kind: 'enter', messages: [userMessage('m1', 'hello'), runtimeContext] },
    );

    assert.equal(decision.kind, 'enter');
    assert.equal(decision.messages.length, 3);
    const lore = decision.messages[2];
    assert.equal(lore.role, 'user');
    assert.equal(lore.source.kind, 'lore');
    assert.equal(lore.source.form, 'recall');
    assert.equal(lore.content[0].text, 'RECALL CONTEXT');
    assert.ok(lore.id);
  } finally {
    await server.close();
  }
});

test('network errors and timeouts fail open with the default decision', async () => {
  const home = tempHome('lore-dsh-life-');
  // A bound-then-closed port refuses connections instantly on every platform.
  const dead = createServer();
  await new Promise((resolve) => dead.listen(0, '127.0.0.1', resolve));
  const deadPort = dead.address().port;
  await new Promise((resolve) => dead.close(resolve));
  const deadUrl = `http://127.0.0.1:${deadPort}`;

  setEnv({ LORE_HOME: home, LORE_START_TIMEOUT_MS: '400', LORE_PROMPT_TIMEOUT_MS: '400' });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ base_url: deadUrl }));

  const h = harness();
  apply(h.ctx);
  const agent = fakeAgent('session-1');
  await h.created(agent, 'startup');
  assert.equal(agent.ctx.systemPrompt.sections.length, 0);

  const decision = await h.preStep(
    { agent, turn: 1, step: 1, messages: [userMessage('m1', 'hello')], signal: new AbortController().signal },
  );
  assert.deepEqual(decision.messages.map((message) => message.id), ['m1']);

  const server = await withLoreServer(() => ({ hang: true }));
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ base_url: server.baseUrl }));
  const started = Date.now();
  const timedOut = await h.preStep(
    { agent, turn: 2, step: 1, messages: [userMessage('m2', 'again')], signal: new AbortController().signal },
  );
  assert.ok(Date.now() - started >= 350, 'prompt.submit should respect the timeout');
  assert.deepEqual(timedOut.messages.map((message) => message.id), ['m2']);
  await new Promise((resolve) => server.closeAllConnections?.() ?? resolve());
  await server.close();
});
