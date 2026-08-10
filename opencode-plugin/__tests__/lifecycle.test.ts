import type { Hooks } from '@opencode-ai/plugin';
import type { Event, Part, Session, UserMessage } from '@opencode-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyDirectUserPrompt,
  createOpenCodeLifecycleAdapter,
  LORE_RECALL_MARKER,
} from '../lifecycle.js';

type ChatMessageHook = NonNullable<Hooks['chat.message']>;
type ChatMessageInput = Parameters<ChatMessageHook>[0];
type ChatMessageOutput = Parameters<ChatMessageHook>[1];

function message(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    id: 'msg-1',
    sessionID: 'ses-1',
    role: 'user',
    time: { created: 1 },
    agent: 'build',
    model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
    ...overrides,
  };
}

function textPart(id: string, text: string, overrides: Record<string, unknown> = {}): Part {
  return {
    id,
    sessionID: 'ses-1',
    messageID: 'msg-1',
    type: 'text',
    text,
    ...overrides,
  } as Part;
}

function fixture(
  parts: Part[] = [textPart('prt-1', 'First'), textPart('prt-2', 'Second')],
  inputOverrides: Partial<ChatMessageInput> = {},
  messageOverrides: Partial<UserMessage> = {},
): [ChatMessageInput, ChatMessageOutput] {
  return [
    {
      sessionID: 'ses-1',
      messageID: 'msg-1',
      agent: 'build',
      model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
      ...inputOverrides,
    },
    { message: message(messageOverrides), parts },
  ];
}

const lifecycleConfig = {
  baseUrl: 'https://api.example.test',
  apiToken: 'secret',
  startupTimeoutMs: 8_000,
  requestTimeoutMs: 30_000,
  defaultDomain: 'core',
  loreHome: '/tmp/lore-home',
};

function session(id: string): Session {
  return {
    id,
    projectID: 'project-1',
    directory: '/workspace/project',
    title: 'OpenCode session',
    version: '1.18.3',
    time: { created: 1, updated: 1 },
  };
}

function sessionEvent(type: 'session.created' | 'session.deleted', id: string): Event {
  return { type, properties: { info: session(id) } } as Event;
}

function compactedEvent(id: string): Event {
  return { type: 'session.compacted', properties: { sessionID: id } } as Event;
}

