import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../server/auth', () => ({
  requireBearerAuth: vi.fn(),
  requireApiAuth: vi.fn(),
}));
vi.mock('../../../../../server/lore/dream/dreamDiary', () => ({
  runDream: vi.fn(),
  getDreamDiary: vi.fn(),
  getDreamEntry: vi.fn(),
  getDreamConfig: vi.fn(),
  updateDreamConfig: vi.fn(),
  rollbackDream: vi.fn(),
}));
vi.mock('../../../../../server/lore/dream/dreamScheduler', () => ({
  initDreamScheduler: vi.fn(),
}));
vi.mock('../../../../../server/lore/dream/dreamWorkflow', () => ({
  isDreamWorkflowTerminalEvent: vi.fn(),
  listDreamWorkflowEvents: vi.fn(),
  subscribeDreamWorkflow: vi.fn(),
}));

import { requireBearerAuth, requireApiAuth } from '../../../../../server/auth';
import {
  runDream,
  getDreamDiary,
  getDreamEntry,
  getDreamConfig,
  updateDreamConfig,
  rollbackDream,
} from '../../../../../server/lore/dream/dreamDiary';
import { GET, POST } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockRequireApiAuth = vi.mocked(requireApiAuth);
const mockRunDream = vi.mocked(runDream);
const mockGetDreamDiary = vi.mocked(getDreamDiary);
const mockGetDreamEntry = vi.mocked(getDreamEntry);
const mockGetDreamConfig = vi.mocked(getDreamConfig);
const mockUpdateDreamConfig = vi.mocked(updateDreamConfig);
const mockRollbackDream = vi.mocked(rollbackDream);

describe('/api/browse/dream route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
    mockRequireApiAuth.mockReturnValue(null);
  });

  it('returns canonical not_found for missing dream entry', async () => {
    mockGetDreamEntry.mockResolvedValueOnce(null);

    const response = await GET(new Request('http://localhost/api/browse/dream?action=entry&id=999') as any);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.detail).toBe('Entry not found');
    expect(body.code).toBe('not_found');
  });

  it('returns canonical validation errors from dream GET failures', async () => {
    mockGetDreamDiary.mockRejectedValueOnce(Object.assign(new Error('Dream query rejected'), { status: 422 }));

    const response = await GET(new Request('http://localhost/api/browse/dream?limit=20&offset=0') as any);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('Dream query rejected');
    expect(body.code).toBe('validation_error');
  });

  it('returns canonical conflict errors from dream run failures', async () => {
    mockRunDream.mockRejectedValueOnce(Object.assign(new Error('Dream is already running'), { status: 409 }));

    const response = await POST(new Request('http://localhost/api/browse/dream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'run' }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.detail).toBe('Dream is already running');
    expect(body.code).toBe('conflict');
  });

  it('returns canonical validation errors from rollback failures', async () => {
    mockRollbackDream.mockRejectedValueOnce(Object.assign(new Error('Only the most recent dream can be rolled back'), { status: 422 }));

    const response = await POST(new Request('http://localhost/api/browse/dream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'rollback', id: 1 }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('Only the most recent dream can be rolled back');
    expect(body.code).toBe('validation_error');
  });

  it('returns config payload from config GET', async () => {
    mockGetDreamConfig.mockResolvedValueOnce({ enabled: true, schedule_hour: 3, timezone: 'UTC', last_run_date: null } as any);

    const response = await GET(new Request('http://localhost/api/browse/dream?action=config') as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.schedule_hour).toBe(3);
  });

  it('updates config from config POST', async () => {
    mockUpdateDreamConfig.mockResolvedValueOnce({ enabled: false, schedule_hour: 5, timezone: 'UTC', last_run_date: null } as any);

    const response = await POST(new Request('http://localhost/api/browse/dream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'config', enabled: false, schedule_hour: 5 }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.schedule_hour).toBe(5);
  });
});
