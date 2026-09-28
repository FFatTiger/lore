import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  detectProjectInfo,
  extractMessageText,
  registerHooks,
} from '../hooks';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('Pi extension hooks', () => {
  function makeMockPi() {
    const events: Record<string, any> = {};
    return {
      events,
      on(event: string, handler: any) {
        events[event] = handler;
      },
      logger: { warn: vi.fn(), info: vi.fn() },
    };
  }

  it('extracts user text from Pi message blocks', () => {
    expect(extractMessageText({ content: [{ type: 'text', text: 'hello' }, { type: 'image' }, { type: 'text', text: 'world' }] })).toBe('hello\nworld');
  });

  it('registers Pi lifecycle hooks', () => {
    const pi = makeMockPi();
    registerHooks(pi as any, { injectPromptGuidance: false, recallEnabled: false, startupHealthcheck: false });
    expect(pi.events.session_start).toBeTypeOf('function');
    expect(pi.events.before_agent_start).toBeTypeOf('function');
    expect(pi.events.session_shutdown).toBeTypeOf('function');
    expect(pi.events.tool_call).toBeUndefined();
  });

  it('detects project identity from the session cwd instead of the host process cwd', () => {
    const sessionCwd = mkdtempSync(join(tmpdir(), 'lore-session-cwd-'));
    expect(detectProjectInfo(sessionCwd).dir_name).toBe(basename(sessionCwd));
    expect(detectProjectInfo().dir_name).toBe(basename(process.cwd()));
  });

  it('sends the session cwd as project identity in the startup lifecycle', async () => {
    const pi = makeMockPi();
    const sessionCwd = mkdtempSync(join(tmpdir(), 'lore-project-'));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ host_output: { mode: 'none', value: null } }),
    })));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: true,
      recallEnabled: false,
      startupHealthcheck: false,
    });
    await pi.events.session_start({ reason: 'startup' }, {
      cwd: sessionCwd,
      sessionManager: { getSessionId: () => 'sess-cwd' },
    });

    const startup = (fetch as any).mock.calls
      .map((call: any[]) => JSON.parse(String(call[1]?.body || '{}')))
      .find((body: any) => body?.event?.name === 'session.start');
    expect(startup.project.dir_name).toBe(basename(sessionCwd));
  });

  it('keeps prompt lifecycle available for skills when memory recall is disabled', async () => {
    const pi = makeMockPi();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        host_output: { mode: 'none', value: null },
        skill_catalog: { project_id: 'project-1', catalog_revision: 0 },
        skill_candidates: [],
      }),
    })));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: false,
      recallEnabled: false,
      startupHealthcheck: false,
    });
    await pi.events.before_agent_start({ prompt: 'check skill', systemPrompt: 'base' }, {
      sessionManager: { getSessionId: () => 'sess-skills' },
    });
    const bodies = (fetch as any).mock.calls
      .map((call: any[]) => JSON.parse(String(call[1]?.body || '{}')))
      .filter((body: any) => body?.event?.name);
    expect(bodies.map((body: any) => body.event.name)).toContain('prompt.submit');
    expect(bodies.find((body: any) => body.event.name === 'prompt.submit')?.features).toEqual({ memory_recall: false });
  });

  it('coalesces duplicate session starts for the active binding', async () => {
    const pi = makeMockPi();
    let resolveStart!: (response: any) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveStart = resolve; })));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: true,
      recallEnabled: false,
      startupHealthcheck: false,
    });

    const ctx = { sessionManager: { getSessionId: () => 'sess-duplicate' } };
    const first = pi.events.session_start({ reason: 'startup' }, ctx);
    const duplicate = pi.events.session_start({ reason: 'reload' }, ctx);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveStart({
      ok: true, status: 200, statusText: 'OK',
      text: async () => JSON.stringify({
        host_output: { mode: 'return_value', value: { systemPromptAppend: 'ONCE' } },
      }),
    });
    await Promise.all([first, duplicate]);

    const turn = await pi.events.before_agent_start({ prompt: '', systemPrompt: 'base' }, ctx);
    expect(turn?.systemPrompt).toBe('base\n\nONCE');
    expect((await pi.events.before_agent_start({ prompt: '', systemPrompt: 'base' }, ctx))?.systemPrompt).toBe('base\n\nONCE');
  });

  it('ignores an old session start that resolves after a newer binding', async () => {
    const pi = makeMockPi();
    const resolvers = new Map<string, (response: any) => void>();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const sessionId = body.normalized.session_id;
      return new Promise((resolve) => { resolvers.set(sessionId, resolve); });
    }));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: true,
      recallEnabled: false,
      startupHealthcheck: false,
    });

    const ctxA = { sessionManager: { getSessionId: () => 'sess-a' } };
    const ctxB = { sessionManager: { getSessionId: () => 'sess-b' } };
    const startA = pi.events.session_start({ reason: 'startup' }, ctxA);
    const startB = pi.events.session_start({ reason: 'new' }, ctxB);

    resolvers.get('sess-b')!({
      ok: true, status: 200, statusText: 'OK',
      text: async () => JSON.stringify({ host_output: { mode: 'return_value', value: { systemPromptAppend: 'B' } } }),
    });
    await startB;
    resolvers.get('sess-a')!({
      ok: true, status: 200, statusText: 'OK',
      text: async () => JSON.stringify({ host_output: { mode: 'return_value', value: { systemPromptAppend: 'A' } } }),
    });
    await startA;

    expect((await pi.events.before_agent_start({ prompt: '', systemPrompt: 'base' }, ctxB))?.systemPrompt).toBe('base\n\nB');
    // Both sessions keep their own boot baseline: the newer binding must not
    // evict the older session's startup context.
    expect((await pi.events.before_agent_start({ prompt: '', systemPrompt: 'base' }, ctxA))?.systemPrompt).toBe('base\n\nA');
  });

  it('drops the cached boot baseline on session shutdown', async () => {
    const pi = makeMockPi();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      text: async () => JSON.stringify({ host_output: { mode: 'return_value', value: { systemPromptAppend: 'BASELINE' } } }),
    })));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: true,
      recallEnabled: false,
      startupHealthcheck: false,
    });

    const ctx = { sessionManager: { getSessionId: () => 'sess-shutdown' } };
    await pi.events.session_start({ reason: 'startup' }, ctx);
    expect((await pi.events.before_agent_start({ prompt: '', systemPrompt: 'base' }, ctx))?.systemPrompt).toBe('base\n\nBASELINE');

    await pi.events.session_shutdown({ reason: 'new' }, ctx);
    expect((await pi.events.before_agent_start({ prompt: '', systemPrompt: 'base' }, ctx))?.systemPrompt).toBeUndefined();
  });

  it('re-appends the session startup context on every agent turn', async () => {
    const pi = makeMockPi();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (String(url).includes('/lifecycle/event')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body?.event?.name === 'session.start') {
          return {
            ok: true, status: 200, statusText: 'OK',
            text: async () => JSON.stringify({
              host_output: { mode: 'return_value', value: { systemPromptAppend: 'LIFECYCLE SYSTEM' } },
            }),
          };
        }
        if (body?.event?.name === 'prompt.submit') {
          return {
            ok: true, status: 200, statusText: 'OK',
            text: async () => JSON.stringify({
              host_output: {
                mode: 'return_value',
                value: {
                  message: {
                    customType: 'lore-recall',
                    content: '<recall session_id="sess-2" query_id="qid-2">\n0.70 | core://project\n</recall>',
                    display: false,
                  },
                },
              },
            }),
          };
        }
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        text: async () => JSON.stringify({ items: [] }),
      };
    }));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
    });

    const ctx = { sessionManager: { getSessionId: () => 'sess-2' } };
    expect(await pi.events.session_start({ reason: 'startup' }, ctx)).toBeUndefined();

    let bodies = (fetch as any).mock.calls.map((call: any[]) => JSON.parse(String(call[1]?.body || '{}')));
    expect(bodies.map((body: any) => body.event.name)).toEqual(['session.start']);

    (fetch as any).mockClear();
    const first = await pi.events.before_agent_start({ prompt: 'what now?', systemPrompt: 'base system' }, ctx);
    expect(first.systemPrompt).toBe('base system\n\nLIFECYCLE SYSTEM');
    expect(first.message.content).toContain('<recall');
    bodies = (fetch as any).mock.calls.map((call: any[]) => JSON.parse(String(call[1]?.body || '{}')));
    expect(bodies.map((body: any) => body.event.name)).toEqual(['prompt.submit']);
    expect(bodies[0].normalized.session_id).toBe('sess-2');

    (fetch as any).mockClear();
    const second = await pi.events.before_agent_start({ prompt: 'again', systemPrompt: 'base system' }, ctx);
    // Pi rebuilds the base prompt each turn, so the fixed boot baseline must
    // persist instead of disappearing after the first user prompt.
    expect(second.systemPrompt).toBe('base system\n\nLIFECYCLE SYSTEM');
    expect(second.message.content).toContain('<recall');
    bodies = (fetch as any).mock.calls.map((call: any[]) => JSON.parse(String(call[1]?.body || '{}')));
    expect(bodies.map((body: any) => body.event.name)).toEqual(['prompt.submit']);
  });

  it('waits for a pending startup request before the first turn', async () => {
    const pi = makeMockPi();
    let resolveStartup!: (response: any) => void;
    vi.stubGlobal('fetch', vi.fn((url: string, init: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body?.event?.name === 'session.start') {
        return new Promise((resolve) => { resolveStartup = resolve; });
      }
      return Promise.resolve({
        ok: true, status: 200, statusText: 'OK',
        text: async () => JSON.stringify({ host_output: { mode: 'none', value: null } }),
      });
    }));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: true,
      recallEnabled: false,
      startupHealthcheck: false,
    });

    const ctx = { sessionManager: { getSessionId: () => 'sess-race' } };
    void pi.events.session_start({ reason: 'startup' }, ctx);
    const turn = pi.events.before_agent_start({ prompt: 'first', systemPrompt: 'base' }, ctx);
    resolveStartup({
      ok: true, status: 200, statusText: 'OK',
      text: async () => JSON.stringify({ host_output: { mode: 'return_value', value: { systemPromptAppend: 'RACE BASELINE' } } }),
    });

    expect((await turn)?.systemPrompt).toBe('base\n\nRACE BASELINE');
  });
});
