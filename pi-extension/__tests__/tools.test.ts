import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTools } from '../tools';

function makeMockPi() {
  const tools: Record<string, any> = {};
  return {
    tools,
    registerTool(tool: any) {
      tools[tool.name] = tool;
    },
  };
}

function makePluginCfg(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: 'http://host',
    apiToken: '',
    timeoutMs: 1000,
    defaultDomain: 'core',
    recallEnabled: true,
    ...overrides,
  };
}

describe('Pi extension tools', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the Lore tool set with Pi', () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    expect(Object.keys(pi.tools)).toEqual([
      'lore_status',
      'lore_boot',
      'lore_get_node',
      'lore_search',
      'lore_list_domains',
      'lore_create_node',
      'lore_update_node',
      'lore_delete_node',
      'lore_move_node',
      'lore_list_session_reads',
      'lore_clear_session_reads',
    ]);
    expect(pi.tools.lore_search.promptSnippet).toContain('Search Lore');
    expect(pi.tools.lore_get_node.promptGuidelines.join('\n')).toContain('lore_get_node');
  });

  it('status tool calls Lore with client_type=pi', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ status: 'ok' }),
    }));

    const result = await pi.tools.lore_status.execute('tool-1', {}, undefined, undefined, {});
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Lore online');
    expect((fetch as any).mock.calls[0][0]).toBe('http://host/api/health?client_type=pi');
  });
});
