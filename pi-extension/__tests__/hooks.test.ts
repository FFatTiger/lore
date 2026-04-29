import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GUIDANCE,
  clearSessionReads,
  extractMessageText,
  fetchRecallBlock,
  loadPromptGuidance,
  pendingRecallUsage,
  registerHooks,
  setPendingRecallUsage,
} from '../hooks';

beforeEach(() => {
  pendingRecallUsage.clear();
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

  it('stores pending recall usage by session', () => {
    setPendingRecallUsage('sess-1', { queryId: 'q1', nodeUris: [{ uri: 'core://a' }] });
    expect(pendingRecallUsage.get('sess-1')?.queryId).toBe('q1');
    expect(pendingRecallUsage.get('sess-1')?.nodeUris).toEqual(['core://a']);
  });

  it('fetches recall blocks with Pi client type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        event_log: { query_id: 'qid-1' },
        items: [{ uri: 'core://agent/pi', score: 0.8, matched_on: ['dense'] }],
      }),
    }));

    const result = await fetchRecallBlock({ baseUrl: 'http://host', timeoutMs: 1000, recallEnabled: true }, 'question', 'sess-1');
    expect(result?.block).toContain('<recall');
    expect(result?.block).toContain('core://agent/pi');
    expect((fetch as any).mock.calls[0][0]).toBe('http://host/api/browse/recall?client_type=pi');
  });

  it('registers Pi lifecycle hooks', () => {
    const pi = makeMockPi();
    registerHooks(pi as any, { injectPromptGuidance: false, recallEnabled: false, startupHealthcheck: false }, '');
    expect(pi.events.session_start).toBeTypeOf('function');
    expect(pi.events.before_agent_start).toBeTypeOf('function');
    expect(pi.events.tool_call).toBeTypeOf('function');
    expect(pi.events.session_shutdown).toBeTypeOf('function');
  });

  it('before_agent_start injects guidance and recall as a message', async () => {
    const pi = makeMockPi();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({
          core_memories: [{ uri: 'core://agent/pi', content: 'Pi runtime rules', priority: 1 }],
          recent_memories: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({
          event_log: { query_id: 'qid-2' },
          items: [{ uri: 'core://project', score: 0.7, matched_on: ['lexical'] }],
        }),
      }));

    registerHooks(pi as any, {
      baseUrl: 'http://host',
      timeoutMs: 1000,
      injectPromptGuidance: true,
      recallEnabled: true,
      startupHealthcheck: false,
    }, 'static guidance');

    const result = await pi.events.before_agent_start({ prompt: 'what now?', systemPrompt: 'base system' }, { sessionManager: { sessionId: 'sess-2' } });
    expect(result.systemPrompt).toContain('static guidance');
    expect(result.systemPrompt).toContain('Pi runtime rules');
    expect(result.message.content).toContain('<recall');
    expect(result.message.content).toContain('core://project');
  });

  it('clears session reads through Lore API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{}',
    }));

    await clearSessionReads({ baseUrl: 'http://host', timeoutMs: 1000 }, 'sess-clear');
    expect((fetch as any).mock.calls[0][0]).toContain('/api/browse/session/read?session_id=sess-clear&client_type=pi');
  });

  it('loads prompt guidance text', () => {
    expect(loadPromptGuidance()).toContain('Lore');
    expect(DEFAULT_GUIDANCE).toContain('core://agent/pi');
  });
});