function systemInput(sessionID?: string): Parameters<NonNullable<Hooks['experimental.chat.system.transform']>>[0] {
  return { sessionID, model: {} as never };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function adapter(logger = { warn: vi.fn(), debug: vi.fn() }) {
  return createOpenCodeLifecycleAdapter({
    config: lifecycleConfig,
    directory: '/workspace/project',
    worktree: '/workspace',
    logger,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('classifies genuine OpenCode direct-user prompts', () => {
  it('preserves original text order and returns host identity metadata', () => {
    const [input, output] = fixture();

    expect(classifyDirectUserPrompt(input, output)).toEqual({
      sessionID: 'ses-1',
      messageID: 'msg-1',
      prompt: 'First\n\nSecond',
      agent: 'build',
      model: 'anthropic/claude-sonnet',
    });
  });

  it('uses the generated output message identity when OpenCode omits the optional input messageID', () => {
    const [input, output] = fixture(
      [textPart('prt-1', 'CLI prompt')],
      { messageID: undefined },
    );

    expect(classifyDirectUserPrompt(input, output)).toEqual({
      sessionID: 'ses-1',
      messageID: 'msg-1',
      prompt: 'CLI prompt',
      agent: 'build',
      model: 'anthropic/claude-sonnet',
    });
  });

  it('excludes Lore-injected text when original text remains', () => {
    const [input, output] = fixture([
      textPart('prt-1', 'Original prompt'),
      textPart('prt-lore', '<recall>old</recall>', {
        synthetic: true,
        metadata: { lore_injected: true, marker: LORE_RECALL_MARKER },
      }),
    ]);

    expect(classifyDirectUserPrompt(input, output)?.prompt).toBe('Original prompt');
  });

  it.each([
    ['empty text', [textPart('prt-1', '   ')]],
    ['synthetic-only text', [textPart('prt-1', 'synthetic', { synthetic: true })]],
    ['ignored-only text', [textPart('prt-1', 'ignored', { ignored: true })]],
    ['injected-only text', [textPart('prt-1', 'injected', { metadata: { lore_injected: true } })]],
    ['all non-text parts', [{
      id: 'prt-agent', sessionID: 'ses-1', messageID: 'msg-1', type: 'agent', name: 'build', source: {},
    } as unknown as Part]],
  ])('rejects %s', (_label, parts) => {
    const [input, output] = fixture(parts);
    expect(classifyDirectUserPrompt(input, output)).toBeNull();
  });

  it('rejects compaction and subtask callbacks even when text is also present', () => {
    const compaction = {
      id: 'prt-c', sessionID: 'ses-1', messageID: 'msg-1', type: 'compaction', auto: true,
    } as Part;
    const subtask = {
      id: 'prt-s', sessionID: 'ses-1', messageID: 'msg-1', type: 'subtask', prompt: 'delegate', description: 'work', agent: 'build',
    } as Part;

    for (const special of [compaction, subtask]) {
      const [input, output] = fixture([textPart('prt-1', 'Original'), special]);
      expect(classifyDirectUserPrompt(input, output)).toBeNull();
    }
  });

  it('rejects summarized/internal, missing, mismatched, and unknown identities', () => {
    const cases: Array<[ChatMessageInput, ChatMessageOutput]> = [
      fixture(undefined, {}, { summary: { title: 'Summary', diffs: [] } }),
      fixture(undefined, {}, { id: '' as UserMessage['id'] }),
      fixture(undefined, { sessionID: '' }),
      fixture(undefined, { messageID: 'msg-other' }),
      fixture(undefined, {}, { sessionID: 'ses-other' }),
      fixture([textPart('prt-1', 'Original', { messageID: 'msg-other' })]),
      fixture([textPart('prt-1', 'Original'), { unexpected: true } as unknown as Part]),
    ];

    for (const [input, output] of cases) {
      expect(classifyDirectUserPrompt(input, output)).toBeNull();
    }
  });
});

describe('OpenCode lifecycle adapter', () => {
  it('prefetches startup once and injects one cached system block into concurrent transforms', async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise);
    const lifecycle = adapter();

    await lifecycle.hooks.event?.({ event: sessionEvent('session.created', 'ses-1') });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/lifecycle/event?client_type=opencode');
    expect(JSON.parse(String(init.body))).toEqual({
      protocol_version: 'lore.lifecycle.v1',
      runtime: { runtime_id: 'opencode', runtime_family: 'opencode' },
      event: { name: 'session.start', native_name: 'session.created' },
      normalized: { session_id: 'ses-1' },
      project: { dir_name: 'project', repo_name: 'workspace' },
      native_input_snapshot: { directory: '/workspace/project', worktree: '/workspace' },
    });

    const first = { system: ['Existing system'] };
    const second = { system: ['Existing system'] };
    const firstTransform = lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-1'), first);
    const secondTransform = lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-1'), second);

    pending.resolve(jsonResponse({
      host_output: {
        mode: 'return_value',
        value: { systemContext: 'SERVER BOOT core://agent/opencode' },
      },
    }));
    await Promise.all([firstTransform, secondTransform]);

    for (const output of [first, second]) {
      expect(output.system).toHaveLength(2);
      expect(output.system[1]).toContain('<!-- lore:opencode-system-context:start -->');
      expect(output.system[1]).toContain('SERVER BOOT core://agent/opencode');
      expect(output.system[1]).toContain('<!-- lore:opencode-system-context:end -->');
    }

    const later = {
      system: [
        'Existing system',
        '<!-- lore:opencode-system-context:start -->\nstale\n<!-- lore:opencode-system-context:end -->',
      ],
    };
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-1'), later);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(later.system.join('\n').match(/lore:opencode-system-context:start/g)).toHaveLength(1);
    expect(later.system.join('\n')).not.toContain('stale');
  });

  it('mutates the host system array in place so OpenCode retains the injected Boot context', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      host_output: {
        mode: 'return_value',
        value: { systemContext: 'SERVER BOOT core://agent/opencode' },
      },
    }));
    const lifecycle = adapter();
    const system = ['Existing system'];
    const output = { system };

    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-cli'), output);

    expect(output.system).toBe(system);
    expect(system).toHaveLength(2);
    expect(system[1]).toContain('<!-- lore:opencode-system-context:start -->');
    expect(system[1]).toContain('SERVER BOOT core://agent/opencode');
  });

  it('supports lazy startup, session isolation, bounded retry, compaction, deletion, and dispose', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const attempts = new Map<string, number>();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      signals.push(init?.signal as AbortSignal);
      const body = JSON.parse(String(init?.body));
      const id = String(body.normalized.session_id);
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      if (id === 'ses-retry' && attempts.get(id) === 1) throw new Error('temporary network error');
      return jsonResponse({
        host_output: { mode: 'return_value', value: { systemContext: `BOOT ${id}` } },
      });
    });
    const lifecycle = adapter();

    const lazy = { system: [] as string[] };
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-lazy'), lazy);
    expect(lazy.system.join('\n')).toContain('BOOT ses-lazy');

    const other = { system: [] as string[] };
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-other'), other);
    expect(other.system.join('\n')).toContain('BOOT ses-other');

    const failed = { system: [] as string[] };
    await expect(lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-retry'), failed))
      .resolves.toBeUndefined();
    expect(failed.system).toEqual([]);
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-retry'), failed);
    expect(attempts.get('ses-retry')).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-retry'), failed);
    expect(attempts.get('ses-retry')).toBe(2);
    expect(failed.system.join('\n')).toContain('BOOT ses-retry');

    await lifecycle.hooks.event?.({ event: compactedEvent('ses-lazy') });
    const compacted = { system: [] as string[] };
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-lazy'), compacted);
    expect(attempts.get('ses-lazy')).toBe(1);

    await lifecycle.hooks.event?.({ event: sessionEvent('session.created', 'ses-delete') });
    const deleteSignal = signals.at(-1);
    await lifecycle.hooks.event?.({ event: sessionEvent('session.deleted', 'ses-delete') });
    expect(deleteSignal?.aborted).toBe(true);

    await lifecycle.hooks.event?.({ event: sessionEvent('session.created', 'ses-dispose') });
    const disposeSignal = signals.at(-1);
    await lifecycle.dispose();
    expect(disposeSignal?.aborted).toBe(true);
  });

  it('injects schema-valid prompt Recall once with exact message identity and metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      host_output: {
        mode: 'return_value',
        value: { promptContext: '<recall session_id="ses-1" query_id="q-1" phase="prompt">\n0.9 | core://agent\n</recall>' },
      },
    }));
    const lifecycle = adapter();
    const [input, output] = fixture([textPart('prt-1', 'Remember the runtime contract')]);

    await lifecycle.hooks['chat.message']?.(input, output);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/lifecycle/event?client_type=opencode');
    expect(JSON.parse(String(init.body))).toEqual({
      protocol_version: 'lore.lifecycle.v1',
      runtime: { runtime_id: 'opencode', runtime_family: 'opencode' },
      event: { name: 'prompt.submit', native_name: 'chat.message' },
      normalized: { session_id: 'ses-1', prompt: 'Remember the runtime contract' },
      project: { dir_name: 'project', repo_name: 'workspace' },
      native_input_snapshot: {
        message_id: 'msg-1',
        agent: 'build',
        model: 'anthropic/claude-sonnet',
        directory: '/workspace/project',
        worktree: '/workspace',
      },
    });
    expect(output.parts).toHaveLength(2);
    expect(output.parts[0]).toEqual(textPart('prt-1', 'Remember the runtime contract'));
    expect(output.parts[1]).toEqual({
      id: expect.stringMatching(/^prt_lore_/),
      sessionID: 'ses-1',
      messageID: 'msg-1',
      type: 'text',
      text: expect.stringContaining('<recall session_id="ses-1"'),
      synthetic: true,
      metadata: { lore_injected: true, marker: LORE_RECALL_MARKER },
    });

    await lifecycle.hooks['chat.message']?.(input, output);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(output.parts).toHaveLength(2);
  });

  it('appends discovery-only <lore-skills> to promptContext and works without memory promptContext', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      skill_catalog: { project_id: 'project-1', catalog_revision: 'rev-9' },
      skill_candidates: [
        {
          skill_id: 'skill-1',
          name: 'demo-skill',
          version: 2,
          description: 'A demo skill',
        },
      ],
      host_output: {
        mode: 'return_value',
        value: {
          promptContext: '<recall session_id="ses-1" query_id="q-1" phase="prompt">\n0.9 | core://agent\n</recall>',
        },
      },
    }));
    const lifecycle = adapter();
    const [input, output] = fixture([textPart('prt-1', 'Use the demo skill')]);

    await lifecycle.hooks['chat.message']?.(input, output);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(output.parts).toHaveLength(2);
    const injected = output.parts[1] as { text: string };
    expect(injected.text).toContain('<recall session_id="ses-1"');
    expect(injected.text).toContain('<lore-skills>');
    expect(injected.text).toContain('lore_skill_get');
    expect(injected.text).toContain('skill_id: skill-1');
    expect(injected.text).toContain('demo-skill');
    expect(injected.text).not.toMatch(/skill_dir|\/skills\//);

    // Skills-only path: no memory promptContext, still injects discovery block.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      skill_catalog: { project_id: 'project-1', catalog_revision: 'rev-9' },
      skill_candidates: [
        { id: 'skill-2', name: 'other-skill', expected_version: 1 },
      ],
      host_output: { mode: 'return_value', value: {} },
    }));
    const [input2, output2] = fixture(
      [textPart('prt-2', 'Skills only', { messageID: 'msg-2' })],
      { messageID: 'msg-2' },
      { id: 'msg-2' },
    );
    await lifecycle.hooks['chat.message']?.(input2, output2);
    expect(output2.parts).toHaveLength(2);
    const skillsOnly = output2.parts[1] as { text: string };
    expect(skillsOnly.text).toContain('<lore-skills>');
    expect(skillsOnly.text).toContain('skill_id: skill-2');
    expect(skillsOnly.text).not.toContain('<recall');
  });

  it('fails open without mutating outputs and warns once for incompatible system-hook shapes', async () => {
    const logger = { warn: vi.fn(), debug: vi.fn() };
    const lifecycle = adapter(logger);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ detail: 'unauthorized' }, 401))
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce(jsonResponse({
        host_output: { mode: 'return_value', value: { systemContext: 'MUST NOT ENTER USER MESSAGE' } },
      }));

    const unauthorized = { system: ['base'] };
    await expect(lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-401'), unauthorized))
      .resolves.toBeUndefined();
    expect(unauthorized.system).toEqual(['base']);

    const invalid = { system: ['base'] };
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput('ses-json'), invalid);
    expect(invalid.system).toEqual(['base']);

    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput(undefined), { system: [] });
    await lifecycle.hooks['experimental.chat.system.transform']?.(systemInput(undefined), { system: [] });
    await lifecycle.hooks['experimental.chat.system.transform']?.(
      systemInput('ses-malformed'),
      { system: null } as unknown as { system: string[] },
    );
    expect(logger.warn).toHaveBeenCalledOnce();

    const [networkInput, networkOutput] = fixture(
      [textPart('prt-net', 'Network prompt', { messageID: 'msg-net' })],
      { messageID: 'msg-net' },
      { id: 'msg-net' },
    );
    await expect(lifecycle.hooks['chat.message']?.(networkInput, networkOutput)).resolves.toBeUndefined();
    expect(networkOutput.parts).toHaveLength(1);

    const [systemOnlyInput, systemOnlyOutput] = fixture(
      [textPart('prt-system', 'System-only response', { messageID: 'msg-system' })],
      { messageID: 'msg-system' },
      { id: 'msg-system' },
    );
    await lifecycle.hooks['chat.message']?.(systemOnlyInput, systemOnlyOutput);
    expect(systemOnlyOutput.parts).toHaveLength(1);
    expect(systemOnlyOutput.parts[0]).not.toHaveProperty('text', 'MUST NOT ENTER USER MESSAGE');
  });
});
