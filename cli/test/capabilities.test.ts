import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchServerProfile, hasCapability } from '../src/core/capabilities.ts';

test('server profile enables only explicitly advertised capabilities', async () => {
  let authorization = '';
  const profile = await fetchServerProfile({
    baseUrl: 'https://core.example/',
    apiToken: 'lm_x',
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return new Response(JSON.stringify({
        edition: 'private',
        capabilities: { skills: true, unknown: false },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(authorization, 'Bearer lm_x');
  assert.deepEqual(profile, {
    base_url: 'https://core.example',
    edition: 'private',
    capabilities: { skills: true },
  });
  assert.equal(hasCapability(profile, 'https://CORE.example/', 'skills'), true);
  assert.equal(hasCapability(profile, 'https://other.example', 'skills'), false);
});

test('missing metadata, HTTP errors, and network failures fail closed', async () => {
  const missing = await fetchServerProfile({
    baseUrl: 'https://oss.example',
    fetchImpl: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  });
  assert.deepEqual(missing.capabilities, {});

  const denied = await fetchServerProfile({
    baseUrl: 'https://denied.example',
    fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
  });
  assert.deepEqual(denied.capabilities, {});

  const failed = await fetchServerProfile({
    baseUrl: 'https://offline.example',
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(failed.capabilities, {});
});
