import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getApiToken, normalizeClientType, requireBearerAuth } from '../../auth';

describe('getApiToken', () => {
  const origEnv = process.env.API_TOKEN;
  afterEach(() => {
    if (origEnv !== undefined) process.env.API_TOKEN = origEnv;
    else delete process.env.API_TOKEN;
  });

  it('returns empty string when not set', () => {
    delete process.env.API_TOKEN;
    expect(getApiToken()).toBe('');
  });
  it('returns token when set', () => {
    process.env.API_TOKEN = 'test-token';
    expect(getApiToken()).toBe('test-token');
  });
});

describe('normalizeClientType', () => {
  it('normalizes valid values', () => {
    expect(normalizeClientType('ClaudeCode')).toBe('claudecode');
    expect(normalizeClientType('openclaw')).toBe('openclaw');
    expect(normalizeClientType(' hermes ')).toBe('hermes');
    expect(normalizeClientType('Codex')).toBe('codex');
    expect(normalizeClientType('mcp')).toBe('mcp');
    expect(normalizeClientType('Admin')).toBe('admin');
  });

  it('returns null for invalid values', () => {
    expect(normalizeClientType('api')).toBeNull();
    expect(normalizeClientType('')).toBeNull();
    expect(normalizeClientType(undefined)).toBeNull();
  });
});

describe('requireBearerAuth', () => {
  const origEnv = process.env.API_TOKEN;
  afterEach(() => {
    if (origEnv !== undefined) process.env.API_TOKEN = origEnv;
    else delete process.env.API_TOKEN;
  });

  it('returns null when no token configured', () => {
    delete process.env.API_TOKEN;
    const req = { headers: new Headers() } as any;
    expect(requireBearerAuth(req)).toBeNull();
  });
  it('returns 401 for missing authorization header', () => {
    process.env.API_TOKEN = 'secret';
    const req = { headers: new Headers() } as any;
    const res = requireBearerAuth(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
  it('returns 401 for non-Bearer authorization', () => {
    process.env.API_TOKEN = 'secret';
    const req = { headers: new Headers({ authorization: 'Basic abc' }) } as any;
    const res = requireBearerAuth(req);
    expect(res!.status).toBe(401);
  });
  it('returns 401 for wrong token', () => {
    process.env.API_TOKEN = 'secret';
    const req = { headers: new Headers({ authorization: 'Bearer wrong' }) } as any;
    const res = requireBearerAuth(req);
    expect(res!.status).toBe(401);
  });
  it('returns null for correct token', () => {
    process.env.API_TOKEN = 'secret';
    const req = { headers: new Headers({ authorization: 'Bearer secret' }) } as any;
    expect(requireBearerAuth(req)).toBeNull();
  });
  it('returns 401 for empty Bearer token', () => {
    process.env.API_TOKEN = 'secret';
    const req = { headers: new Headers({ authorization: 'Bearer ' }) } as any;
    const res = requireBearerAuth(req);
    expect(res!.status).toBe(401);
  });
});
