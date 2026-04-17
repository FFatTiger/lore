import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/server/auth', () => ({
  requireBearerAuth: vi.fn(),
  normalizeClientType: vi.fn(),
}));
vi.mock('@/server/lore/memory/boot', () => ({
  bootView: vi.fn(),
}));
vi.mock('@/server/lore/memory/bootSetup', () => ({
  saveBootNodes: vi.fn(),
}));

import { normalizeClientType, requireBearerAuth } from '@/server/auth';
import { bootView } from '@/server/lore/memory/boot';
import { saveBootNodes } from '@/server/lore/memory/bootSetup';
import { GET, PUT } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockNormalizeClientType = vi.mocked(normalizeClientType);
const mockBootView = vi.mocked(bootView);
const mockSaveBootNodes = vi.mocked(saveBootNodes);
const originalApiToken = process.env.API_TOKEN;

describe('/api/browse/boot route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = 'secret';
    mockRequireBearerAuth.mockReturnValue(null);
    mockNormalizeClientType.mockReturnValue('admin');
  });

  afterEach(() => {
    if (originalApiToken !== undefined) process.env.API_TOKEN = originalApiToken;
    else delete process.env.API_TOKEN;
  });

  it('returns structured boot view from GET', async () => {
    mockBootView.mockResolvedValueOnce({
      loaded: 1,
      total: 3,
      failed: ['- core://soul: not found'],
      core_memories: [],
      recent_memories: [],
      nodes: [{ uri: 'core://agent', state: 'initialized' }],
      overall_state: 'partial',
      remaining_count: 2,
      draft_generation_available: false,
      draft_generation_reason: 'View LLM base URL is not configured.',
    } as any);

    const response = await GET(new Request('http://localhost/api/browse/boot', {
      headers: { authorization: 'Bearer secret' },
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.overall_state).toBe('partial');
    expect(body.remaining_count).toBe(2);
    expect(body.draft_generation_available).toBe(false);
  });

  it('saves boot nodes from PUT', async () => {
    mockSaveBootNodes.mockResolvedValueOnce({
      results: [
        { uri: 'core://agent', status: 'created', node_uuid: 'uuid-agent', detail: null },
      ],
    });

    const response = await PUT(new Request('http://localhost/api/browse/boot?client_type=admin', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        session_id: 'session-1',
        nodes: { 'core://agent': 'Agent rules' },
      }),
    }) as any);
    const body = await response.json();

    expect(mockNormalizeClientType).toHaveBeenCalledWith('admin');
    expect(mockSaveBootNodes).toHaveBeenCalledWith(
      { nodes: { 'core://agent': 'Agent rules' } },
      {
        source: 'api:PUT /browse/boot',
        session_id: 'session-1',
        client_type: 'admin',
      },
    );
    expect(response.status).toBe(200);
    expect(body.results[0].status).toBe('created');
  });

  it('returns route errors with status codes', async () => {
    mockSaveBootNodes.mockRejectedValueOnce(Object.assign(new Error('Unsupported boot URI'), { status: 422 }));

    const response = await PUT(new Request('http://localhost/api/browse/boot', {
      method: 'PUT',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ nodes: { 'project://alpha': 'bad' } }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('Unsupported boot URI');
    expect(body.code).toBe('validation_error');
  });

  it('returns unauthorized when auth fails', async () => {
    mockRequireBearerAuth.mockReturnValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }) as any);

    const response = await GET(new Request('http://localhost/api/browse/boot') as any);

    expect(response.status).toBe(401);
    expect(mockBootView).not.toHaveBeenCalled();
  });
});
