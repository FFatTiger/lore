import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTokenTransport,
  isInsecureHttpTokenTransport,
  normalizeBaseUrl,
  resolveTokenDecision,
} from '../src/core/connection.ts';

test('normalizes equivalent base URLs before comparison', () => {
  assert.equal(normalizeBaseUrl('https://CORE.example/'), 'https://core.example');
});

test('keeps a saved token only for the same normalized base URL', () => {
  assert.deepEqual(
    resolveTokenDecision({
      savedBaseUrl: 'https://core.example/',
      savedToken: 'lm_old',
      targetBaseUrl: 'https://CORE.example',
      explicitToken: false,
    }),
    { action: 'keep', apiToken: 'lm_old' },
  );
});

test('clears a saved token when the server changes', () => {
  assert.deepEqual(
    resolveTokenDecision({
      savedBaseUrl: 'https://api.loremem.com',
      savedToken: 'lm_old',
      targetBaseUrl: 'https://other.example',
      explicitToken: false,
    }),
    { action: 'clear', apiToken: undefined },
  );
});

test('sets an explicit token for a changed server', () => {
  assert.deepEqual(
    resolveTokenDecision({
      savedBaseUrl: 'https://api.loremem.com',
      savedToken: 'lm_old',
      targetBaseUrl: 'https://other.example',
      explicitToken: true,
      requestedToken: 'lm_new',
    }),
    { action: 'set', apiToken: 'lm_new' },
  );
});

test('force clear overrides same-server token reuse', () => {
  assert.deepEqual(
    resolveTokenDecision({
      savedBaseUrl: 'https://api.loremem.com',
      savedToken: 'lm_old',
      targetBaseUrl: 'https://api.loremem.com',
      explicitToken: false,
      forceClear: true,
    }),
    { action: 'clear', apiToken: undefined },
  );
});

test('detects token transport over non-loopback HTTP', () => {
  assert.equal(isInsecureHttpTokenTransport('http://192.168.1.5:18901', 'lm_x'), true);
  assert.equal(isInsecureHttpTokenTransport('http://localhost:18901', 'lm_x'), false);
  assert.equal(isInsecureHttpTokenTransport('https://core.example', 'lm_x'), false);
  assert.equal(isInsecureHttpTokenTransport('http://core.example', undefined), false);
});

test('rejects tokens over non-loopback HTTP unless explicitly allowed', () => {
  assert.throws(() => assertTokenTransport('http://192.168.1.5:18901', 'lm_x'), /HTTPS/i);
  assert.doesNotThrow(() =>
    assertTokenTransport('http://192.168.1.5:18901', 'lm_x', { allowInsecureHttp: true }),
  );
  assert.doesNotThrow(() => assertTokenTransport('http://localhost:18901', 'lm_x'));
  assert.doesNotThrow(() => assertTokenTransport('http://127.9.8.7:18901', 'lm_x'));
  assert.doesNotThrow(() => assertTokenTransport('http://[::1]:18901', 'lm_x'));
});

test('rejects unsupported URL protocols', () => {
  assert.throws(() => normalizeBaseUrl('file:///tmp/lore'), /http/i);
});
