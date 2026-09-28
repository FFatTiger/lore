import { describe, expect, it } from 'vitest';
import {
  getDefaultBootContent,
  getBootSetupDecision,
  getBootSetupRedirect,
  getSetupFlowDecision,
  getSetupFlowRedirect,
  isSettingsPath,
  isSetupPath,
  type SetupFlowStatus,
} from '@/lib/bootSetup';

const partialSetupFlow: SetupFlowStatus = {
  complete: false,
  next_step: '/setup/llm',
  steps: [
    { id: 'embedding', path: '/setup/embedding', label: 'Embedding setup', complete: true },
    { id: 'llm', path: '/setup/llm', label: 'View LLM setup', complete: false },
    { id: 'boot:agent', path: '/setup/boot/agent', label: 'Agent boot memory', complete: false, role: 'agent', uri: 'core://agent', scope: 'global', client_type: null, setup_slug: 'agent' },
    { id: 'boot:soul', path: '/setup/boot/soul', label: 'Soul boot memory', complete: false, role: 'soul', uri: 'core://soul', scope: 'global', client_type: null, setup_slug: 'soul' },
    { id: 'boot:user', path: '/setup/boot/user', label: 'User boot memory', complete: false, role: 'user', uri: 'preferences://user', scope: 'global', client_type: null, setup_slug: 'user' },
    { id: 'channel_agents', path: '/setup/channels', label: 'Channel agent setup', complete: false, role: 'agent', scope: 'client', client_type: null, setup_slug: 'channel_agents' },
  ],
  embedding: { configured: true, runtime_ready: true },
  llm: { configured: false, runtime_ready: false },
  boot: {
    overall_state: 'partial',
    nodes: [],
    loaded: 1,
    total: 3,
    remaining_count: 2,
    draft_generation_available: false,
    draft_generation_reason: 'View LLM API key is not configured.',
    includes_all_clients: true,
  },
};

const completeSetupFlow: SetupFlowStatus = {
  ...partialSetupFlow,
  complete: true,
  next_step: null,
  steps: partialSetupFlow.steps.map((step) => ({ ...step, complete: true })),
  llm: { configured: true, runtime_ready: true },
  boot: {
    ...partialSetupFlow.boot,
    overall_state: 'complete',
    remaining_count: 0,
    draft_generation_available: true,
    draft_generation_reason: null,
  },
};

