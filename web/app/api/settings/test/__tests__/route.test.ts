import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/auth', () => ({
  requireBearerAuth: vi.fn(),
}));
vi.mock('@/server/lore/llm/connectionTest', () => ({
  testSettingsConnection: vi.fn(),
}));

import { requireBearerAuth } from '@/server/auth';
import { testSettingsConnection } from '@/server/lore/llm/connectionTest';
import { POST } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockTestSettingsConnection = vi.mocked(testSettingsConnection);

describe('/api/settings/test route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireBearerAuth.mockReturnValue(null);
    mockTestSettingsConnection.mockResolvedValue({ ok: true, section: 'embedding', model: 'text-embedding-3-small' } as any);
  });

  it('tests a settings section connection with the submitted patch', async () => {
    const response = await POST(new Request('http://localhost/api/settings/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        section: 'embedding',
        patch: {
          'embedding.base_url': 'http://127.0.0.1:8090/v1',
          'embedding.model': 'text-embedding-3-small',
        },
      }),
    }) as any);
    const body = await response.json();

    expect(mockTestSettingsConnection).toHaveBeenCalledWith('embedding', {
      'embedding.base_url': 'http://127.0.0.1:8090/v1',
      'embedding.model': 'text-embedding-3-small',
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, section: 'embedding', model: 'text-embedding-3-small' });
  });

  it('returns route errors with their status code', async () => {
    mockTestSettingsConnection.mockRejectedValueOnce(Object.assign(new Error('Embedding config is missing'), { status: 400 }));

    const response = await POST(new Request('http://localhost/api/settings/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ section: 'embedding' }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe('Embedding config is missing');
  });

  it('returns unauthorized when auth fails', async () => {
    mockRequireBearerAuth.mockReturnValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }) as any);

    const response = await POST(new Request('http://localhost/api/settings/test') as any);

    expect(response.status).toBe(401);
    expect(mockTestSettingsConnection).not.toHaveBeenCalled();
  });
});
