import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import {
  BACKUP_ACTIONS_SECTION_ID,
  buildSettingsOutline,
  settingsSectionAnchor,
  SettingsOutlineChips,
  SettingsOutlineSidebar,
} from '../SettingsOutline';
import type { FieldSchema, SectionGroup } from '../SettingsSectionEditor';

function field(key: string, section: string): FieldSchema {
  return { key, label: key, type: 'string', section };
}

function section(id: string, label: string, keys: string[] = []): SectionGroup {
  return { id, label, items: keys.map((key) => field(key, id)) };
}

const sections: SectionGroup[] = [
  section('cache', '缓存', ['cache.enabled']),
  section('recall_weights', '召回权重', ['recall.weights.w_exact', 'recall.weights.w_dense']),
  section('embedding', 'Embedding 服务'),
  section('backup', '数据备份'),
  section('future_section', '新分组'),
];

describe('buildSettingsOutline', () => {
  it('groups sections by purpose and keeps unknown sections reachable', () => {
    const groups = buildSettingsOutline(sections, {}, 'Backup Actions');
    expect(groups.map((group) => [group.id, group.entries.map((entry) => entry.id)])).toEqual([
      ['general', ['cache']],
      ['recall', ['recall_weights']],
      ['models', ['embedding']],
      ['maintenance', ['backup', BACKUP_ACTIONS_SECTION_ID]],
      ['other', ['future_section']],
    ]);
  });

  it('counts unsaved changes per section', () => {
    const groups = buildSettingsOutline(
      sections,
      { 'recall.weights.w_exact': 0.4, 'recall.weights.w_dense': 0.2, 'cache.enabled': false },
      'Backup Actions',
    );
    const entries = groups.flatMap((group) => group.entries);
    expect(entries.find((entry) => entry.id === 'recall_weights')?.dirtyCount).toBe(2);
    expect(entries.find((entry) => entry.id === 'cache')?.dirtyCount).toBe(1);
    expect(entries.find((entry) => entry.id === 'embedding')?.dirtyCount).toBe(0);
  });

  it('uses English section labels when the UI language is English', () => {
    const withEnglish = sections.map((s) => (s.id === 'cache' ? { ...s, label_en: 'Cache' } : s));
    const en = buildSettingsOutline(withEnglish, {}, 'Backup Actions', 'en').flatMap((g) => g.entries);
    const zh = buildSettingsOutline(withEnglish, {}, 'Backup Actions', 'zh').flatMap((g) => g.entries);
    expect(en.find((entry) => entry.id === 'cache')?.label).toBe('Cache');
    expect(zh.find((entry) => entry.id === 'cache')?.label).toBe('缓存');
    // Falls back to the authored label when no English copy exists.
    expect(en.find((entry) => entry.id === 'embedding')?.label).toBe('Embedding 服务');
  });
});

describe('SettingsOutline views', () => {
  const groups = buildSettingsOutline(sections, { 'cache.enabled': false }, 'Backup Actions');

  it('sidebar renders group headings, marks the active section, and shows dirty counts', () => {
    const html = renderToStaticMarkup(
      <SettingsOutlineSidebar groups={groups} activeId="recall_weights" onSelect={() => {}} />,
    );
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('Model services');
    expect(html).toContain('召回权重');
    expect(html).toMatch(/text-sys-blue[^>]*>.*召回权重/);
    expect(html).toMatch(/text-sys-orange[^>]*>1</);
  });

  it('chips list every section in order', () => {
    const html = renderToStaticMarkup(
      <SettingsOutlineChips groups={groups} activeId="cache" onSelect={() => {}} />,
    );
    const order = ['缓存', '召回权重', 'Embedding 服务', '数据备份', 'Backup Actions', '新分组'].map((label) =>
      html.indexOf(label),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('anchors keep the existing settings-section- prefix', () => {
    expect(settingsSectionAnchor('cache')).toBe('settings-section-cache');
  });
});
