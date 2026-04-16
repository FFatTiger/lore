import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/server/auth', () => ({
  requireBearerAuth: vi.fn(),
}));
vi.mock('@/server/lore/memory/bootSetup', () => ({
  generateBootDrafts: vi.fn(),
}));

import { requireBearerAuth } from '@/server/auth';
import { generateBootDrafts } from '@/server/lore/memory/bootSetup';
import { POST } from '../route';

const mockRequireBearerAuth = vi.mocked(requireBearerAuth);
const mockGenerateBootDrafts = vi.mocked(generateBootDrafts);
const originalApiToken = process.env.API_TOKEN;

describe('/api/browse/boot/draft route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = 'secret';
    mockRequireBearerAuth.mockReturnValue(null);
  });

  afterEach(() => {
    if (originalApiToken !== undefined) process.env.API_TOKEN = originalApiToken;
    else delete process.env.API_TOKEN;
  });

  it('generates boot drafts from POST', async () => {
    mockGenerateBootDrafts.mockResolvedValueOnce({
      model: 'glm-5.1',
      results: [
        { uri: 'core://agent', status: 'generated', content: '你会直接执行。', detail: null },
      ],
    });

    const response = await POST(new Request('http://localhost/api/browse/boot/draft', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        uris: ['core://agent'],
        shared_context: '偏工程执行。',
        node_context: { 'core://agent': '强调执行边界。' },
      }),
    }) as any);
    const body = await response.json();

    expect(mockGenerateBootDrafts).toHaveBeenCalledWith({
      uris: ['core://agent'],
      shared_context: '偏工程执行。',
      node_context: { 'core://agent': '强调执行边界。' },
    });
    expect(response.status).toBe(200);
    expect(body.model).toBe('glm-5.1');
  });

  it('returns route errors with status codes', async () => {
    mockGenerateBootDrafts.mockRejectedValueOnce(Object.assign(new Error('View LLM unavailable'), { status: 409 }));

    const response = await POST(new Request('http://localhost/api/browse/boot/draft', {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ uris: ['core://agent'] }),
    }) as any);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.detail).toBe('View LLM unavailable');
  });

  it('returns unauthorized when auth fails', async () => {
    mockRequireBearerAuth.mockReturnValueOnce(new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 }) as any);

    const response = await POST(new Request('http://localhost/api/browse/boot/draft') as any);

    expect(response.status).toBe(401);
    expect(mockGenerateBootDrafts).not.toHaveBeenCalled();
  });
});
