import { describe, it, expect, vi, beforeEach } from 'vitest';

const pgMocks = vi.hoisted(() => ({
  on: vi.fn(),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({ query: pgMocks.query, on: pgMocks.on }));
  return { Pool: MockPool };
});

import { Pool } from 'pg';
import { _normalizeDatabaseUrl as normalizeDatabaseUrl, _buildSslConfig as buildSslConfig, getPool } from '../../db';

beforeEach(() => {
  globalThis.__lorePgPool = undefined;
  delete process.env.DATABASE_URL;
  pgMocks.on.mockClear();
  pgMocks.query.mockClear();
  vi.mocked(Pool).mockClear();
});

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

describe('getPool', () => {
  it('logs idle client errors without throwing', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@postgres/db';

    getPool();

    expect(Pool).toHaveBeenCalledTimes(1);
    expect(pgMocks.on).toHaveBeenCalledWith('error', expect.any(Function));
    const errorHandler = pgMocks.on.mock.calls.find(([event]) => event === 'error')?.[1] as (error: Error) => void;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => errorHandler(new Error('terminating connection due to administrator command'))).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('[db] idle client error', 'terminating connection due to administrator command');

    consoleError.mockRestore();
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
