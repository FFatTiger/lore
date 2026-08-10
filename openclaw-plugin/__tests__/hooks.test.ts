import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractMessageText,
  extractAssistantText,
  registerHooks,
} from '../hooks';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('extractMessageText', () => {
  it('returns empty string for null', () => {
    expect(extractMessageText(null)).toBe('');
  });

  it('returns empty string for non-object', () => {
    expect(extractMessageText('string')).toBe('');
  });

  it('returns string content directly', () => {
    expect(extractMessageText({ content: '  hello  ' })).toBe('hello');
  });

  it('extracts text blocks from array content', () => {
    const msg = {
      content: [
        { type: 'text', text: 'part one' },
        { type: 'tool_use', input: {} },
        { type: 'text', text: 'part two' },
      ],
    };
    expect(extractMessageText(msg)).toBe('part one\npart two');
  });

  it('returns empty when content is non-array non-string', () => {
    expect(extractMessageText({ content: 42 })).toBe('');
  });
});

describe('extractAssistantText', () => {
  it('returns empty for empty array', () => {
    expect(extractAssistantText([])).toBe('');
  });

  it('returns empty for non-array', () => {
    expect(extractAssistantText(null)).toBe('');
  });

  it('picks the last assistant message', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'follow-up' },
      { role: 'assistant', content: 'second reply' },
    ];
    expect(extractAssistantText(messages)).toBe('second reply');
  });

  it('returns empty when no assistant message', () => {
    expect(extractAssistantText([{ role: 'user', content: 'hi' }])).toBe('');
  });
});

