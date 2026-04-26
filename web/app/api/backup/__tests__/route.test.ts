import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../server/auth', () => ({
  requireBearerAuth: vi.fn(),
}));
vi.mock('../../../../server/lore/jobs/registry', () => ({
  runJobNow: vi.fn(),
}));
vi.mock('../../../../server/lore/ops/backup', () => ({
  restoreDatabase: vi.fn(),
  readLocalBackup: vi.fn(),
}));

import { requireBearerAuth } from '../../../../server/auth';
import { runJobNow } from '../../../../server/lore/jobs/registry';
import { readLocalBackup, restoreDatabase } from '../../../../server/lore/ops/backup';
import { POST } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockRunJobNow = vi.mocked(runJobNow);
const mockRestoreDatabase = vi.mocked(restoreDatabase);
const mockReadLocalBackup = vi.mocked(readLocalBackup);

describe('/api/backup route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
  });

  it('runs manual backup through the job runtime and preserves the response shape', async () => {
    const backupResult = {
      local: { filename: 'backup.json', path: '/tmp/backup.json', size: 12, stats: {} },
    };
    mockRunJobNow.mockResolvedValueOnce({ job_id: 'backup', run_id: 12, result: backupResult });

    const response = await POST(new Request('http://localhost/api/backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'backup' }),
    }) as any);
    const body = await response.json();

    expect(mockRunJobNow).toHaveBeenCalledWith('backup');
    expect(response.status).toBe(200);
    expect(body).toEqual({ results: backupResult });
    expect(body.results).not.toHaveProperty('webdav');
  });

  it('restores uploaded backup data without using the job runtime', async () => {
    mockRestoreDatabase.mockResolvedValueOnce({ restored: true } as any);
    const data = { nodes: [] };

    const response = await POST(new Request('http://localhost/api/backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restore', data }),
    }) as any);
    const body = await response.json();

    expect(mockRestoreDatabase).toHaveBeenCalledWith(data);
    expect(mockRunJobNow).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual({ restored: true });
  });

  it('restores a local backup file without using the job runtime', async () => {
    mockReadLocalBackup.mockResolvedValueOnce(JSON.stringify({ nodes: [] }));
    mockRestoreDatabase.mockResolvedValueOnce({ restored: true } as any);

    const response = await POST(new Request('http://localhost/api/backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'restore-file', filename: 'backup.json' }),
    }) as any);
    const body = await response.json();

    expect(mockReadLocalBackup).toHaveBeenCalledWith('backup.json');
    expect(mockRestoreDatabase).toHaveBeenCalledWith({ nodes: [] });
    expect(mockRunJobNow).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual({ restored: true });
  });

  it('returns unauthorized without starting a backup run when auth fails', async () => {
    mockRequireBearerAuth.mockReturnValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }) as any);

    const response = await POST(new Request('http://localhost/api/backup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'backup' }),
    }) as any);

    expect(response.status).toBe(401);
    expect(mockRunJobNow).not.toHaveBeenCalled();
  });
});
