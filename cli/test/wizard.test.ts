import assert from 'node:assert/strict';
import test from 'node:test';
import { runInteractiveWizard } from '../src/ui/wizard.ts';
import type { PromptService } from '../src/ui/prompt.ts';
import type { InstallSnapshot } from '../src/core/snapshot.ts';
import { ALL_CHANNELS } from '../src/core/types.ts';

function baseSnapshot(over: Partial<InstallSnapshot> = {}): InstallSnapshot {
  return {
    loreHome: '/tmp/lore',
    configPath: '/tmp/lore/config.json',
    config: {},
    hasConfig: false,
    serverKind: 'unknown',
    agents: {
      claude: true,
      codex: true,
      pi: false,
      openclaw: false,
      opencode: false,
      hermes: false,
      docker: true,
    },
    channels: ALL_CHANNELS.map((id) => ({ id, state: 'missing' as const, details: [] })),
    detectedChannels: ['claudecode', 'codex'],
    ...over,
  };
}

function scriptedPrompt(script: {
  lang?: 'en' | 'zh';
  first?: 'saas' | 'external' | 'docker';
  existing?: 'update' | 'reconfigure' | 'manage' | 'uninstall' | 'status' | 'exit';
  token?: string;
  baseUrl?: string;
  channels?: string[];
  release?: 'stable' | 'pre' | 'dev';
  confirm?: boolean;
  force?: boolean;
  purge?: boolean;
}): PromptService {
  return {
    async pickLanguage(def) {
      return script.lang ?? def;
    },
    showStatus() {},
    async pickFirstRunAction() {
      return script.first ?? 'saas';
    },
    async pickExistingAction() {
      return script.existing ?? 'update';
    },
    async askBaseUrl(def = '') {
      return script.baseUrl ?? def;
    },
    async askToken() {
      return script.token ?? '';
    },
    async pickChannels(opts) {
      return (script.channels as never) ?? opts.defaults;
    },
    async pickRelease(def = 'stable') {
      return script.release ?? def;
    },
    async confirm() {
      return script.confirm ?? true;
    },
    async askYesNo(_q, def = true) {
      if (_q.toLowerCase().includes('purge') || _q.includes('清除')) return script.purge ?? false;
      if (_q.toLowerCase().includes('force') || _q.includes('强制')) return script.force ?? false;
      return def;
    },
  };
}

test('first-run SaaS asks token only (no custom base url path)', async () => {
  const result = await runInteractiveWizard({
    prompt: scriptedPrompt({
      first: 'saas',
      token: 'lm_saas',
      channels: ['claudecode'],
      confirm: true,
    }),
    snapshot: baseSnapshot(),
    initialLang: 'en',
    langLocked: true,
    env: {},
  });
  assert.equal(result.kind, 'install');
  if (result.kind !== 'install') return;
  assert.equal(result.plan.connectionMode, 'external');
  assert.equal(result.plan.baseUrl, 'https://api.loremem.com');
  assert.equal(result.plan.apiToken, 'lm_saas');
  assert.equal(result.plan.skipDocker, true);
  assert.equal(result.plan.explicitBaseUrl, true);
  assert.deepEqual(result.plan.channels, ['claudecode']);
});

test('first-run external collects URL + token', async () => {
  const result = await runInteractiveWizard({
    prompt: scriptedPrompt({
      first: 'external',
      baseUrl: 'https://core.example',
      token: 'lm_ext',
      channels: ['pi'],
    }),
    snapshot: baseSnapshot(),
    initialLang: 'en',
    langLocked: true,
  });
  assert.equal(result.kind, 'install');
  if (result.kind !== 'install') return;
  assert.equal(result.plan.connectionMode, 'external');
  assert.equal(result.plan.baseUrl, 'https://core.example');
  assert.equal(result.plan.apiToken, 'lm_ext');
});

test('existing install update keeps server and only picks channels', async () => {
  const result = await runInteractiveWizard({
    prompt: scriptedPrompt({
      existing: 'update',
      channels: ['pi', 'codex'],
      force: false,
      release: 'stable',
    }),
    snapshot: baseSnapshot({
      hasConfig: true,
      serverKind: 'saas',
      config: {
        base_url: 'https://api.loremem.com',
        api_token: 'lm_old',
        installed_version: 'v1.3.15',
        docker_managed: false,
      },
      channels: ALL_CHANNELS.map((id) => ({
        id,
        state: id === 'pi' || id === 'codex' ? 'installed' : 'missing',
        details: [],
      })),
    }),
    initialLang: 'en',
    langLocked: true,
  });
  assert.equal(result.kind, 'install');
  if (result.kind !== 'install') return;
  assert.equal(result.plan.connectionMode, 'preserve');
  assert.equal(result.plan.baseUrl, 'https://api.loremem.com');
  assert.equal(result.plan.apiToken, undefined);
  assert.equal(result.plan.keepExistingToken, true);
  assert.deepEqual(result.plan.channels, ['pi', 'codex']);
});

test('Docker reconfigure is explicit and does not preserve external connection', async () => {
  const result = await runInteractiveWizard({
    prompt: scriptedPrompt({
      existing: 'reconfigure',
      first: 'docker',
      channels: ['codex'],
    }),
    snapshot: baseSnapshot({
      hasConfig: true,
      serverKind: 'saas',
      config: { base_url: 'https://api.loremem.com', api_token: 'lm_old' },
    }),
    initialLang: 'en',
    langLocked: true,
  });
  assert.equal(result.kind, 'install');
  if (result.kind !== 'install') return;
  assert.equal(result.plan.connectionMode, 'docker');
  assert.equal(result.plan.keepExistingToken, false);
});

test('existing uninstall returns uninstall plan', async () => {
  const result = await runInteractiveWizard({
    prompt: scriptedPrompt({
      existing: 'uninstall',
      channels: ['opencode'],
      purge: true,
    }),
    snapshot: baseSnapshot({
      hasConfig: true,
      serverKind: 'external',
      config: { base_url: 'http://192.168.1.1:18901', api_token: 'x' },
    }),
    initialLang: 'zh',
    langLocked: true,
  });
  assert.equal(result.kind, 'uninstall');
  if (result.kind !== 'uninstall') return;
  assert.deepEqual(result.channels, ['opencode']);
  assert.equal(result.purge, true);
});
