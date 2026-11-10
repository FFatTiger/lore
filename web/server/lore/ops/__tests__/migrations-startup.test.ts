import { describe, expect, it, vi, beforeEach } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../../db', () => ({
  getPool: () => dbMocks,
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { runMigrations } from '../migrations';

beforeEach(() => {
  dbMocks.query.mockReset();
  process.env.LORE_DB_STARTUP_WAIT_MS = '50';
  process.env.LORE_DB_STARTUP_RETRY_MS = '1';
});

describe('runMigrations startup database readiness', () => {
  it('retries transient database connection failures before running migrations', async () => {
    const connectionError = Object.assign(new Error('connect ECONNREFUSED 192.168.107.3:5432'), {
      code: 'ECONNREFUSED',
    });
    dbMocks.query
      .mockRejectedValueOnce(connectionError)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runMigrations();

    expect(dbMocks.query).toHaveBeenCalledTimes(4);
    expect(dbMocks.query).toHaveBeenNthCalledWith(1, 'SELECT 1');
    expect(dbMocks.query).toHaveBeenNthCalledWith(2, 'SELECT 1');
    expect(dbMocks.query).toHaveBeenNthCalledWith(4, 'SELECT version FROM schema_migrations');
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('[migrations] waiting for database (ECONNREFUSED)'));

    consoleWarn.mockRestore();
    consoleLog.mockRestore();
  });
});
