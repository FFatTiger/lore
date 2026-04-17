import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTools } from '../tools';

function makeMockApi() {
  const tools: Record<string, any> = {};
  return {
    tools,
    registerTool(def: any) {
      tools[def.name] = def;
    },
  };
}

function makePluginCfg(overrides: any = {}) {
  return {
    baseUrl: 'http://localhost:18901',
    apiToken: '',
    timeoutMs: 5000,
    defaultDomain: 'core',
    recallEnabled: true,
    injectPromptGuidance: true,
    startupHealthcheck: false,
    ...overrides,
  };
}

describe('registerTools — tool registration', () => {
  it('registers all 11 tools', () => {
    const api = makeMockApi();
    const cfg = makePluginCfg();
    registerTools(api as any, cfg);
    const names = Object.keys(api.tools);
    expect(names).toHaveLength(11);
    expect(names).toContain('lore_status');
    expect(names).toContain('lore_boot');
    expect(names).toContain('lore_get_node');
    expect(names).toContain('lore_search');
    expect(names).toContain('lore_list_domains');
    expect(names).toContain('lore_create_node');
    expect(names).toContain('lore_update_node');
    expect(names).toContain('lore_delete_node');
    expect(names).toContain('lore_move_node');
    expect(names).toContain('lore_list_session_reads');
    expect(names).toContain('lore_clear_session_reads');
  });

  it('each tool has name, description, and execute', () => {
    const api = makeMockApi();
    registerTools(api as any, makePluginCfg());
    for (const tool of Object.values(api.tools)) {
      expect(typeof (tool as any).name).toBe('string');
      expect(typeof (tool as any).description).toBe('string');
      expect(typeof (tool as any).execute).toBe('function');
    }
  });
});

describe('tool parameter schemas', () => {
  let tools: Record<string, any>;
  beforeEach(() => {
    const api = makeMockApi();
    registerTools(api as any, makePluginCfg());
    tools = api.tools;
  });

  it('lore_get_node requires uri', () => {
    expect(tools.lore_get_node.parameters.required).toContain('uri');
  });

  it('lore_search exposes content_limit', () => {
    expect(tools.lore_search.parameters.properties.content_limit).toBeDefined();
  });

  it('lore_create_node requires content, priority, glossary', () => {
    const req = tools.lore_create_node.parameters.required;
    expect(req).toContain('content');
    expect(req).toContain('priority');
    expect(req).toContain('glossary');
  });

  it('lore_update_node requires uri', () => {
    expect(tools.lore_update_node.parameters.required).toContain('uri');
  });

  it('lore_delete_node requires uri', () => {
    expect(tools.lore_delete_node.parameters.required).toContain('uri');
  });

  it('lore_move_node requires old_uri and new_uri', () => {
    const req = tools.lore_move_node.parameters.required;
    expect(req).toContain('old_uri');
    expect(req).toContain('new_uri');
  });

  it('lore_list_session_reads requires session_id', () => {
    expect(tools.lore_list_session_reads.parameters.required).toContain('session_id');
  });

  it('lore_clear_session_reads requires session_id', () => {
    expect(tools.lore_clear_session_reads.parameters.required).toContain('session_id');
  });

  it('lore_status has no required params', () => {
    expect(tools.lore_status.parameters.required).toBeUndefined();
  });

  it('lore_boot has no required params', () => {
    expect(tools.lore_boot.parameters.required).toBeUndefined();
  });

  it('lore_list_domains has no required params', () => {
    expect(tools.lore_list_domains.parameters.required).toBeUndefined();
  });
});

