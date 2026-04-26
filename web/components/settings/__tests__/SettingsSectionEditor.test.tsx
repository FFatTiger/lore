import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui', () => ({
  AppInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-input="true" {...props} />,
  AppPasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-password-input="true" type="password" {...props} />,
  AppSelect: ({ options = [], value }: { options?: Array<{ label: React.ReactNode; value: string }>; value?: string }) => (
    <div data-app-select="true" data-value={value}>
      {options.map((option) => <span key={option.value}>{option.label}</span>)}
    </div>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  inputClass: '',
}));

vi.mock('@/lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { FieldRow, type FieldSchema } from '../SettingsSectionEditor';

const enumSchema: FieldSchema = {
  key: 'recall.strategy',
  label: 'Strategy',
  type: 'enum',
  options: ['raw_score', 'weighted_rrf'],
  option_labels: { raw_score: 'Raw score', weighted_rrf: 'Weighted RRF' },
  section: 'recall',
};

const numberSchema: FieldSchema = {
  key: 'recall.limit',
  label: 'Limit',
  type: 'integer',
  section: 'recall',
};

const stringSchema: FieldSchema = {
  key: 'memory.view_llm_model',
  label: 'Model',
  type: 'string',
  section: 'memory',
};

const secretSchema: FieldSchema = {
  key: 'llm.api_key',
  label: 'API key',
  type: 'string',
  section: 'llm',
  secret: true,
};

const booleanSchema: FieldSchema = {
  key: 'recall.exclude_boot_from_results',
  label: 'Exclude boot',
  type: 'boolean',
  section: 'recall',
};

const readBeforeModifySchema: FieldSchema = {
  key: 'policy.read_before_modify_enabled',
  label: '改前必读检查',
  type: 'boolean',
  section: 'policy',
};

describe('SettingsSectionEditor fields', () => {
  it('renders enum fields through AppSelect instead of native select', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        schema={enumSchema}
        value="raw_score"
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(html).toContain('data-app-select="true"');
    expect(html).toContain('raw_score — Raw score');
    expect(html).not.toContain('<select');
  });

  it('renders numeric fields through AppInput instead of native input styling', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        schema={numberSchema}
        value={12}
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(html).toContain('data-app-input="true"');
    expect(html).toContain('type="number"');
  });

  it('renders enabled boolean switches with a green selected state', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        schema={booleanSchema}
        value
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('!bg-[rgba(0,122,255,0.15)]');
    expect(html).toContain('border-[rgba(0,122,255,0.35)]');
  });

  it('renders read-before-modify as a high-contrast green selected switch', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        schema={readBeforeModifySchema}
        value
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(html).toContain('改前必读检查');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('!bg-[rgba(0,122,255,0.15)]');
    expect(html).toContain('border-[rgba(0,122,255,0.35)]');
  });

  it('renders text and secret fields through Lobe input wrappers', () => {
    const textHtml = renderToStaticMarkup(
      <FieldRow
        schema={stringSchema}
        value="claude-sonnet-4-6"
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );
    const secretHtml = renderToStaticMarkup(
      <FieldRow
        schema={secretSchema}
        value=""
        source="default"
        dirty={false}
        secretConfigured
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(textHtml).toContain('data-app-input="true"');
    expect(secretHtml).toContain('data-app-password-input="true"');
    expect(secretHtml).toContain('Stored');
  });
});
