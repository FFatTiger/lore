import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../server/auth', () => {
  const clientTypes = new Set(['claudecode', 'openclaw', 'hermes', 'codex', 'pi', 'opencode', 'zcode', 'mcp', 'admin']);
  return {
    requireBearerAuth: vi.fn(),
    normalizeClientType: vi.fn((value: string | null) => {
      const normalized = String(value || '').trim().toLowerCase();
      return clientTypes.has(normalized) ? normalized : null;
    }),
  };
});
vi.mock('../../../../../server/lore/memory/boot', () => ({
  bootView: vi.fn(),
}));
vi.mock('../../../../../server/lore/recall/recall', () => ({
  recallMemories: vi.fn(),
}));
vi.mock('../../../../../server/lore/config/settings', () => ({
  getSettings: vi.fn(),
}));

import { requireBearerAuth } from '../../../../../server/auth';
import { getSettings } from '../../../../../server/lore/config/settings';
import { bootView } from '../../../../../server/lore/memory/boot';
import { recallMemories } from '../../../../../server/lore/recall/recall';
import { lifecycleStartupGate } from '../../../../../server/lore/lifecycle/startupGate';
import * as lifecycleRoute from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockGetSettings = vi.mocked(getSettings);
const mockBootView = vi.mocked(bootView);
const mockRecallMemories = vi.mocked(recallMemories);

