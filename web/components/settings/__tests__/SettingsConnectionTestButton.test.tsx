import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui', () => ({
  Button: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => <button {...props}>{children}</button>,
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/api', () => ({
  api: { post: vi.fn() },
}));

import {
  SettingsConnectionTestButton,
  buildSettingsConnectionTestPatch,
} from '../SettingsConnectionTestButton';
import type { SettingsData } from '../SettingsSectionEditor';

const settingsData: SettingsData = {
  schema: [
    { key: 'embedding.base_url', label: 'Embedding Base URL', type: 'string', section: 'embedding' },
    { key: 'embedding.api_key', label: 'Embedding API Key', type: 'string', section: 'embedding', secret: true },
    { key: 'embedding.model', label: 'Embedding Model', type: 'string', section: 'embedding' },
    { key: 'view_llm.base_url', label: 'View LLM Base URL', type: 'string', section: 'view_llm' },
  ],
  sections: [
    { id: 'embedding', label: 'Embedding 服务', description: '向量化模型端点' },
    { id: 'view_llm', label: 'View LLM', description: '用于视图精炼的 LLM' },
  ],
  values: {
    'embedding.base_url': 'http://127.0.0.1:8090/v1',
    'embedding.api_key': '',
    'embedding.model': 'text-embedding-3-small',
    'view_llm.base_url': 'http://127.0.0.1:8090/v1',
  },
  defaults: {},
  sources: {},
  secret_configured: {
    'embedding.api_key': true,
  },
};

describe('SettingsConnectionTestButton', () => {
  it('renders the connection test action', () => {
    const html = renderToStaticMarkup(
      <SettingsConnectionTestButton
        sectionId="embedding"
        data={settingsData}
        draft={{}}
        disabled={false}
        notify={() => undefined}
      />,
    );

    expect(html).toContain('Test connection');
  });

  it('omits stored secrets unless the user edits them', () => {
    expect(buildSettingsConnectionTestPatch('embedding', settingsData, {})).toEqual({
      'embedding.base_url': 'http://127.0.0.1:8090/v1',
      'embedding.model': 'text-embedding-3-small',
    });
    expect(buildSettingsConnectionTestPatch('embedding', settingsData, { 'embedding.api_key': 'new-secret' })).toEqual({
      'embedding.base_url': 'http://127.0.0.1:8090/v1',
      'embedding.api_key': 'new-secret',
      'embedding.model': 'text-embedding-3-small',
    });
  });
});
