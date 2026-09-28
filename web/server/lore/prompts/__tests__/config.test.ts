import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/settings', () => ({
  getSettings: vi.fn(),
}));

import { getSettings } from '../../config/settings';
import { DEFAULT_BOOT_DRAFT_CLIENT_OPENCODE_INSTRUCTIONS, DEFAULT_BOOT_DRAFT_CLIENT_ZCODE_INSTRUCTIONS, SCHEMA_BY_KEY } from '../../config/settingsSchema';
import { loadServerPromptConfig } from '../config';

const mockGetSettings = vi.mocked(getSettings);

describe('loadServerPromptConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers the OpenCode Boot draft instructions in the Settings schema', () => {
    expect(SCHEMA_BY_KEY.get('prompts.boot_draft.instructions.client_opencode')).toMatchObject({
      section: 'prompts',
      label: 'Boot 草稿 OpenCode 说明',
      type: 'text',
      default: DEFAULT_BOOT_DRAFT_CLIENT_OPENCODE_INSTRUCTIONS,
      description: '生成 core://agent/opencode 初稿时追加的约束。',
    });
  });

  it('loads the OpenCode Boot draft setting and exposes its default', async () => {
    mockGetSettings.mockResolvedValueOnce({
      'prompts.boot_draft.instructions.client_opencode': 'Custom OpenCode instructions',
    });

    const config = await loadServerPromptConfig();

    expect(mockGetSettings.mock.calls[0]?.[0]).toContain('prompts.boot_draft.instructions.client_opencode');
    expect(config.bootDraftClientOpencodeInstructions).toBe('Custom OpenCode instructions');
  });

  it('falls back to OpenCode-specific instructions instead of Pi instructions', async () => {
    mockGetSettings.mockResolvedValueOnce({});

    const config = await loadServerPromptConfig();

    expect(config.bootDraftClientOpencodeInstructions).toBe(DEFAULT_BOOT_DRAFT_CLIENT_OPENCODE_INSTRUCTIONS);
    expect(config.bootDraftClientOpencodeInstructions).toContain('OpenCode-specific runtime defaults');
    expect(config.bootDraftClientOpencodeInstructions).toContain('experimental.chat.system.transform');
    expect(config.bootDraftClientOpencodeInstructions).toContain('chat.message');
  });

  it('registers the ZCode Boot draft instructions in the Settings schema', () => {
    expect(SCHEMA_BY_KEY.get('prompts.boot_draft.instructions.client_zcode')).toMatchObject({
      section: 'prompts',
      label: 'Boot 草稿 ZCode 说明',
      type: 'text',
      default: DEFAULT_BOOT_DRAFT_CLIENT_ZCODE_INSTRUCTIONS,
      description: '生成 core://agent/zcode 初稿时追加的约束。',
    });
  });
});