describe('registerHooks', () => {
  function makeMockApi() {
    const hooks: any[] = [];
    const gatewayMethods: Record<string, any> = {};
    const events: Record<string, any> = {};
    return {
      hooks,
      gatewayMethods,
      events,
      registerGatewayMethod(name: string, handler: any) {
        gatewayMethods[name] = handler;
      },
      registerHook(event: string, handler: any, meta: any) {
        hooks.push({ event, handler, meta });
      },
      on(event: string, handler: any, options?: any) {
        events[event] = { handler, options };
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    };
  }

  it('registers all expected hooks and gateway method', () => {
    const api = makeMockApi();
    registerHooks(api as any, { startupHealthcheck: false, injectPromptGuidance: false, recallEnabled: false });
    expect('lore.status' in api.gatewayMethods).toBe(true);
    expect('gateway_start' in api.events).toBe(true);
    expect('before_tool_call' in api.events).toBe(false);
    expect('session_start' in api.events).toBe(true);
    expect('session_end' in api.events).toBe(true);
    expect('before_prompt_build' in api.events).toBe(true);
  });


  it('deduplicates repeated session starts until the session ends', async () => {
    const api = makeMockApi();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body?.event?.name === 'session.start') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            host_output: { mode: 'return_value', value: { appendSystemContext: 'ONCE' } },
          }),
        };
      }
      return { ok: true, status: 200, text: async () => '{}' };
    }));

    registerHooks(api as any, { startupHealthcheck: false, injectPromptGuidance: true, recallEnabled: false, baseUrl: 'http://localhost' });
    const event = { sessionId: 'sess-repeat' };
    const ctx = { sessionId: 'sess-repeat' };
    await api.events.session_start.handler(event, ctx);
    await api.events.session_start.handler(event, ctx);
    expect(fetch).toHaveBeenCalledTimes(1);

    expect((await api.events.before_prompt_build.handler({ prompt: '', messages: [] }, ctx))?.appendSystemContext).toBe('ONCE');
    await api.events.session_start.handler(event, ctx);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await api.events.before_prompt_build.handler({ prompt: '', messages: [] }, ctx))?.appendSystemContext).toBeUndefined();

    await api.events.session_end.handler({ sessionId: 'sess-repeat', reason: 'reset' }, ctx);
    await api.events.session_start.handler(event, ctx);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not restore startup context after a session ends during an in-flight start', async () => {
    const api = makeMockApi();
    let resolveStart!: (response: any) => void;
    vi.stubGlobal('fetch', vi.fn((url: string, init: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (String(url).includes('/lifecycle/event') && body?.event?.name === 'session.start') {
        return new Promise((resolve) => { resolveStart = resolve; });
      }
      return Promise.resolve({ ok: true, status: 200, text: async () => '{}' });
    }));

    registerHooks(api as any, { startupHealthcheck: false, injectPromptGuidance: true, recallEnabled: false, baseUrl: 'http://localhost' });
    const starting = api.events.session_start.handler(
      { sessionId: 'sess-ended' },
      { sessionId: 'sess-ended' },
    );
    await api.events.session_end.handler(
      { sessionId: 'sess-ended', reason: 'reset' },
      { sessionId: 'sess-ended' },
    );
    resolveStart({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        host_output: { mode: 'return_value', value: { appendSystemContext: 'STALE SYSTEM' } },
      }),
    });
    await starting;

    const result = await api.events.before_prompt_build.handler(
      { prompt: 'after reset', messages: [] },
      { sessionId: 'sess-ended', runId: 'run-after-reset' },
    );
    expect(result?.appendSystemContext).toBeUndefined();
  });

  it('session_start caches startup context for the first prompt build', async () => {
    const api = makeMockApi();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (String(url).includes('/lifecycle/event')) {
        const body = JSON.parse(String(init?.body || '{}'));
        if (body?.event?.name === 'session.start') {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              host_output: { mode: 'return_value', value: { appendSystemContext: 'LIFECYCLE SYSTEM' } },
            }),
          };
        }
        if (body?.event?.name === 'prompt.submit') {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              host_output: {
                mode: 'return_value',
                value: { prependContext: '<recall session_id="sess-1" query_id="q1">\n0.70 | core://project\n</recall>' },
              },
            }),
          };
        }
      }
      return { ok: true, status: 200, text: async () => '{}' };
    }));

    registerHooks(api as any, { startupHealthcheck: false, injectPromptGuidance: true, recallEnabled: true, baseUrl: 'http://localhost' });
    await api.events.session_start.handler({ sessionId: 'sess-1', sessionKey: 'agent:main' }, { sessionId: 'sess-1', sessionKey: 'agent:main' });

    (fetch as any).mockClear();
    const first = await api.events.before_prompt_build.handler(
      { prompt: 'what now?', messages: [] },
      { sessionId: 'sess-1', sessionKey: 'agent:main', runId: 'run-1' },
    );
    expect(first.appendSystemContext).toBe('LIFECYCLE SYSTEM');
    expect(first.prependContext).toContain('core://project');
    let bodies = (fetch as any).mock.calls.map((call: any[]) => JSON.parse(String(call[1]?.body || '{}')));
    expect(bodies.map((body: any) => body.event.name)).toEqual(['prompt.submit']);
    expect(bodies[0].normalized.session_id).toBe('sess-1');
    expect(bodies[0].features.memory_recall).toBe(true);

    (fetch as any).mockClear();
    const second = await api.events.before_prompt_build.handler(
      { prompt: 'again', messages: [] },
      { sessionId: 'sess-1', sessionKey: 'agent:main', runId: 'run-2' },
    );
    expect(second.appendSystemContext).toBeUndefined();
    expect(second.prependContext).toContain('core://project');
    bodies = (fetch as any).mock.calls.map((call: any[]) => JSON.parse(String(call[1]?.body || '{}')));
    expect(bodies.map((body: any) => body.event.name)).toEqual(['prompt.submit']);
  });

  it('still runs prompt.submit for skill discovery when recall is disabled', async () => {
    const api = makeMockApi();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (String(url).includes('/lifecycle/event')) {
        const body = JSON.parse(String(init?.body || '{}'));
        expect(body.event.name).toBe('prompt.submit');
        expect(body.features.memory_recall).toBe(false);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            host_output: { mode: 'return_value', value: {} },
            skill_candidates: [{
              skill_id: 's1',
              name: 'skill-one',
              version: 2,
              description: 'desc',
            }],
          }),
        };
      }
      return { ok: true, status: 200, text: async () => '{}' };
    }));

    registerHooks(api as any, {
      startupHealthcheck: false,
      injectPromptGuidance: true,
      recallEnabled: false,
      baseUrl: 'http://localhost',
    });
    const result = await api.events.before_prompt_build.handler(
      { prompt: 'find a skill', messages: [] },
      { sessionId: 'sess-skills' },
    );
    expect(result.prependContext).toContain('<lore-skills>');
    expect(result.prependContext).toContain('skill_id: s1');
    expect(result.prependContext).toContain('lore_skill_get');
  });
});
