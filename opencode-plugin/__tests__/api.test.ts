import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoreApiError, loreFetchJson } from '../api.js';

const config = {
  baseUrl: 'https://api.example.test',
  apiToken: 'secret',
  startupTimeoutMs: 8_000,
  requestTimeoutMs: 30_000,
  defaultDomain: 'core',
};

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Lore OpenCode REST transport', () => {
  it('sends Bearer auth, JSON, OpenCode identity, and a composed abort signal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const externalAbort = new AbortController();

    await expect(loreFetchJson(config, '/browse/search', {
      method: 'POST',
      body: { query: 'memory' },
      signal: externalAbort.signal,
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/browse/search?client_type=opencode');
    expect(request).toMatchObject({ method: 'POST', body: JSON.stringify({ query: 'memory' }) });
    expect(new Headers(request.headers)).toEqual(expect.objectContaining({}));
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer secret');
    expect(new Headers(request.headers).get('content-type')).toBe('application/json');
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.signal).not.toBe(externalAbort.signal);

    externalAbort.abort();
    expect(request.signal?.aborted).toBe(true);
  });

  it('does not send content-type or client identity for a bodyless health request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ status: 'ok' }));

    await loreFetchJson(config, '/health');

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/api/health');
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer secret');
    expect(new Headers(request.headers).has('content-type')).toBe(false);
  });

  it('maps an unauthorized response to a typed LoreApiError without leaking the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(
      { code: 'unauthorized', detail: 'invalid project token' },
      { status: 401 },
    ));

    const error = await loreFetchJson(config, '/browse/node').catch((value: unknown) => value);

    expect(error).toBeInstanceOf(LoreApiError);
    expect(error).toMatchObject({ status: 401, code: 'unauthorized' });
    expect(String(error)).not.toContain(config.apiToken);
  });

  it('rejects malformed successful JSON with invalid_json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not-json', { status: 200 }));

    await expect(loreFetchJson(config, '/browse/node')).rejects.toMatchObject({
      status: 200,
      code: 'invalid_json',
    });
  });

  it('uses the selected 8-second startup timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));

    await loreFetchJson(config, '/lifecycle/event', { timeoutMs: config.startupTimeoutMs });

    expect(timeoutSpy).toHaveBeenCalledWith(8_000);
  });

  it('propagates caller cancellation to an in-flight fetch', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    const request = loreFetchJson(config, '/browse/node', { signal: controller.signal });
    controller.abort(new Error('cancelled by OpenCode'));

    await expect(request).rejects.toThrow('cancelled by OpenCode');
  });
});
