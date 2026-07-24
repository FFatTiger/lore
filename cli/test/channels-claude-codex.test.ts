import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudecodeInstaller } from '../src/channels/claudecode.ts';
import { codexInstaller } from '../src/channels/codex.ts';
import type { ChannelContext } from '../src/channels/types.ts';
import type { ExecFn } from '../src/core/exec.ts';

async function tempHome(prefix = 'lore-cc-') {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  return { home, loreHome };
}

function ctx(p: Partial<ChannelContext> & { loreHome: string; homeDir: string }): ChannelContext {
  return {
    baseUrl: 'https://core.example',
    apiToken: 'lm_x',
    tokenAction: 'set',
    needInstall: 2,
    force: false,
    lang: 'en',
    releaseVersion: 'v1.3.15',
    env: { ...process.env },
    ...p,
  };
}

async function withBin(home: string, name: string, fn: (pathEnv: string) => Promise<void>) {
  const bin = path.join(home, 'bin');
  await fs.mkdir(bin, { recursive: true });
  const executable = path.join(bin, process.platform === 'win32' ? `${name}.cmd` : name);
  await fs.writeFile(
    executable,
    process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
  );
  if (process.platform !== 'win32') await fs.chmod(executable, 0o755);
  const pathEnv = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  const originalPath = process.env.PATH;
  process.env.PATH = pathEnv;
  try {
    await fn(pathEnv);
  } finally {
    process.env.PATH = originalPath;
  }
}

async function seedCodexArtifact(
  loreHome: string,
  hooks: unknown = { root: '__LORE_CODEX_PLUGIN_ROOT__' },
): Promise<string> {
  const market = path.join(loreHome, 'codex', 'plugins', 'lore');
  await fs.mkdir(path.join(market, 'hooks'), { recursive: true });
  await fs.mkdir(path.join(market, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(market, 'hooks', 'hooks.json'), `${JSON.stringify(hooks, null, 2)}\n`);
  await fs.writeFile(path.join(market, 'scripts', 'install-hooks.sh'), '#!/bin/bash\nexit 0\n');
  await fs.chmod(path.join(market, 'scripts', 'install-hooks.sh'), 0o755);
  return market;
}

async function readCodexConfig(home: string): Promise<string> {
  return fs.readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
}

test('claude install writes settings and mcp args', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  const calls: string[] = [];
  const run: ExecFn = async (argv) => {
    calls.push(argv.join(' '));
    if (argv.join(' ') === 'claude plugin list') {
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'claude', async () => {
    const result = await claudecodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    assert.ok(calls.some((c) => c.includes('claude plugin marketplace add')));
    assert.ok(calls.some((c) => c.includes('claude mcp add') && c.includes('Authorization: Bearer lm_x')));
    const settings = JSON.parse(
      await fs.readFile(path.join(home, '.claude', 'settings.json'), 'utf8'),
    ) as { env: { LORE_BASE_URL: string; LORE_API_TOKEN: string } };
    assert.equal(settings.env.LORE_BASE_URL, 'https://core.example');
    assert.equal(settings.env.LORE_API_TOKEN, 'lm_x');
  });
});

test('Claude preserves host configuration written during installation', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  const settingsPath = path.join(home, '.claude', 'settings.json');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify({ before: true }), 'utf8');
  const run: ExecFn = async (argv) => {
    if (argv.slice(0, 4).join(' ') === 'claude plugin marketplace add') {
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ before: true, hostAdded: { marketplace: 'lore' } }),
        'utf8',
      );
    }
    if (argv.join(' ') === 'claude plugin list') {
      return { code: 0, stdout: 'lore@lore', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'claude', async () => {
    const result = await claudecodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      before: boolean;
      hostAdded: { marketplace: string };
      env: Record<string, string>;
    };
    assert.equal(settings.before, true);
    assert.equal(settings.hostAdded.marketplace, 'lore');
    assert.equal(settings.env.LORE_BASE_URL, 'https://core.example');
    assert.equal(settings.env.LORE_API_TOKEN, 'lm_x');
  });
});

