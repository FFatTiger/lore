import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../server/auth', () => ({
  requireBearerAuth: vi.fn(),
}));
vi.mock('../../../../server/lore/jobs/registry', () => ({
  listRegisteredJobs: vi.fn(),
  runJobNow: vi.fn(),
}));
vi.mock('../../../../server/lore/jobs/jsonSafe', async () => {
  const actual = await vi.importActual<typeof import('../../../../server/lore/jobs/jsonSafe')>('../../../../server/lore/jobs/jsonSafe');
  return actual;
});
vi.mock('../../../../server/lore/jobs/history', () => ({
  listJobRuns: vi.fn(),
}));

import { requireBearerAuth } from '../../../../server/auth';
import { listJobRuns } from '../../../../server/lore/jobs/history';
import { listRegisteredJobs, runJobNow } from '../../../../server/lore/jobs/registry';
import { GET, POST } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockListJobRuns = vi.mocked(listJobRuns);
const mockListRegisteredJobs = vi.mocked(listRegisteredJobs);
const mockRunJobNow = vi.mocked(runJobNow);

describe('/api/jobs route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
    mockListRegisteredJobs.mockReturnValue([]);
    mockListJobRuns.mockResolvedValue([]);
  });

  it('returns registered jobs without run functions and recent runs filtered by query params', async () => {
    const run = vi.fn();
    const recentRuns = [
      { id: 7, job_id: 'backup', trigger: 'manual', status: 'completed' },
    ] as any;
    mockListRegisteredJobs.mockReturnValueOnce([
      {
        id: 'backup',
        label: 'Backup',
        schedule: {
          type: 'daily',
          enabledKey: 'backup.enabled',
          hourKey: 'backup.hour',
          timezoneKey: 'backup.timezone',
          defaultHour: 3,
        },
        run,
      },
    ]);
    mockListJobRuns.mockResolvedValueOnce(recentRuns);

    const response = await GET(new Request('http://localhost/api/jobs?job_id=backup&limit=10') as any);
    const body = await response.json();

    expect(mockRequireBearerAuth).toHaveBeenCalled();
    expect(mockListJobRuns).toHaveBeenCalledWith({ job_id: 'backup', limit: 10 });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      jobs: [
        {
          id: 'backup',
          label: 'Backup',
          schedule: {
            type: 'daily',
            enabledKey: 'backup.enabled',
            hourKey: 'backup.hour',
            timezoneKey: 'backup.timezone',
            defaultHour: 3,
          },
        },
      ],
      recent_runs: recentRuns,
    });
    expect(body.jobs[0]).not.toHaveProperty('run');
  });

  it('returns unauthorized without listing jobs when GET auth fails', async () => {
    mockRequireBearerAuth.mockReturnValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }) as any);

    const response = await GET(new Request('http://localhost/api/jobs') as any);

    expect(response.status).toBe(401);
    expect(mockListRegisteredJobs).not.toHaveBeenCalled();
    expect(mockListJobRuns).not.toHaveBeenCalled();
  });

  it('runs a job immediately from POST body', async () => {
    const result = { job_id: 'dream', run_id: 42, result: { ok: true } };
    mockRunJobNow.mockResolvedValueOnce(result);

    const response = await POST(new Request('http://localhost/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: 'dream' }),
    }) as any);
    const body = await response.json();

    expect(mockRequireBearerAuth).toHaveBeenCalled();
    expect(mockRunJobNow).toHaveBeenCalledWith('dream');
    expect(response.status).toBe(200);
    expect(body).toEqual(result);
  });

  it('returns JSON-safe job results from POST', async () => {
    const circular: Record<string, unknown> = { ok: true, fn: () => 'dropped' };
    circular.self = circular;
    mockRunJobNow.mockResolvedValueOnce({ job_id: 'dream', run_id: 43, result: circular });

    const response = await POST(new Request('http://localhost/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: 'dream' }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ result_type: 'object' });
  });

  it('returns 400 when POST is missing job_id', async () => {
    const response = await POST(new Request('http://localhost/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ detail: 'Missing job_id' });
    expect(mockRunJobNow).not.toHaveBeenCalled();
  });

  it('returns error detail and status from thrown errors', async () => {
    mockRunJobNow.mockRejectedValueOnce(Object.assign(new Error('Unknown job: nope'), { status: 404 }));

    const response = await POST(new Request('http://localhost/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ job_id: 'nope' }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ detail: 'Unknown job: nope', code: 'not_found' });
  });
});
