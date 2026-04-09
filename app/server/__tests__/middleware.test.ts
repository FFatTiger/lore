import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { withAuth, jsonError, withErrorHandler } from '../middleware';

describe('jsonError', () => {
  it('returns JSON error response with default 500 status', async () => {
    const res = jsonError('Something broke');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toBe('Something broke');
  });

  it('uses custom status code', async () => {
    const res = jsonError('Not found', 404);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.detail).toBe('Not found');
  });
});

describe('withErrorHandler', () => {
  it('returns the result from the function on success', async () => {
    const expected = NextResponse.json({ ok: true });
    const result = await withErrorHandler(async () => expected);
    expect(result).toBe(expected);
  });

  it('catches errors and returns JSON error response', async () => {
    const result = await withErrorHandler(async () => {
      throw new Error('kaboom');
    });
    expect(result.status).toBe(500);
    const body = await result.json();
    expect(body.detail).toBe('kaboom');
  });

  it('uses error.status when available', async () => {
    const result = await withErrorHandler(async () => {
      const err = new Error('forbidden') as Error & { status: number };
      err.status = 403;
      throw err;
    });
    expect(result.status).toBe(403);
    const body = await result.json();
    expect(body.detail).toBe('forbidden');
  });

  it('defaults to Internal server error for non-Error throws', async () => {
    const result = await withErrorHandler(async () => {
      throw 'string throw'; // eslint-disable-line no-throw-literal
    });
    expect(result.status).toBe(500);
    const body = await result.json();
    expect(body.detail).toBe('Internal server error');
  });
});

describe('withAuth', () => {
  const origToken = process.env.API_TOKEN;
  afterEach(() => {
    if (origToken !== undefined) process.env.API_TOKEN = origToken;
    else delete process.env.API_TOKEN;
  });

  it('passes through when no token is configured', async () => {
    delete process.env.API_TOKEN;
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: new Headers() } as any;
    const result = await wrapped(req);
    expect(handler).toHaveBeenCalledTimes(1);
    const body = await result.json();
    expect(body.ok).toBe(true);
  });

  it('returns 401 when token is required but missing', async () => {
    process.env.API_TOKEN = 'secret';
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: new Headers() } as any;
    const result = await wrapped(req);
    expect(handler).not.toHaveBeenCalled();
    expect(result.status).toBe(401);
  });

  it('calls handler when valid token is provided', async () => {
    process.env.API_TOKEN = 'secret';
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: new Headers({ authorization: 'Bearer secret' }) } as any;
    const result = await wrapped(req);
    expect(handler).toHaveBeenCalledTimes(1);
    const body = await result.json();
    expect(body.ok).toBe(true);
  });

  it('returns 401 for wrong token', async () => {
    process.env.API_TOKEN = 'secret';
    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const wrapped = withAuth(handler);
    const req = { headers: new Headers({ authorization: 'Bearer wrong' }) } as any;
    const result = await wrapped(req);
    expect(handler).not.toHaveBeenCalled();
    expect(result.status).toBe(401);
  });

  it('passes context to the wrapped handler', async () => {
    delete process.env.API_TOKEN;
    const handler = vi.fn(async (_req: any, ctx: any) => NextResponse.json({ ctx }));
    const wrapped = withAuth(handler);
    const req = { headers: new Headers() } as any;
    const context = { params: { id: '1' } };
    await wrapped(req, context);
    expect(handler).toHaveBeenCalledWith(req, context);
  });
});
