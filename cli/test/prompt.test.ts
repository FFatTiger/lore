import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSnapshot, type InstallSnapshot } from '../src/core/snapshot.ts';
import { createTTYPrompt } from '../src/ui/prompt.ts';

const emptySnapshot: InstallSnapshot = {
  loreHome: '/tmp/x',
  configPath: '/tmp/x/config.json',
  config: {},
  hasConfig: false,
  serverKind: 'unknown',
  agents: {
    claude: true,
    codex: false,
    pi: true,
    openclaw: false,
    opencode: false,
    hermes: false,
    docker: true,
  },
  channels: [
    { id: 'claudecode', state: 'missing', details: [] },
    { id: 'codex', state: 'missing', details: [] },
    { id: 'pi', state: 'installed', details: [] },
    { id: 'openclaw', state: 'missing', details: [] },
    { id: 'hermes', state: 'missing', details: [] },
    { id: 'opencode', state: 'missing', details: [] },
  ],
  detectedChannels: ['claudecode', 'pi'],
};

test('status snapshot is a compact decision summary', () => {
  const snapshot = formatSnapshot(emptySnapshot, 'en');
  assert.match(snapshot, /^Connection/m);
  assert.match(snapshot, /Runtimes/);
  assert.match(snapshot, /2 detected · 1\/6 integrations installed/);
  assert.match(snapshot, /Full details: loremem status/);
  assert.doesNotMatch(snapshot, /\t/);
});

test('TTY prompt pickLanguage uses selectOne', async () => {
  const prompt = createTTYPrompt({
    selectOne: async (opts) => opts.options[1]!.value,
  });
  const lang = await prompt.pickLanguage('en');
  assert.equal(lang, 'zh');
});

test('TTY prompt first-run offers client-only connection first and Docker last', async () => {
  let seen: { values: unknown[]; initial: unknown; dockerHint?: string } | undefined;
  const prompt = createTTYPrompt({
    lang: 'en',
    selectOne: async (opts) => {
      seen = {
        values: opts.options.map((o) => o.value),
        initial: opts.initialValue,
        dockerHint: opts.options.at(-1)?.hint,
      };
      return opts.initialValue as never;
    },
  });
  const action = await prompt.pickFirstRunAction({ dockerAvailable: false });
  assert.equal(action, 'external');
  assert.deepEqual(seen?.values, ['external', 'saas', 'docker']);
  assert.match(seen?.dockerHint ?? '', /not detected/i);
});

test('TTY prompt first-run preselects the command-line connection', async () => {
  const prompt = createTTYPrompt({
    lang: 'en',
    selectOne: async (opts) => opts.initialValue as never,
  });
  assert.equal(await prompt.pickFirstRunAction({ initial: 'docker' }), 'docker');
});

test('TTY prompt pickChannels lists only the given choices with defaults preselected', async () => {
  let offered: unknown[] = [];
  let initial: unknown[] | undefined;
  const prompt = createTTYPrompt({
    lang: 'en',
    multiSelect: async (opts) => {
      offered = opts.options.map((o) => o.value);
      initial = opts.initialValues;
      return ['pi'] as never;
    },
  });
  const channels = await prompt.pickChannels({
    choices: ['claudecode', 'pi'],
    defaults: ['claudecode', 'pi', 'opencode'],
    snapshot: emptySnapshot,
    purpose: 'install',
  });
  assert.deepEqual(offered, ['claudecode', 'pi']);
  assert.deepEqual(initial, ['claudecode', 'pi']);
  assert.deepEqual(channels, ['pi']);
});

test('TTY prompt token falls back to the command-line value on empty input', async () => {
  let message = '';
  const prompt = createTTYPrompt({
    lang: 'en',
    text: async (opts) => {
      message = opts.message;
      return '';
    },
  });
  const token = await prompt.askToken({ required: true, hasPreset: true });
  assert.equal(token, '');
  assert.match(message, /--api-token/);
});

test('TTY prompt confirm false via confirmFn', async () => {
  const prompt = createTTYPrompt({
    lang: 'en',
    confirmFn: async () => false,
  });
  const ok = await prompt.confirm('summary');
  assert.equal(ok, false);
});
