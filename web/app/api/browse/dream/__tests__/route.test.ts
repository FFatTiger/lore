import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../server/auth', () => ({
  requireBearerAuth: vi.fn(),
  requireApiAuth: vi.fn(),
}));
vi.mock('../../../../../server/lore/dream/dreamDiary', () => ({
  getDreamDiary: vi.fn(),
  getDreamEntry: vi.fn(),
  getDreamConfig: vi.fn(),
  updateDreamConfig: vi.fn(),
  rollbackDream: vi.fn(),
}));
vi.mock('../../../../../server/lore/jobs/registry', () => ({
  initJobScheduler: vi.fn(),
  registerJob: vi.fn(),
  runJobNow: vi.fn(),
}));
vi.mock('../../../../../server/lore/dream/dreamWorkflow', () => ({
  isDreamWorkflowTerminalEvent: vi.fn(),
  listDreamWorkflowEvents: vi.fn(),
  subscribeDreamWorkflow: vi.fn(),
}));

import { requireBearerAuth, requireApiAuth } from '../../../../../server/auth';
import {
  getDreamDiary,
  getDreamEntry,
  getDreamConfig,
  updateDreamConfig,
  rollbackDream,
} from '../../../../../server/lore/dream/dreamDiary';
import { runJobNow } from '../../../../../server/lore/jobs/registry';
import { GET, POST } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockRequireApiAuth = vi.mocked(requireApiAuth);
const mockRunJobNow = vi.mocked(runJobNow);
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

  it('runs manual dream through the job runtime and returns the dream result body', async () => {
    const dreamResult = { id: 42, status: 'completed', summary: { activity: { write_events: 1 } } };
    mockRunJobNow.mockResolvedValueOnce({ job_id: 'dream', run_id: 7, result: dreamResult });

    const response = await POST(new Request('http://localhost/api/browse/dream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'run' }),
    }) as any);
    const body = await response.json();

    expect(mockRunJobNow).toHaveBeenCalledWith('dream');
    expect(response.status).toBe(200);
    expect(body).toEqual(dreamResult);
  });

  it('returns canonical conflict errors from dream run failures', async () => {
    mockRunJobNow.mockRejectedValueOnce(Object.assign(new Error('Dream is already running'), { status: 409 }));

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

  it('returns the diary list payload unchanged, including the recall-first summary shape', async () => {
    mockGetDreamDiary.mockResolvedValueOnce({
      entries: [
        {
          id: 1,
          status: 'completed',
          summary: {
            recall_review: { reviewed_queries: 2, possible_missed_recalls: 1 },
            durable_extraction: { created: 1, enriched: 2 },
            maintenance: { events: 3 },
            structure: { moved: 1, protected_blocks: 1, policy_blocks: 0, policy_warnings: 1 },
            activity: { recall_queries: 4, reviewed_queries: 2, write_events: 5 },
            agent: { tool_calls: 6, turns: 2 },
            index: { source_count: 10, updated_count: 2, deleted_count: 1 },
          },
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    } as any);

    const response = await GET(new Request('http://localhost/api/browse/dream?limit=20&offset=0') as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entries[0].summary.recall_review.possible_missed_recalls).toBe(1);
    expect(body.entries[0].summary.durable_extraction.created).toBe(1);
    expect(body.entries[0].summary.activity.write_events).toBe(5);
    expect(body.entries[0].summary).not.toHaveProperty('health');
    expect(body.entries[0].summary).not.toHaveProperty('dead_writes');
    expect(body.entries[0].summary).not.toHaveProperty('paths');
    expect(body.entries[0].summary).not.toHaveProperty('orphans');
  });

  it('returns the entry payload unchanged, including the recall-first summary shape', async () => {
    mockGetDreamEntry.mockResolvedValueOnce({
      id: 1,
      status: 'completed',
      summary: {
        recall_review: { reviewed_queries: 3, possible_missed_recalls: 2 },
        durable_extraction: { created: 0, enriched: 1 },
        maintenance: { events: 2 },
        structure: { moved: 1, protected_blocks: 0, policy_blocks: 1, policy_warnings: 1 },
        activity: { recall_queries: 6, reviewed_queries: 3, write_events: 4 },
        agent: { tool_calls: 5, turns: 2 },
        index: { source_count: 9, updated_count: 1, deleted_count: 0 },
      },
    } as any);

    const response = await GET(new Request('http://localhost/api/browse/dream?action=entry&id=1') as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.recall_review.reviewed_queries).toBe(3);
    expect(body.summary.durable_extraction.enriched).toBe(1);
    expect(body.summary.agent.tool_calls).toBe(5);
    expect(body.summary).not.toHaveProperty('health');
    expect(body.summary).not.toHaveProperty('dead_writes');
    expect(body.summary).not.toHaveProperty('paths');
    expect(body.summary).not.toHaveProperty('orphans');
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