describe('tool response formatting', () => {
  let tools: Record<string, any>;

  beforeEach(() => {
    const api = makeMockApi();
    registerTools(api as any, makePluginCfg());
    tools = api.tools;
    vi.stubGlobal('fetch', vi.fn());
  });

  function mockFetch(body: any, status = 200) {
    const text = JSON.stringify(body);
    (fetch as any).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: async () => text,
    });
  }

  it('lore_status returns ok=true on success', async () => {
    mockFetch({ status: 'ok' });
    const result = await tools.lore_status.execute();
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Lore online');
  });

  it('lore_status returns ok=false on failure', async () => {
    (fetch as any).mockRejectedValue(new Error('Connection refused'));
    const result = await tools.lore_status.execute();
    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain('Lore offline');
  });

  it('lore_boot returns formatted fixed boot view on success', async () => {
    mockFetch({
      loaded: 1,
      total: 3,
      failed: [],
      core_memories: [{
        uri: 'core://agent',
        priority: 0,
        content: 'test',
        boot_role_label: 'workflow constraints',
      }],
      recent_memories: [],
    });
    const result = await tools.lore_boot.execute();
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Fixed boot baseline');
    expect(result.content[0].text).toContain('workflow constraints');
  });

  it('lore_boot returns ok=false on failure', async () => {
    (fetch as any).mockRejectedValue(new Error('timeout'));
    const result = await tools.lore_boot.execute();
    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain('boot failed');
  });

  it('lore_list_domains formats domain list', async () => {
    mockFetch([{ domain: 'core', root_count: 5 }, { domain: 'project', root_count: 3 }]);
    const result = await tools.lore_list_domains.execute();
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('core');
    expect(result.content[0].text).toContain('project');
  });

  it('lore_list_domains shows empty message when no domains', async () => {
    mockFetch([]);
    const result = await tools.lore_list_domains.execute();
    expect(result.content[0].text).toContain('No domains found');
  });

  it('lore_delete_node returns deleted path on success', async () => {
    mockFetch({ deleted: true });
    const result = await tools.lore_delete_node.execute(null, { uri: 'core://test/node' });
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Deleted core://test/node');
  });

  it('lore_move_node returns moved message on success', async () => {
    mockFetch({ ok: true });
    const result = await tools.lore_move_node.execute(null, { old_uri: 'core://original', new_uri: 'core://moved' });
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Moved core://original');
  });

  it('lore_create_node uses top-level receipt fields for glossary mutations', async () => {
    (fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ uri: 'core://agent/profile', node_uuid: 'uuid-create' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ ok: true }),
      });

    const result = await tools.lore_create_node.execute(null, {
      domain: 'core',
      parent_path: 'agent',
      title: 'profile',
      content: 'hello',
      priority: 2,
      glossary: ['memory'],
    });

    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Created core://agent/profile');
    expect((fetch as any).mock.calls).toHaveLength(2);
    expect(JSON.parse((fetch as any).mock.calls[1][1].body)).toEqual({ keyword: 'memory', node_uuid: 'uuid-create' });
  });

  it('lore_update_node uses canonical receipt fields without refetching the node', async () => {
    (fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ uri: 'core://agent/profile-renamed', node_uuid: 'uuid-update' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ ok: true }),
      });

    const result = await tools.lore_update_node.execute(null, {
      uri: 'core://agent/profile',
      content: 'updated',
      glossary_add: ['memory'],
    });

    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Updated core://agent/profile-renamed');
    expect((fetch as any).mock.calls).toHaveLength(2);
    expect((fetch as any).mock.calls.map((call: any[]) => call[1].method)).not.toContain('GET');
    expect(JSON.parse((fetch as any).mock.calls[1][1].body)).toEqual({ keyword: 'memory', node_uuid: 'uuid-update' });
  });

  it('lore_delete_node prefers canonical delete receipts', async () => {
    mockFetch({ deleted_uri: 'core://legacy/node', uri: 'core://canonical/node' });
    const result = await tools.lore_delete_node.execute(null, { uri: 'core://test/node' });
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Deleted core://legacy/node (canonical: core://canonical/node)');
  });

  it('lore_move_node prefers canonical move receipts', async () => {
    mockFetch({ old_uri: 'core://original', new_uri: 'core://canonical/moved' });
    const result = await tools.lore_move_node.execute(null, { old_uri: 'core://original', new_uri: 'core://moved' });
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('Moved core://original → core://canonical/moved');
  });

  it('lore_list_session_reads shows empty message for no reads', async () => {
    mockFetch([]);
    const result = await tools.lore_list_session_reads.execute(null, { session_id: 'sess-1' });
    expect(result.content[0].text).toContain('No read nodes tracked');
  });

  it('lore_clear_session_reads confirms cleared session', async () => {
    mockFetch({ ok: true });
    const result = await tools.lore_clear_session_reads.execute(null, { session_id: 'sess-1' });
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toContain('sess-1');
  });

  it('lore_search falls back to GET when recallEnabled=false', async () => {
    const api2 = makeMockApi();
    registerTools(api2 as any, makePluginCfg({ recallEnabled: false }));
    mockFetch({ results: [] });
    const result = await api2.tools.lore_search.execute(null, { query: 'hello', content_limit: 3 });
    // GET path: no results case
    expect(result.content[0].text).toContain('No matching memories found');
    const [callArgs] = (fetch as any).mock.calls;
    expect(callArgs[1].method).toBe('GET');
    expect(String(callArgs[0])).toContain('content_limit=3');
  });

  it('lore_search uses POST when recallEnabled=true', async () => {
    mockFetch({ results: [] });
    const result = await tools.lore_search.execute(null, { query: 'hello', content_limit: 7 });
    expect(result.content[0].text).toContain('No matching memories found');
    const [callArgs] = (fetch as any).mock.calls;
    expect(callArgs[1].method).toBe('POST');
    expect(JSON.parse(callArgs[1].body)).toMatchObject({ content_limit: 7 });
  });
});