describe('lifecycle event route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lifecycleStartupGate.clear();
    mockRequireBearerAuth.mockReturnValue(null);
    mockGetSettings.mockResolvedValue({
      'lifecycle.guidance.enabled': true,
      'lifecycle.guidance.global': 'SERVER GUIDANCE',
      'lifecycle.boot.preamble': 'BOOT PREAMBLE',
      'lifecycle.startup_recall.preamble': 'STARTUP RECALL PREAMBLE',
      'lifecycle.prompt_recall.preamble': 'PROMPT RECALL PREAMBLE',
    });
    mockBootView.mockResolvedValue({
      loaded: 4,
      total: 4,
      failed: [],
      core_memories: [
        { uri: 'core://agent', content: 'Agent rules', priority: 1, boot_role_label: 'workflow constraints' },
        { uri: 'core://agent/codex', content: 'Codex rules', priority: 0, boot_role_label: 'codex runtime constraints', scope: 'client', client_type: 'codex' },
      ],
      recent_memories: [],
    } as any);
    mockRecallMemories.mockResolvedValue({
      items: [{ uri: 'project://lore', score_display: 0.82, cues: ['bridge'] }],
      event_log: { query_id: 'q-start' },
    } as any);
  });

  it('returns host-ready Codex startup output', async () => {
    const request = new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 'lore.lifecycle.v1',
        runtime: { runtime_id: 'codex', runtime_family: 'codex' },
        event: { name: 'session.start', native_name: 'SessionStart' },
        normalized: { session_id: 'sess-1' },
        project: { dir_name: 'lore', repo_name: 'lore' },
      }),
    }) as any;

    const response = await lifecycleRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.host_output.mode).toBe('stdout_json');
    expect(body.host_output.value.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(body.host_output.value.hookSpecificOutput.additionalContext).toContain('SERVER GUIDANCE');
    expect(body.host_output.value.hookSpecificOutput.additionalContext).toContain('BOOT PREAMBLE');
    expect(body.host_output.value.hookSpecificOutput.additionalContext).toContain('core://agent/codex');
    expect(body.host_output.value.hookSpecificOutput.additionalContext).toContain('STARTUP RECALL PREAMBLE');
    expect(body.host_output.value.hookSpecificOutput.additionalContext).toContain('<recall session_id="boot" query_id="q-start">');
    expect(body.meta.queries).toEqual(['codex', 'lore']);
    expect(mockBootView).toHaveBeenCalledWith({ client_type: 'codex' });
  });

  it('returns host-ready ZCode startup and prompt output', async () => {
    mockBootView.mockResolvedValueOnce({
      loaded: 4,
      total: 4,
      failed: [],
      core_memories: [
        { uri: 'core://agent', content: 'Agent rules', priority: 1, boot_role_label: 'workflow constraints' },
        { uri: 'core://agent/zcode', content: 'ZCode rules', priority: 0, boot_role_label: 'zcode runtime constraints', scope: 'client', client_type: 'zcode' },
      ],
      recent_memories: [],
    } as any);

    const startupResponse = await lifecycleRoute.POST(new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 'lore.lifecycle.v1',
        runtime: { runtime_id: 'zcode', runtime_family: 'zcode' },
        event: { name: 'session.start', native_name: 'SessionStart' },
        normalized: { session_id: 'z-sess' },
        project: { dir_name: 'lore', repo_name: 'lore' },
      }),
    }) as any);
    const startup = await startupResponse.json();

    expect(startup.host_output.mode).toBe('stdout_json');
    expect(startup.host_output.value.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(startup.host_output.value.hookSpecificOutput.additionalContext).toContain('core://agent/zcode');
    expect(startup.host_output.value.hookSpecificOutput.additionalContext).not.toContain('core://agent/codex');
    expect(startup.host_output.value.hookSpecificOutput.additionalContext).not.toContain('core://agent/pi');
    expect(mockBootView).toHaveBeenCalledWith({ client_type: 'zcode' });

    mockRecallMemories.mockResolvedValueOnce({
      items: [{ uri: 'core://agent/zcode', score_display: 0.77, cues: ['hooks'] }],
      event_log: { query_id: 'q-zcode' },
    } as any);
    const promptResponse = await lifecycleRoute.POST(new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'zcode', runtime_family: 'zcode' },
        event: { name: 'prompt.submit', native_name: 'UserPromptSubmit' },
        normalized: { session_id: 'z-sess', prompt: 'ZCode hooks' },
      }),
    }) as any);
    const prompt = await promptResponse.json();

    expect(prompt.host_output.mode).toBe('stdout_json');
    expect(prompt.host_output.value.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(prompt.host_output.value.hookSpecificOutput.additionalContext).toContain('PROMPT RECALL PREAMBLE');
    expect(prompt.host_output.value.hookSpecificOutput.additionalContext).toContain('core://agent/zcode');
    expect(prompt.query_id).toBe('q-zcode');
  });

  it('returns host-ready Claude prompt output', async () => {
    mockRecallMemories.mockResolvedValueOnce({
      items: [{ uri: 'core://agent', score_display: 0.8, cues: ['agent'] }],
      event_log: { query_id: 'q-prompt' },
    } as any);

    const request = new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'claudecode', runtime_family: 'claudecode' },
        event: { name: 'prompt.submit', native_name: 'UserPromptSubmit' },
        normalized: { session_id: 'sess-1', prompt: 'remember agent rules' },
      }),
    }) as any;

    const response = await lifecycleRoute.POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.host_output.mode).toBe('stdout_text');
    expect(body.host_output.value).toContain('PROMPT RECALL PREAMBLE');
    expect(body.host_output.value).toContain('<recall session_id="sess-1" query_id="q-prompt">');
    expect(body.host_output.value).toContain('0.80 | core://agent | agent');
    expect(body.query_id).toBe('q-prompt');
    expect(body.node_uris).toEqual(['core://agent']);
    expect(mockRecallMemories).toHaveBeenCalledWith(expect.objectContaining({ query: 'remember agent rules', session_id: 'sess-1' }), { clientType: 'claudecode' });
  });

  it('returns host-ready OpenCode startup and prompt output with exact recall phases', async () => {
    mockBootView.mockResolvedValueOnce({
      loaded: 4,
      total: 4,
      failed: [],
      core_memories: [
        { uri: 'core://agent', content: 'Agent rules', priority: 1, boot_role_label: 'workflow constraints' },
        { uri: 'core://agent/opencode', content: 'OpenCode rules', priority: 0, boot_role_label: 'opencode runtime constraints', scope: 'client', client_type: 'opencode' },
      ],
      recent_memories: [],
    } as any);
    mockRecallMemories.mockResolvedValueOnce({
      items: [{ uri: 'project://runtime/opencode', score_display: 0.91, cues: ['OpenCode'] }],
      event_log: { query_id: 'q-start' },
    } as any);

    const startupResponse = await lifecycleRoute.POST(new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol_version: 'lore.lifecycle.v1',
        runtime: { runtime_id: 'opencode', runtime_family: 'opencode' },
        event: { name: 'session.start', native_name: 'session.created' },
        normalized: { session_id: 'oc-session' },
        project: { dir_name: 'lore', repo_name: 'lore' },
      }),
    }) as any);
    const startup = await startupResponse.json();

    expect(startup.host_output).toEqual({
      mode: 'return_value',
      value: { systemContext: expect.any(String) },
    });
    expect(startup.host_output.value.systemContext).toContain('core://agent/opencode');
    expect(startup.host_output.value.systemContext).toContain(
      '<recall session_id="oc-session" query_id="q-start" phase="startup">',
    );
    expect(mockBootView).toHaveBeenCalledWith({ client_type: 'opencode' });
    expect(mockRecallMemories).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'oc-session' }),
      { clientType: 'opencode' },
    );

    mockRecallMemories.mockResolvedValueOnce({
      items: [{ uri: 'core://agent/opencode', score_display: 0.88, cues: ['runtime'] }],
      event_log: { query_id: 'q-prompt' },
    } as any);
    const promptResponse = await lifecycleRoute.POST(new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'opencode', runtime_family: 'opencode' },
        event: { name: 'prompt.submit', native_name: 'chat.message' },
        normalized: { session_id: 'oc-session', prompt: 'OpenCode hooks' },
      }),
    }) as any);
    const prompt = await promptResponse.json();

    expect(prompt.host_output).toEqual({
      mode: 'return_value',
      value: { promptContext: expect.any(String) },
    });
    expect(prompt.host_output.value.promptContext).toContain('PROMPT RECALL PREAMBLE');
    expect(prompt.host_output.value.promptContext).toContain(
      '<recall session_id="oc-session" query_id="q-prompt" phase="prompt">',
    );
    expect(prompt.query_id).toBe('q-prompt');
    expect(prompt.node_uris).toEqual(['core://agent/opencode']);
  });

  it('gates duplicate OpenCode startup Recall without removing current Boot output', async () => {
    mockBootView.mockResolvedValue({
      loaded: 4,
      total: 4,
      failed: [],
      core_memories: [
        { uri: 'core://agent', content: 'Agent rules', priority: 1 },
        { uri: 'core://agent/opencode', content: 'OpenCode rules', priority: 0, scope: 'client', client_type: 'opencode' },
      ],
      recent_memories: [],
    } as any);
    mockRecallMemories.mockResolvedValue({
      items: [{ uri: 'project://runtime/opencode', score_display: 0.91, cues: ['OpenCode'] }],
      event_log: { query_id: 'q-start' },
    } as any);
    const makeRequest = () => new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'opencode', runtime_family: 'opencode' },
        event: { name: 'session.start', native_name: 'session.created' },
        normalized: { session_id: 'oc-gated-session' },
        project: { dir_name: 'lore', repo_name: 'lore' },
      }),
    }) as any;

    const first = await (await lifecycleRoute.POST(makeRequest())).json();
    const recallCallsAfterFirst = mockRecallMemories.mock.calls.length;
    const second = await (await lifecycleRoute.POST(makeRequest())).json();

    expect(first.host_output.value.systemContext).toContain('core://agent/opencode');
    expect(first.host_output.value.systemContext).toContain('STARTUP RECALL PREAMBLE');
    expect(second.host_output.value.systemContext).toContain('SERVER GUIDANCE');
    expect(second.host_output.value.systemContext).toContain('core://agent/opencode');
    expect(second.host_output.value.systemContext).not.toContain('STARTUP RECALL PREAMBLE');
    expect(second.meta.startup_gated).toBe(true);
    expect(mockRecallMemories).toHaveBeenCalledTimes(recallCallsAfterFirst);
  });

  it('no-ops unknown runtimes and empty prompts', async () => {
    const unknownRequest = new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'new-agent' },
        event: { name: 'session.start' },
      }),
    }) as any;

    const unknownResponse = await lifecycleRoute.POST(unknownRequest);
    expect(await unknownResponse.json()).toMatchObject({
      host_output: { mode: 'none', value: null },
      meta: { reason: 'unknown_runtime_family' },
    });

    const unsupportedRequest = new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'mcp', runtime_family: 'mcp' },
        event: { name: 'session.start' },
      }),
    }) as any;

    const unsupportedResponse = await lifecycleRoute.POST(unsupportedRequest);
    expect(await unsupportedResponse.json()).toMatchObject({
      host_output: { mode: 'none', value: null },
      meta: { reason: 'unsupported_runtime_family' },
    });

    const unknownOpenCodeAlias = new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'opencode-preview', runtime_family: 'opencode-preview' },
        event: { name: 'session.start' },
      }),
    }) as any;
    const unknownAliasResponse = await lifecycleRoute.POST(unknownOpenCodeAlias);
    expect(await unknownAliasResponse.json()).toMatchObject({
      meta: { reason: 'unknown_runtime_family' },
    });

    const emptyPromptRequest = new Request('http://localhost/api/lifecycle/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runtime: { runtime_id: 'pi', runtime_family: 'pi' },
        event: { name: 'prompt.submit' },
        normalized: { session_id: 'sess-empty', prompt: '' },
      }),
    }) as any;

    const emptyPromptResponse = await lifecycleRoute.POST(emptyPromptRequest);
    expect(await emptyPromptResponse.json()).toMatchObject({
      host_output: { mode: 'none', value: null },
      meta: { reason: 'empty_prompt' },
    });
    expect(mockBootView).not.toHaveBeenCalled();
    expect(mockRecallMemories).not.toHaveBeenCalled();
  });
});
