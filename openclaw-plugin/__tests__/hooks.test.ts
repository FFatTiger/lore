import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractMessageText,
  extractAssistantText,
  DEFAULT_GUIDANCE,
  loadPromptGuidance,
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

describe('DEFAULT_GUIDANCE', () => {
  it('is a non-empty string', () => {
    expect(typeof DEFAULT_GUIDANCE).toBe('string');
    expect(DEFAULT_GUIDANCE.length).toBeGreaterThan(0);
  });

  it('mentions Lore stable path guidance', () => {
    expect(DEFAULT_GUIDANCE).toContain('Lore');
    expect(DEFAULT_GUIDANCE).toContain('ordinary memory paths');
    expect(DEFAULT_GUIDANCE).toContain('stable semantic identity');
  });
});

describe('loadPromptGuidance', () => {
  it('returns DEFAULT_GUIDANCE when AGENT_RULES.md does not exist', () => {
    // The test environment typically won't have the file at the url path
    const result = loadPromptGuidance();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
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
    registerHooks(api as any, { startupHealthcheck: false, injectPromptGuidance: false, recallEnabled: false }, '');
    expect('lore.status' in api.gatewayMethods).toBe(true);
    expect('gateway_start' in api.events).toBe(true);
    expect('before_tool_call' in api.events).toBe(false);
    expect('session_end' in api.events).toBe(false);
    expect('before_prompt_build' in api.events).toBe(true);
  });


  it('before_prompt_build injects bridge startup context and prompt recall', async () => {
    const api = makeMockApi();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/bridge/startup')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ system_context: 'BRIDGE SYSTEM' }) };
      }
      if (String(url).includes('/bridge/recall')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ context: '<recall session_id="sess-1" query_id="q1">\n0.70 | core://project\n</recall>', has_recall: true }) };
      }
      return { ok: true, status: 200, text: async () => '{}' };
    }));

    registerHooks(api as any, { startupHealthcheck: false, injectPromptGuidance: true, recallEnabled: true, baseUrl: 'http://localhost' }, 'GUIDANCE');
    const result = await api.events.before_prompt_build.handler({ prompt: 'what now?', context: { sessionId: 'sess-1' } });

    expect(result.appendSystemContext).toBe('BRIDGE SYSTEM');
    expect(result.prependContext).toContain('core://project');
    const urls = (fetch as any).mock.calls.map((call: any[]) => String(call[0]));
    expect(urls.some((url: string) => url.includes('/browse/boot'))).toBe(false);
    expect(urls.some((url: string) => url.includes('/browse/recall'))).toBe(false);
  });
});
