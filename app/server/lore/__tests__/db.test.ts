import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({ query: mockQuery }));
  return { Pool: MockPool };
});

import { _normalizeDatabaseUrl as normalizeDatabaseUrl, _buildSslConfig as buildSslConfig } from '../../db';

describe('normalizeDatabaseUrl', () => {
  it('returns empty for empty input', () => {
    expect(normalizeDatabaseUrl('')).toBe('');
    expect(normalizeDatabaseUrl(undefined)).toBe('');
  });
  it('converts asyncpg scheme', () => {
    expect(normalizeDatabaseUrl('postgresql+asyncpg://user:pass@host/db')).toBe('postgresql://user:pass@host/db');
  });
  it('passes through postgresql:// unchanged', () => {
    expect(normalizeDatabaseUrl('postgresql://user:pass@host/db')).toBe('postgresql://user:pass@host/db');
  });
  it('passes through postgres:// unchanged', () => {
    expect(normalizeDatabaseUrl('postgres://user:pass@host/db')).toBe('postgres://user:pass@host/db');
  });
  it('strips unknown postgresql+ prefix', () => {
    expect(normalizeDatabaseUrl('postgresql+psycopg2://user:pass@host/db')).toBe('postgresql://user:pass@host/db');
  });
});

describe('buildSslConfig', () => {
  it('returns false for localhost', () => {
    expect(buildSslConfig('postgresql://user:pass@localhost/db')).toBe(false);
  });
  it('returns false for 127.0.0.1', () => {
    expect(buildSslConfig('postgresql://user:pass@127.0.0.1/db')).toBe(false);
  });
  it('returns false when sslmode=disable', () => {
    expect(buildSslConfig('postgresql://user:pass@remote.host/db?sslmode=disable')).toBe(false);
  });
  it('returns ssl config for remote host', () => {
    expect(buildSslConfig('postgresql://user:pass@remote.host/db')).toEqual({ rejectUnauthorized: false });
  });
  it('returns false for invalid URL', () => {
    expect(buildSslConfig('not-a-url')).toBe(false);
  });
  it('returns false for postgres hostname', () => {
    expect(buildSslConfig('postgresql://user:pass@postgres/db')).toBe(false);
  });
  it('returns false for ::1', () => {
    expect(buildSslConfig('postgresql://user:pass@[::1]/db')).toBe(false);
  });
});
