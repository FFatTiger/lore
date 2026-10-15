import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTools } from '../tools';
import { formatBootView } from '../formatters';

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
    skillsEnabled: true,
    ...overrides,
  };
}

const RECALL_GET_NODE_DESCRIPTION = 'Open a memory node. When opening a URI from a <recall>: copy the exact session_id and query_id from that <recall> tag if available; usage is attributed automatically by newer servers.';
const RECALL_SESSION_ID_DESCRIPTION = 'Recall session id from a <recall> tag if available.';
const RECALL_QUERY_ID_DESCRIPTION = 'Recall query id from a <recall> tag if available; usage is attributed automatically by newer servers.';

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
      'lore_skill_list',
      'lore_skill_search',
      'lore_skill_get',
      'lore_skill_create',
      'lore_skill_update',
      'lore_skill_delete',
      'lore_skill_status',
    ]);
    expect(pi.tools.lore_search.promptSnippet).toContain('Search Lore');
    expect(pi.tools.lore_get_node.promptGuidelines.join('\n')).toContain('lore_get_node');
  });

  it('omits skill tools when the server capability is disabled', () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg({ skillsEnabled: false }));
    expect(Object.keys(pi.tools).some((name) => name.startsWith('lore_skill_'))).toBe(false);
    expect(pi.tools.lore_search).toBeDefined();
  });

  it('create description explains semantic tree identity and date meaning', () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    expect(pi.tools.lore_create_node.description).toContain('living semantic tree');
    expect(pi.tools.lore_create_node.description).toContain('concept identity');
    expect(pi.tools.lore_create_node.description).toContain('event time');
    expect(pi.tools.lore_create_node.description).toContain('parent abstraction');
    expect(pi.tools.lore_create_node.parameters.properties.uri.description).toContain('concept identity');
    expect(pi.tools.lore_create_node.parameters.properties.uri.description).toContain('event time');
    expect(pi.tools.lore_create_node.description).not.toContain('Do not append dates');
    expect(pi.tools.lore_move_node.description).toContain('semantic memory tree');
    expect(pi.tools.lore_move_node.description).toContain('parent abstraction');
    expect(pi.tools.lore_move_node.description).toContain('conceptual home');
    expect(pi.tools.lore_move_node.parameters.properties.new_uri.description).toContain('parent abstraction');
  });

  it('boot formatter warns recent memories are not URI examples', () => {
    const text = formatBootView({ recent_memories: [{ uri: 'core://foo_2026_06_24', priority: 2 }] });
    expect(text).toContain('context hints');
    expect(text).toContain('event time');
  });

  it('lore_get_node exposes explicit recall identifiers without internal params', () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    const tool = pi.tools.lore_get_node;
    const props = tool.parameters.properties;

    expect(tool.description).toBe(RECALL_GET_NODE_DESCRIPTION);
    expect(props.session_id.description).toBe(RECALL_SESSION_ID_DESCRIPTION);
    expect(props.query_id.description).toBe(RECALL_QUERY_ID_DESCRIPTION);
    expect(props.session_id).toBeDefined();
    expect(props.query_id).toBeDefined();
    expect(props.__session_id).toBeUndefined();
    expect(props.__session_key).toBeUndefined();
  });



  it('lore_get_node records recall usage without session read tracking', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ node: { uri: 'core://agent', node_uuid: 'node-1', content: 'Agent' }, children: [] }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ ok: true }),
      }));

    const result = await pi.tools.lore_get_node.execute('tool-1', {
      uri: 'core://agent',
      session_id: 'sess-1',
      query_id: 'query-1',
    }, undefined, undefined, {});

    const urls = (fetch as any).mock.calls.map((call: any[]) => String(call[0]));
    expect(result.details.ok).toBe(true);
    expect(urls.some((url: string) => url.includes('/browse/recall/usage'))).toBe(true);
    expect(urls.some((url: string) => url.includes('/browse/session/read'))).toBe(false);
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

  it('search with wildcard and domain opens the domain root', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        node: { uri: 'project://', priority: 0, content: '' },
        children: [{ uri: 'project://lore_integration', priority: 1, content_snippet: 'Lore' }],
      }),
    }));

    const result = await pi.tools.lore_search.execute('tool-1', { query: '*', domain: 'project' }, undefined, undefined, {});
    expect(result.details.mode).toBe('domain_root');
    expect(result.content[0].text).toContain('Domain root: project://');
    expect((fetch as any).mock.calls[0][0]).toBe('http://host/api/browse/node?domain=project&path=&nav_only=true&client_type=pi');
  });

  it('create sends glossary in the node create request', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ uri: 'core://agent/profile', node_uuid: 'uuid-create' }),
    }));

    const result = await pi.tools.lore_create_node.execute('tool-1', {
      domain: 'core',
      parent_path: 'agent',
      title: 'profile',
      content: 'hello',
      priority: 2,
      glossary: ['memory'],
    }, undefined, undefined, {});

    expect(result.details.ok).toBe(true);
    expect((fetch as any).mock.calls).toHaveLength(1);
    expect(JSON.parse((fetch as any).mock.calls[0][1].body)).toMatchObject({ glossary: ['memory'] });
  });

  it('update sends glossary mutations in the node update request', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ uri: 'core://agent/profile', node_uuid: 'uuid-update' }),
    }));

    const result = await pi.tools.lore_update_node.execute('tool-1', {
      uri: 'core://agent/profile',
      content: 'updated',
      glossary: ['fresh'],
      glossary_add: ['memory'],
      glossary_remove: ['archive'],
    }, undefined, undefined, {});

    expect(result.details.ok).toBe(true);
    expect((fetch as any).mock.calls).toHaveLength(1);
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({
      content: 'updated',
      glossary_add: ['memory'],
      glossary_remove: ['archive'],
    });
    expect(body).not.toHaveProperty('glossary');
    expect(result.content[0].text).not.toContain('glossary=');
  });

  it('update exposes glossary mutations without full replacement', () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    const props = pi.tools.lore_update_node.parameters.properties;
    expect(props.glossary).toBeUndefined();
    expect(props.glossary_add).toBeDefined();
    expect(props.glossary_remove).toBeDefined();
    expect(pi.tools.lore_update_node.description).not.toContain('glossary fields');
  });

  it('lore_search advertises full instead of content_limit', () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    const props = pi.tools.lore_search.parameters.properties;
    expect(props.full).toBeDefined();
    expect(props.full.type).toBe('boolean');
    expect(props.full.description).toContain('full content of the top result');
    expect(props.content_limit).toBeUndefined();
    expect(props.limit.maximum).toBe(20);
    expect(props.limit.description).toContain('1-20');
  });

  it('lore_search sends full and the derived content_limit on POST', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ results: [], meta: {} }),
    }));

    await pi.tools.lore_search.execute('tool-1', { query: 'hello', full: true });
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body).toMatchObject({ full: true, content_limit: 1, limit: 5 });

    await pi.tools.lore_search.execute('tool-1', { query: 'hello' });
    const body2 = JSON.parse((fetch as any).mock.calls[1][1].body);
    expect(body2).toMatchObject({ full: false, content_limit: 0, limit: 5 });
  });

  it('lore_search GET fallback sends full and the derived content_limit', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg({ recallEnabled: false }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ results: [], meta: {} }),
    }));

    await pi.tools.lore_search.execute('tool-1', { query: 'hello', full: true });
    const [url, init] = (fetch as any).mock.calls[0];
    expect(init.method).toBe('GET');
    expect(String(url)).toContain('content_limit=1');
    expect(String(url)).toContain('full=true');
    expect(String(url)).toContain('limit=5');
  });

  it('lore_search formats results with disclosure, snippet, and closing cue', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        results: [
          {
            uri: 'project://a/b',
            score_display: 0.71,
            updated_at: '2026-10-15T10:43:56Z',
            disclosure: 'When working on search',
            snippet: 'best matching passage',
            matched_on: ['glossary', 'content'],
          },
          {
            uri: 'core://c',
            score: 0.5,
            content: 'Full\n   content with\nnewlines and spacing',
          },
        ],
        meta: {},
      }),
    }));

    const result = await pi.tools.lore_search.execute('tool-1', { query: 'hello' });
    expect(result.content[0].text).toBe([
      '1. project://a/b  (0.71 · 2026-10-15)',
      '   when: When working on search',
      '   > best matching passage',
      '2. core://c  (0.50)',
      '   > Full content with newlines and spacing',
      '',
      'Open a node with lore_get_node for full content.',
    ].join('\n'));
  });

  it('lore_search appends result 1 content after --- when full is requested', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        results: [
          { uri: 'project://a/b', score_display: 0.71, snippet: 'passage', content: 'FULL BODY' },
          { uri: 'core://c', score_display: 0.4 },
        ],
        meta: {},
      }),
    }));

    const result = await pi.tools.lore_search.execute('tool-1', { query: 'hello', full: true });
    expect(result.content[0].text).toBe([
      '1. project://a/b  (0.71)',
      '   > passage',
      '2. core://c  (0.40)',
      '',
      '---',
      '',
      'FULL BODY',
      '',
      'Open a node with lore_get_node for full content.',
    ].join('\n'));
  });

  it('lore_search truncates disclosure to 160 chars and passage to 300 chars', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    const longDisclosure = 'd'.repeat(200);
    const longContent = 'c'.repeat(400);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        results: [{ uri: 'core://c', disclosure: longDisclosure, content: longContent }],
        meta: {},
      }),
    }));

    const result = await pi.tools.lore_search.execute('tool-1', { query: 'hello' });
    expect(result.content[0].text).toContain(`   when: ${'d'.repeat(160)}`);
    expect(result.content[0].text).not.toContain('d'.repeat(161));
    expect(result.content[0].text).toContain(`   > ${'c'.repeat(300)}`);
  });

  it('lore_create_node caps glossary at 12 keywords', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    const props = pi.tools.lore_create_node.parameters.properties;
    expect(props.glossary.maxItems).toBe(12);
    expect(props.glossary.description).toContain('Terms a person would actually type');
    expect(props.glossary.description).toContain('ALL_CAPS test tokens');

    vi.stubGlobal('fetch', vi.fn());
    const result = await pi.tools.lore_create_node.execute('tool-1', {
      domain: 'core',
      parent_path: 'agent',
      title: 'profile',
      content: 'hello',
      priority: 2,
      glossary: Array.from({ length: 13 }, (_unused, i) => `kw-${i}`),
    });

    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain('12');
    expect((fetch as any).mock.calls).toHaveLength(0);
  });

  it('update schema offers targeted edits and discourages dated logs', () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    const props = pi.tools.lore_update_node.parameters.properties;
    expect(props.old_text).toBeDefined();
    expect(props.new_text).toBeDefined();
    expect(pi.tools.lore_update_node.description).toContain('targeted edits');
    expect(pi.tools.lore_update_node.description).toContain('instead of appending dated logs');
  });

  it('update applies a targeted old_text edit through GET then PUT', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ node: { uri: 'core://agent/profile', content: 'alpha beta gamma beta' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ uri: 'core://agent/profile', node_uuid: 'uuid-update' }),
      }));

    const result = await pi.tools.lore_update_node.execute('tool-1', {
      uri: 'core://agent/profile',
      old_text: 'beta gamma',
      new_text: 'BETA GAMMA',
      glossary_add: ['memory'],
    });

    expect(result.details.ok).toBe(true);
    expect((fetch as any).mock.calls).toHaveLength(2);
    expect((fetch as any).mock.calls[0][1].method).toBe('GET');
    expect((fetch as any).mock.calls[1][1].method).toBe('PUT');
    const body = JSON.parse((fetch as any).mock.calls[1][1].body);
    expect(body.content).toBe('alpha BETA GAMMA beta');
    expect(body.glossary_add).toEqual(['memory']);
    expect(body.old_text).toBeUndefined();
  });

  it('update rejects ambiguous or invalid targeted edits', async () => {
    const pi = makeMockPi();
    registerTools(pi as any, makePluginCfg());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ node: { uri: 'core://agent/profile', content: 'beta and beta' } }),
    }));

    const notFound = await pi.tools.lore_update_node.execute('tool-1', {
      uri: 'core://agent/profile',
      old_text: 'missing',
      new_text: 'x',
    });
    expect(notFound.details.ok).toBe(false);
    expect(notFound.content[0].text).toContain('old_text not found');

    const ambiguous = await pi.tools.lore_update_node.execute('tool-1', {
      uri: 'core://agent/profile',
      old_text: 'beta',
      new_text: 'x',
    });
    expect(ambiguous.details.ok).toBe(false);
    expect(ambiguous.content[0].text).toContain('old_text found 2 times');

    const empty = await pi.tools.lore_update_node.execute('tool-1', {
      uri: 'core://agent/profile',
      old_text: '',
      new_text: 'x',
    });
    expect(empty.details.ok).toBe(false);
    expect(empty.content[0].text).toContain('old_text must not be empty');

    const combined = await pi.tools.lore_update_node.execute('tool-1', {
      uri: 'core://agent/profile',
      old_text: 'beta',
      new_text: 'x',
      content: 'whole new body',
    });
    expect(combined.details.ok).toBe(false);
    expect(combined.content[0].text).toContain('not both');
    expect((fetch as any).mock.calls).toHaveLength(2);
  });
});
