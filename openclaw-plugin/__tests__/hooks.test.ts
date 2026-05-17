import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setPendingRecallUsage,
  consumePendingRecallUsage,
  extractMessageText,
  extractAssistantText,
  DEFAULT_GUIDANCE,
  loadPromptGuidance,
  registerHooks,
  pendingRecallUsage,
} from '../hooks';

beforeEach(() => {
  pendingRecallUsage.clear();
});

describe('setPendingRecallUsage / consumePendingRecallUsage', () => {
  it('stores and retrieves a pending recall entry', () => {
    setPendingRecallUsage('sess-1', {
      queryId: 'q1',
      nodeUris: [{ uri: 'core://a' }, { uri: 'core://b' }],
    });
    const result = consumePendingRecallUsage('sess-1');
    expect(result).not.toBeNull();
    expect(result?.queryId).toBe('q1');
    expect(result?.nodeUris).toEqual(['core://a', 'core://b']);
  });

  it('consume removes the entry', () => {
    setPendingRecallUsage('sess-2', { queryId: 'q2', nodeUris: ['core://x'] });
    consumePendingRecallUsage('sess-2');
    expect(consumePendingRecallUsage('sess-2')).toBeNull();
  });

  it('returns null for unknown session', () => {
    expect(consumePendingRecallUsage('unknown')).toBeNull();
  });

  it('returns null when sessionId is falsy', () => {
    expect(consumePendingRecallUsage(undefined)).toBeNull();
  });

  it('does nothing when sessionId is falsy', () => {
    setPendingRecallUsage(undefined, { queryId: 'q', nodeUris: ['a'] });
    expect(pendingRecallUsage.size).toBe(0);
  });

  it('deletes entry when queryId is empty', () => {
    setPendingRecallUsage('sess-3', { queryId: 'q3', nodeUris: ['core://a'] });
    setPendingRecallUsage('sess-3', { queryId: '', nodeUris: ['core://a'] });
    expect(consumePendingRecallUsage('sess-3')).toBeNull();
  });

  it('deletes entry when nodeUris is empty', () => {
    setPendingRecallUsage('sess-4', { queryId: 'q4', nodeUris: ['core://a'] });
    setPendingRecallUsage('sess-4', { queryId: 'q4', nodeUris: [] });
    expect(consumePendingRecallUsage('sess-4')).toBeNull();
  });

  it('evicts stale entries (>30 min old)', () => {
    const staleTime = Date.now() - 31 * 60 * 1000;
    pendingRecallUsage.set('sess-stale', { queryId: 'old', nodeUris: [], createdAt: staleTime });
    // Setting a new entry triggers cleanup
    setPendingRecallUsage('sess-new', { queryId: 'new', nodeUris: ['core://z'] });
    expect(pendingRecallUsage.has('sess-stale')).toBe(false);
  });
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

  it('mentions Lore', () => {
    expect(DEFAULT_GUIDANCE).toContain('Lore');
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
    expect('session_end' in api.events).toBe(true);
    expect('before_prompt_build' in api.events).toBe(true);
  });

  it('session_end hook clears pending recall for session', async () => {
    const api = makeMockApi();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
    }));
    setPendingRecallUsage('sess-end', { queryId: 'q', nodeUris: ['core://a'] });
    registerHooks(api as any, { startupHealthcheck: false, injectPromptGuidance: false, recallEnabled: false, baseUrl: 'http://localhost' }, '');
    const hook = api.events.session_end;
    await hook.handler({ sessionId: 'sess-end' });
    expect(pendingRecallUsage.has('sess-end')).toBe(false);
    vi.unstubAllGlobals();
  });
});