test('Claude marketplace failure returns failed with token redacted', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  const run: ExecFn = async (argv) => {
    if (argv.slice(0, 4).join(' ') === 'claude plugin marketplace add') {
      return { code: 1, stdout: '', stderr: 'marketplace rejected lm_x' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'claude', async () => {
    const result = await claudecodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Claude marketplace registration failed/i);
    assert.match(result.message ?? '', /\[REDACTED\]/);
    assert.doesNotMatch(result.message ?? '', /lm_x/);
  });
});

test('Claude MCP add failure returns failed without leaking token', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  const run: ExecFn = async (argv) => {
    if (argv.join(' ') === 'claude plugin list') {
      return { code: 0, stdout: 'lore@lore', stderr: '' };
    }
    if (argv[0] === 'claude' && argv[1] === 'mcp' && argv[2] === 'add') {
      return { code: 1, stdout: '', stderr: 'bad bearer lm_x' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'claude', async () => {
    const result = await claudecodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Claude MCP registration failed/i);
    assert.match(result.message ?? '', /\[REDACTED\]/);
    assert.doesNotMatch(result.message ?? '', /lm_x/);
  });
});

test('Claude clear token removes settings token and omits MCP header', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  const settingsPath = path.join(home, '.claude', 'settings.json');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify({
    theme: 'dark',
    env: { LORE_BASE_URL: 'https://old.example', LORE_API_TOKEN: 'lm_old', KEEP: 'yes' },
  }));
  const calls: string[][] = [];
  const run: ExecFn = async (argv) => {
    calls.push(argv);
    if (argv.join(' ') === 'claude plugin list') {
      return { code: 0, stdout: 'lore@lore', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'claude', async () => {
    const result = await claudecodeInstaller.install(ctx({
      loreHome,
      homeDir: home,
      run,
      apiToken: undefined,
      tokenAction: 'clear',
    }));
    assert.equal(result.status, 'ok');
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as {
      theme: string;
      env: Record<string, string>;
    };
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.env.KEEP, 'yes');
    assert.equal(settings.env.LORE_BASE_URL, 'https://core.example');
    assert.equal(settings.env.LORE_API_TOKEN, undefined);
    const add = calls.find((argv) => argv[0] === 'claude' && argv[1] === 'mcp' && argv[2] === 'add');
    assert.ok(add);
    assert.equal(add.includes('--header'), false);
  });
});

test('Claude malformed settings fail without overwriting the file', async () => {
  const { home, loreHome } = await tempHome();
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  const settingsPath = path.join(home, '.claude', 'settings.json');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, '{broken', 'utf8');
  let calls = 0;
  const run: ExecFn = async () => {
    calls += 1;
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'claude', async () => {
    const result = await claudecodeInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Invalid JSON/i);
    assert.equal(await fs.readFile(settingsPath, 'utf8'), '{broken');
    assert.equal(calls, 0);
  });
});

test('Claude uninstall removes legacy guidance imports and preserves unrelated content', async () => {
  const { home, loreHome } = await tempHome();
  const claudeDir = path.join(home, '.claude');
  const claudeMd = path.join(claudeDir, 'CLAUDE.md');
  const guidance = path.join(claudeDir, 'lore-guidance.md');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(path.join(loreHome, 'claudecode'), { recursive: true });
  await fs.writeFile(guidance, 'legacy guidance\n', 'utf8');
  await fs.writeFile(
    claudeMd,
    [
      '# Keep this heading',
      '@~/.claude/lore-guidance.md',
      'Keep this instruction',
      '@import ~/.claude/lore-guidance.md',
      '',
    ].join('\n'),
    'utf8',
  );

  const origPath = process.env.PATH;
  process.env.PATH = path.join(home, 'empty-bin');
  await fs.mkdir(process.env.PATH, { recursive: true });
  try {
    const result = await claudecodeInstaller.uninstall({ loreHome, homeDir: home });
    assert.equal(result.status, 'ok');
  } finally {
    process.env.PATH = origPath;
  }

  await assert.rejects(fs.access(guidance));
  const body = await fs.readFile(claudeMd, 'utf8');
  assert.equal(body, '# Keep this heading\nKeep this instruction\n');
});

