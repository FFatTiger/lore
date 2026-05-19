import { describe, expect, it } from 'vitest';

describe('settings schema defaults', () => {
  it('does not expose local storage paths as runtime settings', async () => {
    const { SCHEMA_BY_KEY } = await import('../settingsSchema');

    expect(SCHEMA_BY_KEY.has('review.local.path')).toBe(false);
    expect(SCHEMA_BY_KEY.has('backup.local.path')).toBe(false);
  });

  it('shows the local connection endpoint example for model service base URLs', async () => {
    const { SCHEMA_BY_KEY } = await import('../settingsSchema');

    expect(SCHEMA_BY_KEY.get('embedding.base_url')?.description).toContain('http://127.0.0.1:8090/v1');
    expect(SCHEMA_BY_KEY.get('view_llm.base_url')?.description).toContain('http://127.0.0.1:8090/v1');
  });
});
