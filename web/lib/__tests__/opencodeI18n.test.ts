import { describe, expect, it } from 'vitest';
import { translate } from '../i18n';

describe('OpenCode localization', () => {
  it('includes Chinese setup and runtime labels for OpenCode', () => {
    expect(translate('OpenCode boot memory', 'zh')).toBe('OpenCode 启动记忆');
    expect(translate('opencode runtime constraints', 'zh')).toBe('OpenCode 运行时约束');
    expect(translate(
      'Write the OpenCode-specific native tool, context injection, attribution, and fail-open rules that load together with core://agent.',
      'zh',
    )).toContain('OpenCode 原生工具');
    expect(translate(
      'OpenCode-specific native tools, system and message hooks, lifecycle attribution, and fail-open runtime behavior.',
      'zh',
    )).toContain('生命周期归因');
  });

  it('keeps English OpenCode labels unchanged', () => {
    expect(translate('OpenCode boot memory', 'en')).toBe('OpenCode boot memory');
  });
});