test('codex replaces an existing marketplace source and patches source, local, and versioned hooks', async () => {
  const { home, loreHome } = await tempHome();
  const sourcePlugin = await seedCodexArtifact(loreHome, {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node "__LORE_CODEX_PLUGIN_ROOT__/hooks/rules-inject.mjs"',
            },
          ],
        },
      ],
    },
  });
  const cHome = path.join(home, '.codex');
  const localRoot = path.join(cHome, 'plugins', 'cache', 'lore', 'lore', 'local');
  const versionRoot = path.join(cHome, 'plugins', 'cache', 'lore', 'lore', '1.3.15');
  const calls: string[] = [];
  let removed = false;
  const run: ExecFn = async (argv) => {
    calls.push(argv.join(' '));
    if (argv.join(' ') === 'codex plugin marketplace remove lore') {
      removed = true;
      return { code: 1, stdout: '', stderr: 'not found is acceptable' };
    }
    if (argv[0] === 'codex' && argv[1] === 'plugin' && argv[2] === 'marketplace' && argv[3] === 'add') {
      if (!removed) {
        return {
          code: 1,
          stdout: '',
          stderr: "marketplace 'lore' is already added from a different source",
        };
      }
      await fs.mkdir(path.dirname(versionRoot), { recursive: true });
      await fs.cp(sourcePlugin, versionRoot, { recursive: true });
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
  });

  const removeIndex = calls.indexOf('codex plugin marketplace remove lore');
  const addIndex = calls.findIndex((call) => call.startsWith('codex plugin marketplace add '));
  assert.ok(removeIndex >= 0);
  assert.ok(addIndex > removeIndex);

  for (const root of [sourcePlugin, localRoot, versionRoot]) {
    const raw = await fs.readFile(path.join(root, 'hooks', 'hooks.json'), 'utf8');
    assert.doesNotMatch(raw, /__LORE_CODEX_PLUGIN_ROOT__/);
    const parsed = JSON.parse(raw) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    assert.ok(parsed.hooks.SessionStart[0].hooks[0].command.includes(root.replace(/\\/g, '/')));
  }
});

