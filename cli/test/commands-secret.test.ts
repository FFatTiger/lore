import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgv } from '../src/core/args.ts';
import { runSecretGet } from '../src/commands/secret.ts';

async function withLoreHome(config: Record<string, unknown> | null, fn: (home: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lore-secret-test-'));
  try {
    if (config) {
      await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(config), 'utf8');
    }
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function captureStreams() {
  const chunks: string[] = [];
  const errChunks: string[] = [];
  return {
    stdout: { write: (text: string) => { chunks.push(text); return true; } } as unknown as NodeJS.WriteStream,
    stderr: { write: (text: string) => { errChunks.push(text); return true; } } as unknown as NodeJS.WriteStream,
    stdoutText: () => chunks.join(''),
    stderrText: () => errChunks.join(''),
  };
}

const savedConfig = {
  base_url: 'http://127.0.0.1:18922',
  api_token: 'lm_test-token-value',
};

test('secret get parses as its own command shape', () => {
  const args = parseArgv(['secret', 'get', 'API_TOKEN']);
  assert.equal(args.command, 'secret');
  assert.equal(args.secretName, 'API_TOKEN');
  assert.throws(() => parseArgv(['secret']), /Missing subcommand/);
  assert.throws(() => parseArgv(['secret', 'list']), /Unknown secret subcommand/);
  assert.throws(() => parseArgv(['secret', 'get']), /requires a secret name/);
});

test('secret get writes the exact value with no trailing newline', async () => {
  await withLoreHome(savedConfig, async (home) => {
    const streams = captureStreams();
    const fetchMock = async (url: string) => {
      assert.equal(url, 'http://127.0.0.1:18922/api/secrets/CLOUDFLARE_TOKEN');
      return Response.json({ name: 'CLOUDFLARE_TOKEN', value: 'cf-token-value' });
    };
    const code = await runSecretGet(parseArgv(['secret', 'get', 'CLOUDFLARE_TOKEN']), {
      env: { ...process.env, LORE_HOME: home },
      fetch: fetchMock as unknown as typeof fetch,
      ...streams,
    });
    assert.equal(code, 0);
    assert.equal(streams.stdoutText(), 'cf-token-value');
    assert.equal(streams.stderrText(), '');
  });
});

test('secret get verifies the bearer header it sends', async () => {
  await withLoreHome(savedConfig, async (home) => {
    const streams = captureStreams();
    let auth = '';
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).authorization;
      return Response.json({ name: 'X', value: 'v' });
    }) as unknown as typeof fetch;
    await runSecretGet(parseArgv(['secret', 'get', 'X']), {
      env: { ...process.env, LORE_HOME: home },
      fetch: fetchMock,
      ...streams,
    });
    assert.equal(auth, 'Bearer lm_test-token-value');
  });
});

test('secret get prints the Core detail for a missing secret', async () => {
  await withLoreHome(savedConfig, async (home) => {
    const streams = captureStreams();
    const fetchMock = (async () =>
      Response.json({ detail: 'Secret MISSING not found' }, { status: 404 })) as unknown as typeof fetch;
    const code = await runSecretGet(parseArgv(['secret', 'get', 'MISSING']), {
      env: { ...process.env, LORE_HOME: home },
      fetch: fetchMock,
      ...streams,
    });
    assert.equal(code, 1);
    assert.equal(streams.stderrText(), 'Secret MISSING not found\n');
    assert.equal(streams.stdoutText(), '');
  });
});

test('secret get explains unsupported servers and other HTTP errors', async () => {
  await withLoreHome(savedConfig, async (home) => {
    const noDetail = captureStreams();
    const plain404 = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    let code = await runSecretGet(parseArgv(['secret', 'get', 'X']), {
      env: { ...process.env, LORE_HOME: home },
      fetch: plain404,
      ...noDetail,
    });
    assert.equal(code, 1);
    assert.equal(noDetail.stderrText(), 'This Lore server does not support secrets\n');

    const serverError = captureStreams();
    const fetch503 = (async () =>
      Response.json({ detail: 'Secrets are not configured on this server' }, { status: 503 })) as unknown as typeof fetch;
    code = await runSecretGet(parseArgv(['secret', 'get', 'X']), {
      env: { ...process.env, LORE_HOME: home },
      fetch: fetch503,
      ...serverError,
    });
    assert.equal(code, 1);
    assert.equal(serverError.stderrText(), 'Lore server error 503: Secrets are not configured on this server\n');
  });
});

test('secret get without a saved config tells the user to install first', async () => {
  await withLoreHome(null, async (home) => {
    const streams = captureStreams();
    const fetchMock = (async () => {
      throw new Error('fetch must not be called');
    }) as unknown as typeof fetch;
    const code = await runSecretGet(parseArgv(['secret', 'get', 'X']), {
      env: { ...process.env, LORE_HOME: home },
      fetch: fetchMock,
      ...streams,
    });
    assert.equal(code, 1);
    assert.match(streams.stderrText(), /npx @loremem\/cli install/);
    assert.equal(streams.stdoutText(), '');
  });
});
