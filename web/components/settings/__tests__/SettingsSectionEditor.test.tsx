import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui', () => ({
  AppInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-input="true" {...props} />,
  AppInputNumber: (props: Record<string, unknown>) => <input data-app-input-number="true" {...props} />,
  AppPasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-password-input="true" type="password" {...props} />,
  AppTextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea data-app-text-area="true" {...props} />,
  AppSelect: ({ options = [], value }: { options?: Array<{ label: React.ReactNode; value: string }>; value?: string }) => (
    <div data-app-select="true" data-value={value}>
      {options.map((option) => <span key={option.value}>{option.label}</span>)}
    </div>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  ToggleSwitch: ({ checked, label, ...props }: Record<string, unknown> & { checked?: boolean; label?: React.ReactNode }) => (
    <button role="switch" aria-checked={checked} data-toggle-switch="true" {...props}>{label}</button>
  ),
  TextButton: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <button data-text-button="true" {...props}>{children}</button>
  ),
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { FieldRow, type FieldSchema } from '../SettingsSectionEditor';

const enumSchema: FieldSchema = {
  key: 'recall.display.mode',
  label: 'Display mode',
  type: 'enum',
  options: ['soft', 'hard'],
  option_labels: { soft: 'Soft', hard: 'Hard' },
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

const textSchema: FieldSchema = {
  key: 'lifecycle.guidance.global',
  label: 'Guidance',
  type: 'text',
  section: 'lifecycle',
};

const stringListSchema: FieldSchema = {
  key: 'dream.exclude_session_patterns',
  label: 'Excluded Dream sessions',
  type: 'string_list',
  section: 'dream',
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


describe('SettingsSectionEditor fields', () => {
  it('renders enum fields through AppSelect instead of native select', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        schema={enumSchema}
        value="soft"
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(html).toContain('data-app-select="true"');
    expect(html).toContain('soft — Soft');
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

    expect(html).toContain('data-app-input-number="true"');
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

    expect(html).toContain('data-toggle-switch="true"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
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

  it('renders long text fields through AppTextArea', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        schema={textSchema}
        value="# Lore 使用规则"
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(html).toContain('data-app-text-area="true"');
    expect(html).toContain('# Lore 使用规则');
  });

  it('renders string list fields as one value per line', () => {
    const html = renderToStaticMarkup(
      <FieldRow
        schema={stringListSchema}
        value={['^bot-', 'e2e']}
        source="default"
        dirty={false}
        secretConfigured={false}
        onChange={() => undefined}
        onReset={() => undefined}
        saving={false}
      />,
    );

    expect(html).toContain('data-app-text-area="true"');
    expect(html).toContain('^bot-');
    expect(html).toContain('e2e');
  });
});