test('codex patches a pre-existing versioned cache after marketplace registration', async () => {
  const { home, loreHome } = await tempHome();
  await seedCodexArtifact(loreHome);
  const versionRoot = path.join(home, '.codex', 'plugins', 'cache', 'lore', 'lore', '1.3.15');
  await fs.mkdir(path.join(versionRoot, 'hooks'), { recursive: true });
  await fs.writeFile(
    path.join(versionRoot, 'hooks', 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node "__LORE_CODEX_PLUGIN_ROOT__/hooks/recall-inject.mjs"',
              },
            ],
          },
        ],
      },
    }, null, 2)}\n`,
  );

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({
      loreHome,
      homeDir: home,
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
    }));
    assert.equal(result.status, 'ok');
  });

  const raw = await fs.readFile(path.join(versionRoot, 'hooks', 'hooks.json'), 'utf8');
  assert.doesNotMatch(raw, /__LORE_CODEX_PLUGIN_ROOT__/);
  assert.ok(raw.includes(versionRoot.replace(/\\/g, '/')));
});

test('codex final TOML preserves Authorization after host MCP mutation', async () => {
  const { home, loreHome } = await tempHome();
  await seedCodexArtifact(loreHome);
  const cfgPath = path.join(home, '.codex', 'config.toml');
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  await fs.writeFile(cfgPath, '# existing\n');

  const run: ExecFn = async (argv) => {
    if (argv[0] === 'codex' && argv[1] === 'mcp' && argv[2] === 'remove' && argv[3] === 'lore') {
      await fs.writeFile(cfgPath, '', 'utf8');
    }
    if (argv[0] === 'codex' && argv[1] === 'mcp' && argv[2] === 'add' && argv[3] === 'lore') {
      const urlFlag = argv.indexOf('--url');
      assert.notEqual(urlFlag, -1);
      const url = argv[urlFlag + 1];
      await fs.writeFile(cfgPath, `[mcp_servers.lore]\nurl = ${JSON.stringify(url)}\n`, 'utf8');
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    const cfg = await readCodexConfig(home);
    assert.match(cfg, /http_headers = \{ Authorization = "Bearer lm_x" \}/);
    assert.match(cfg, /\[plugins\."lore@lore"\]/);
    assert.match(cfg, /hooks = true/);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(cfgPath)).mode & 0o777, 0o600);
    }
  });
});

test('codex defaults to bundled hooks and removes only legacy Lore hooks', async () => {
  const { home, loreHome } = await tempHome();
  await seedCodexArtifact(loreHome);
  const codexDir = path.join(home, '.codex');
  await fs.mkdir(path.join(codexDir, 'hooks', 'lore'), { recursive: true });
  await fs.writeFile(path.join(codexDir, 'hooks', 'lore', 'old'), 'legacy');
  await fs.writeFile(
    path.join(codexDir, 'hooks.json'),
    JSON.stringify({
      description: 'user hooks',
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'echo unrelated' }] },
          {
            hooks: [
              {
                type: 'command',
                command: 'LORE_CODEX_PLUGIN_ROOT="/old" node "/root/.codex/hooks/lore/hooks/rules-inject.mjs"',
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'node "/root/.codex/hooks/lore/hooks/recall-inject.mjs"',
              },
            ],
          },
        ],
      },
    }, null, 2),
  );
  let hookInstallerCalled = false;
  const run: ExecFn = async (argv) => {
    if (argv[0] === 'bash' && argv[1]?.endsWith('install-hooks.sh')) hookInstallerCalled = true;
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    assert.equal(hookInstallerCalled, false);
    await assert.rejects(fs.access(path.join(codexDir, 'hooks', 'lore')));
    const data = JSON.parse(await fs.readFile(path.join(codexDir, 'hooks.json'), 'utf8')) as {
      description: string;
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    assert.equal(data.description, 'user hooks');
    assert.deepEqual(data.hooks.SessionStart, [
      { hooks: [{ type: 'command', command: 'echo unrelated' }] },
    ]);
    assert.equal(data.hooks.UserPromptSubmit, undefined);
  });
});

test('codex installs legacy hooks only when explicitly enabled', async () => {
  const { home, loreHome } = await tempHome();
  await seedCodexArtifact(loreHome);
  let hookCall: { argv: string[]; env?: NodeJS.ProcessEnv } | undefined;
  const run: ExecFn = async (argv, opts) => {
    if (argv[0] === 'bash' && argv[1]?.endsWith('install-hooks.sh')) {
      hookCall = { argv, env: opts?.env };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  await withBin(home, 'codex', async (pathEnv) => {
    const result = await codexInstaller.install(ctx({
      loreHome,
      homeDir: home,
      run,
      env: {
        PATH: pathEnv,
        LORE_CODEX_INSTALL_USER_HOOKS: '1',
        ONLY_FROM_CONTEXT: 'yes',
      },
    }));
    assert.equal(result.status, 'ok');
    assert.ok(hookCall);
    assert.equal(hookCall?.env?.HOME, home);
    assert.equal(hookCall?.env?.CODEX_HOME, path.join(home, '.codex'));
    assert.equal(hookCall?.env?.LORE_BASE_URL, 'https://core.example');
    assert.equal(hookCall?.env?.LORE_API_TOKEN, 'lm_x');
    assert.equal(hookCall?.env?.ONLY_FROM_CONTEXT, 'yes');
  });
});

test('codex malformed user hooks fail without overwriting bytes', async () => {
  const { home, loreHome } = await tempHome();
  await seedCodexArtifact(loreHome);
  const hooksPath = path.join(home, '.codex', 'hooks.json');
  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(hooksPath, '{broken', 'utf8');
  const run: ExecFn = async () => ({ code: 0, stdout: '', stderr: '' });

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Invalid JSON/i);
    assert.equal(await fs.readFile(hooksPath, 'utf8'), '{broken');
  });
});

test('codex marketplace failure returns failed with token redacted', async () => {
  const { home, loreHome } = await tempHome();
  await seedCodexArtifact(loreHome);
  const run: ExecFn = async (argv) => {
    if (
      argv[0] === 'codex' &&
      argv[1] === 'plugin' &&
      argv[2] === 'marketplace' &&
      argv[3] === 'add'
    ) {
      return { code: 1, stdout: '', stderr: 'failed for lm_x' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'failed');
    assert.match(result.message ?? '', /Codex marketplace registration failed/i);
    assert.match(result.message ?? '', /\[REDACTED\]/);
    assert.doesNotMatch(result.message ?? '', /lm_x/);
  });
});

test('codex clear token removes stale MCP auth keys', async () => {
  const { home, loreHome } = await tempHome();
  await seedCodexArtifact(loreHome);
  const cfgPath = path.join(home, '.codex', 'config.toml');
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  await fs.writeFile(
    cfgPath,
    '[mcp_servers.lore]\n' +
      'url = "https://old.example/api/mcp"\n' +
      'bearer_token_env_var = "OLD_TOKEN"\n' +
      'http_headers = { Authorization = "Bearer old" }\n' +
      'env_http_headers = { Authorization = "OLD_TOKEN" }\n',
    'utf8',
  );
  const run: ExecFn = async () => ({ code: 0, stdout: '', stderr: '' });

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({
      loreHome,
      homeDir: home,
      run,
      apiToken: undefined,
      tokenAction: 'clear',
    }));
    assert.equal(result.status, 'ok');
    const cfg = await readCodexConfig(home);
    assert.doesNotMatch(cfg, /bearer_token_env_var/);
    assert.doesNotMatch(cfg, /http_headers/);
    assert.doesNotMatch(cfg, /env_http_headers/);
    assert.match(cfg, /url = "https:\/\/core\.example\/api\/mcp\?client_type=codex"/);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(cfgPath)).mode & 0o777, 0o600);
    }
  });
});

test('codex uninstall preserves non-Lore handlers in a mixed legacy hook entry', async () => {
  const { home, loreHome } = await tempHome();
  const hooksPath = path.join(home, '.codex', 'hooks.json');
  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(
    hooksPath,
    JSON.stringify({
      description: 'mixed user hooks',
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            label: 'keep metadata',
            hooks: [
              { type: 'command', command: 'node "/root/.codex/hooks/lore/hooks/rules-inject.mjs"' },
              { type: 'command', command: 'echo keep-user-handler' },
            ],
          },
        ],
      },
    }, null, 2),
    'utf8',
  );

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.uninstall({
      loreHome,
      homeDir: home,
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
    });
    assert.equal(result.status, 'ok');
    const data = JSON.parse(await fs.readFile(hooksPath, 'utf8')) as {
      description: string;
      hooks: { SessionStart: Array<{ matcher: string; label: string; hooks: Array<{ command: string }> }> };
    };
    assert.equal(data.description, 'mixed user hooks');
    assert.equal(data.hooks.SessionStart[0].matcher, 'startup');
    assert.equal(data.hooks.SessionStart[0].label, 'keep metadata');
    assert.deepEqual(data.hooks.SessionStart[0].hooks, [
      { type: 'command', command: 'echo keep-user-handler' },
    ]);
  });
});

test('codex hook placeholder replacement remains valid JSON for quoted paths', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-cc-path-'));
  const home = path.join(
    parent,
    process.platform === 'win32' ? 'home quoted segment' : 'home "quoted\\segment',
  );
  const loreHome = path.join(home, '.lore');
  await fs.mkdir(loreHome, { recursive: true });
  await seedCodexArtifact(loreHome, {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'node "__LORE_CODEX_PLUGIN_ROOT__/hooks/rules-inject.mjs"',
            },
          ],
        },
      ],
    },
  });
  const run: ExecFn = async () => ({ code: 0, stdout: '', stderr: '' });

  await withBin(home, 'codex', async () => {
    const result = await codexInstaller.install(ctx({ loreHome, homeDir: home, run }));
    assert.equal(result.status, 'ok');
    const pluginRoot = path.join(home, '.codex', 'plugins', 'cache', 'lore', 'lore', 'local');
    const hooksPath = path.join(pluginRoot, 'hooks', 'hooks.json');
    const parsed = JSON.parse(await fs.readFile(hooksPath, 'utf8')) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    assert.match(parsed.hooks.SessionStart[0].hooks[0].command, /rules-inject\.mjs/);
    assert.ok(parsed.hooks.SessionStart[0].hooks[0].command.includes(pluginRoot.replace(/\\/g, '/')));
  });
});