describe('bootSetup routing helpers', () => {
  it('documents how client runtime boot nodes treat shared agent rules', () => {
    expect(getDefaultBootContent('core://agent/claudecode')).toContain('将 core://agent 内容视作 CLAUDE.md');
    expect(getDefaultBootContent('core://agent/codex')).toContain('将 core://agent 内容视作 AGENTS.md');
  });

  it('provides OpenCode-specific default boot content', () => {
    const content = getDefaultBootContent('core://agent/opencode');

    expect(content).toContain('core://agent');
    expect(content).toContain('system context');
    expect(content).toContain('当前用户轮次');
    expect(content).toContain('独立 part');
    expect(content).toContain('lore_guidance');
    expect(content).toContain('lore_move_node');
    expect(content).toContain('client_type=opencode');
    expect(content).toContain('fail open');
  });

  it('provides ZCode-specific default boot content without pretending to be Pi or Codex', () => {
    const content = getDefaultBootContent('core://agent/zcode');

    expect(content).toContain('core://agent');
    expect(content).toContain('SessionStart');
    expect(content).toContain('UserPromptSubmit');
    expect(content).toContain('client_type=zcode');
    expect(content).toContain('runtime_family=zcode');
    expect(content).toContain('fail open');
    expect(content).toContain('不要把 ZCode 当成 Pi 或 Codex');
    expect(content).not.toContain('Pi extensions');
    expect(content).not.toContain('AGENTS.md');
  });

  it('detects setup paths', () => {
    expect(isSetupPath('/setup')).toBe(true);
    expect(isSetupPath('/setup/extra')).toBe(true);
    expect(isSetupPath('/memory')).toBe(false);
  });

  it('detects settings paths', () => {
    expect(isSettingsPath('/settings')).toBe(true);
    expect(isSettingsPath('/settings/advanced')).toBe(true);
    expect(isSettingsPath('/setup')).toBe(false);
  });

  it('prompts first on incomplete boot when the user has not acknowledged setup yet', () => {
    expect(getBootSetupDecision('/memory', 'partial', false)).toEqual({ kind: 'prompt', target: '/setup' });
    expect(getBootSetupDecision('/', 'uninitialized', false)).toEqual({ kind: 'prompt', target: '/setup' });
  });

  it('redirects incomplete boot state to setup after acknowledgement', () => {
    expect(getBootSetupDecision('/memory', 'partial', true)).toEqual({ kind: 'redirect', target: '/setup' });
    expect(getBootSetupDecision('/', 'uninitialized', true)).toEqual({ kind: 'redirect', target: '/setup' });
    expect(getBootSetupRedirect('/memory', 'partial')).toBe('/setup');
    expect(getBootSetupRedirect('/', 'uninitialized')).toBe('/setup');
  });

  it('allows settings and setup while boot is incomplete', () => {
    expect(getBootSetupDecision('/settings', 'partial', false)).toEqual({ kind: 'none', target: null });
    expect(getBootSetupDecision('/setup', 'uninitialized', false)).toEqual({ kind: 'none', target: null });
    expect(getBootSetupRedirect('/settings', 'partial')).toBeNull();
    expect(getBootSetupRedirect('/setup', 'uninitialized')).toBeNull();
  });

  it('redirects completed setup back to memory', () => {
    expect(getBootSetupDecision('/setup', 'complete', false)).toEqual({ kind: 'redirect', target: '/memory' });
    expect(getBootSetupDecision('/', 'complete', false)).toEqual({ kind: 'redirect', target: '/memory' });
    expect(getBootSetupRedirect('/setup', 'complete')).toBe('/memory');
    expect(getBootSetupRedirect('/', 'complete')).toBe('/memory');
  });

  it('does nothing when already on a normal page after completion', () => {
    expect(getBootSetupDecision('/memory', 'complete', false)).toEqual({ kind: 'none', target: null });
    expect(getBootSetupDecision('/recall', 'complete', false)).toEqual({ kind: 'none', target: null });
    expect(getBootSetupRedirect('/memory', 'complete')).toBeNull();
    expect(getBootSetupRedirect('/recall', 'complete')).toBeNull();
  });

  it('does nothing when boot state is unavailable', () => {
    expect(getBootSetupDecision('/memory', null, false)).toEqual({ kind: 'none', target: null });
    expect(getBootSetupDecision('/memory', undefined, false)).toEqual({ kind: 'none', target: null });
    expect(getBootSetupRedirect('/memory', null)).toBeNull();
    expect(getBootSetupRedirect('/memory', undefined)).toBeNull();
  });

  it('prompts to the first incomplete setup step before acknowledgement', () => {
    expect(getSetupFlowDecision('/memory', partialSetupFlow, false)).toEqual({ kind: 'prompt', target: '/setup/llm' });
    expect(getSetupFlowDecision('/', partialSetupFlow, false)).toEqual({ kind: 'prompt', target: '/setup/llm' });
  });

  it('redirects to the first incomplete setup step after acknowledgement', () => {
    expect(getSetupFlowDecision('/memory', partialSetupFlow, true)).toEqual({ kind: 'redirect', target: '/setup/llm' });
    expect(getSetupFlowRedirect('/memory', partialSetupFlow)).toBe('/setup/llm');
  });

  it('allows setup and settings pages while setup is incomplete', () => {
    expect(getSetupFlowDecision('/setup/llm', partialSetupFlow, false)).toEqual({ kind: 'none', target: null });
    expect(getSetupFlowDecision('/settings', partialSetupFlow, false)).toEqual({ kind: 'none', target: null });
    expect(getSetupFlowRedirect('/setup/channels', partialSetupFlow)).toBeNull();
  });

  it('redirects setup pages back to memory after completion', () => {
    expect(getSetupFlowDecision('/setup/boot/user', completeSetupFlow, false)).toEqual({ kind: 'redirect', target: '/memory' });
    expect(getSetupFlowRedirect('/setup/embedding', completeSetupFlow)).toBe('/memory');
  });

  it('does nothing on normal pages after setup completion', () => {
    expect(getSetupFlowDecision('/memory', completeSetupFlow, false)).toEqual({ kind: 'none', target: null });
    expect(getSetupFlowRedirect('/recall', completeSetupFlow)).toBeNull();
  });
});
