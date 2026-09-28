'use client';

import React, { ChangeEvent, type CSSProperties } from 'react';
import clsx from 'clsx';
import { AppInput, AppInputNumber, AppPasswordInput, AppSelect, AppTextArea, Badge, Button, TextButton, ToggleSwitch } from '@/components/ui';
import { useT } from '@/lib/i18n';

export type SettingSource = 'db' | 'default';

export interface FieldSchema {
  key: string;
  label: string;
  type: 'number' | 'integer' | 'string' | 'text' | 'enum' | 'boolean';
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  option_labels?: Record<string, string>;
  section: string;
  secret?: boolean;
  label_en?: string;
  description_en?: string;
}

export interface SectionSchema {
  id: string;
  label: string;
  description?: string;
  label_en?: string;
  description_en?: string;
}

type LocalizedCopy = Pick<SectionSchema, 'label' | 'description' | 'label_en' | 'description_en'>;

/** Schema copy is authored in Chinese; English comes from label_en / description_en. */
export function localizedLabel(item: LocalizedCopy, lang: 'zh' | 'en'): string {
  return lang === 'en' && item.label_en ? item.label_en : item.label;
}

export function localizedDescription(item: LocalizedCopy, lang: 'zh' | 'en'): string | undefined {
  return lang === 'en' && item.description_en ? item.description_en : item.description;
}

export interface SettingsData {
  schema: FieldSchema[];
  sections: SectionSchema[];
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  sources: Record<string, SettingSource>;
  secret_configured: Record<string, boolean>;
}

export interface SectionGroup extends SectionSchema {
  items: FieldSchema[];
}

interface SourceDotProps {
  source: SettingSource;
}

function SourceDot({ source }: SourceDotProps): React.JSX.Element {
  const { t } = useT();
  const map: Record<SettingSource, { tone: string; label: string }> = {
    db: { tone: 'bg-sys-blue', label: t('Modified') },
    default: { tone: 'bg-fill-primary', label: t('Default') },
  };
  const { tone, label } = map[source] || map.default;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-txt-tertiary">
      <span className={clsx('h-1.5 w-1.5 rounded-full', tone)} />
      {label}
    </span>
  );
}

interface NumberInputProps {
  value: unknown;
  onChange: (v: number | '') => void;
  schema: FieldSchema;
  disabled: boolean;
  controlClassName?: string;
  controlStyle?: CSSProperties;
}

function NumberInput({ value, onChange, schema, disabled, controlClassName, controlStyle }: NumberInputProps): React.JSX.Element {
  const step = schema.step ?? (schema.type === 'integer' ? 1 : 0.01);
  return (
    <AppInputNumber
      step={step}
      min={schema.min}
      max={schema.max}
      value={value == null || value === '' ? null : Number(value)}
      disabled={disabled}
      onChange={(v) => onChange(v == null ? '' : Number(v) as number)}
      className={clsx('w-32 text-right tabular-nums', controlClassName)}
      style={controlStyle}
      size="md"
    />
  );
}

interface StringInputProps {
  value: unknown;
  onChange: (v: string) => void;
  disabled: boolean;
  secret?: boolean;
  secretConfigured?: boolean;
  controlClassName?: string;
  controlStyle?: CSSProperties;
}

function StringInput({
  value,
  onChange,
  disabled,
  secret = false,
  secretConfigured = false,
  controlClassName,
  controlStyle,
}: StringInputProps): React.JSX.Element {
  const { t } = useT();
  const InputComponent = secret ? AppPasswordInput : AppInput;
  return (
    <InputComponent
      value={value == null ? '' : String(value)}
      disabled={disabled}
      placeholder={secret && secretConfigured ? t('Stored') : undefined}
      autoComplete="off"
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      className={controlClassName || 'py-1.5'}
      style={controlStyle}
    />
  );
}

interface TextInputProps {
  value: unknown;
  onChange: (v: string) => void;
  disabled: boolean;
}

function TextInput({ value, onChange, disabled }: TextInputProps): React.JSX.Element {
  return (
    <AppTextArea
      value={value == null ? '' : String(value)}
      disabled={disabled}
      autoComplete="off"
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      className="min-h-48 font-mono text-[12px] leading-relaxed"
      resize
    />
  );
}

interface EnumInputProps {
  value: unknown;
  onChange: (v: string) => void;
  schema: FieldSchema;
  disabled: boolean;
  controlClassName?: string;
  controlStyle?: CSSProperties;
}

function EnumInput({ value, onChange, schema, disabled, controlClassName, controlStyle }: EnumInputProps): React.JSX.Element {
  const labels = schema.option_labels || {};
  return (
    <AppSelect
      size="md"
      mono
      disabled={disabled}
      value={value == null ? '' : String(value)}
      onValueChange={onChange}
      className={controlClassName}
      style={controlStyle}
      options={(schema.options || []).map((opt) => ({
        value: opt,
        label: labels[opt] ? `${opt} — ${labels[opt]}` : opt,
      }))}
    />
  );
}

interface BooleanInputProps {
  value: unknown;
  onChange: (v: boolean) => void;
  disabled: boolean;
}

function BooleanInput({ value, onChange, disabled }: BooleanInputProps): React.JSX.Element {
  const { t } = useT();
  const checked = Boolean(value);
  return (
    <ToggleSwitch
      checked={checked}
      onCheckedChange={(v) => onChange(v)}
      disabled={disabled}
      label={checked ? t('true') : t('false')}
    />
  );
}

interface FieldRowProps {
  schema: FieldSchema;
  value: unknown;
  source: SettingSource;
  dirty: boolean;
  secretConfigured: boolean;
  onChange: (v: unknown) => void;
  onReset: () => void;
  saving: boolean;
  controlClassName?: string;
  controlStyle?: CSSProperties;
}

export function FieldRow({
  schema,
  value,
  source,
  dirty,
  secretConfigured,
  onChange,
  onReset,
  saving,
  controlClassName,
  controlStyle,
}: FieldRowProps): React.JSX.Element {
  const { t, lang } = useT();
  const description = localizedDescription(schema, lang);
  const isWide = schema.type === 'string' || schema.type === 'text';
  const renderInput = () => {
    if (schema.type === 'number' || schema.type === 'integer') return <NumberInput value={value} onChange={onChange as (v: number | '') => void} schema={schema} disabled={saving} controlClassName={controlClassName} controlStyle={controlStyle} />;
    if (schema.type === 'enum') return <EnumInput value={value} onChange={onChange as (v: string) => void} schema={schema} disabled={saving} controlClassName={controlClassName} controlStyle={controlStyle} />;
    if (schema.type === 'boolean') return <BooleanInput value={value} onChange={onChange as (v: boolean) => void} disabled={saving} />;
    if (schema.type === 'text') return <TextInput value={value} onChange={onChange as (v: string) => void} disabled={saving} />;
    return <StringInput value={value} onChange={onChange as (v: string) => void} disabled={saving} secret={schema.secret} secretConfigured={secretConfigured} controlClassName={controlClassName} controlStyle={controlStyle} />;
  };

  return (
    <div
      className={clsx(
        'grid gap-3 md:gap-4 border-b border-separator-hairline px-4 md:px-6 py-4 last:border-b-0 transition-colors',
        isWide ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-[1fr_auto] sm:items-center',
        dirty && 'bg-sys-blue/[0.04]',
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[14px] font-medium text-txt-primary">{localizedLabel(schema, lang)}</span>
          <SourceDot source={source} />
          {schema.secret && secretConfigured && !dirty && <Badge tone="green">{t('Stored')}</Badge>}
          {dirty && <Badge tone="blue">{t('Unsaved')}</Badge>}
          {source !== 'default' && !dirty && (
            <TextButton tone="blue" onClick={onReset} disabled={saving}>
              {t('Reset')}
            </TextButton>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-[12.5px] text-txt-secondary leading-relaxed">{description}</p>
        )}
        <p className="mt-1 text-[11px] text-txt-quaternary font-mono">
          {schema.key}
          {(schema.min !== undefined || schema.max !== undefined) && <> · {t('range')} [{schema.min ?? '∞'}, {schema.max ?? '∞'}]</>}
        </p>
      </div>
      <div className={isWide ? '' : 'shrink-0'}>
        {renderInput()}
      </div>
    </div>
  );
}

interface SettingsSectionEditorProps {
  section: SectionGroup;
  data: SettingsData;
  draft: Record<string, unknown>;
  saving: boolean;
  onChange: (key: string, value: unknown) => void;
  onReset: (key: string) => void;
  right?: React.ReactNode;
  controlClassName?: string;
  controlStyle?: CSSProperties;
  hideHeader?: boolean;
}

export function SettingsSectionEditor({
  section,
  data,
  draft,
  saving,
  onChange,
  onReset,
  right,
  controlClassName,
  controlStyle,
  hideHeader = false,
}: SettingsSectionEditorProps): React.JSX.Element {
  const { lang } = useT();
  const sectionDescription = localizedDescription(section, lang);
  return (
    <>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 pt-4 md:pt-5 pb-3 md:pb-4 border-b border-separator-thin">
          <div className="min-w-0">
            <h2 className="text-[17px] md:text-[19px] font-semibold tracking-tight text-txt-primary">{localizedLabel(section, lang)}</h2>
            {sectionDescription && <p className="mt-0.5 text-[12px] md:text-[13px] text-txt-secondary">{sectionDescription}</p>}
          </div>
          {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
        </div>
      )}
      {section.items.map((schema) => {
        const effectiveValue = schema.key in draft ? draft[schema.key] : data.values[schema.key];
        return (
          <FieldRow
            key={schema.key}
            schema={schema}
            value={effectiveValue}
            source={data.sources[schema.key]}
            dirty={schema.key in draft}
            secretConfigured={data.secret_configured[schema.key] === true}
            onChange={(v) => onChange(schema.key, v)}
            onReset={() => onReset(schema.key)}
            saving={saving}
            controlClassName={controlClassName}
            controlStyle={controlStyle}
          />
        );
      })}
    </>
  );
}

export function groupSettingsSections(data: SettingsData | null): SectionGroup[] {
  if (!data) return [];
  const bySection = new Map<string, SectionGroup>(data.sections.map((section) => [section.id, { ...section, items: [] }]));
  for (const item of data.schema) {
    const section = bySection.get(item.section);
    if (section) section.items.push(item);
  }
  return [...bySection.values()];
}

export function findSettingsSection(data: SettingsData | null, sectionId: string): SectionGroup | null {
  return groupSettingsSections(data).find((section) => section.id === sectionId) || null;
}

function buildSettingsSaveLabel(count: number, t: (key: string) => string): string {
  if (count <= 0) return t('Save');
  return `${t('Save')} ${count}`;
}

function canResetField(source: SettingSource, dirty: boolean): boolean {
  return source !== 'default' && !dirty;
}

function renderSectionAction(
  node: React.ReactNode,
  condition = true,
): React.ReactNode {
  return condition ? node : null;
}

function sectionHasDirtyKey(section: SectionGroup, draft: Record<string, unknown>): boolean {
  return section.items.some((item) => item.key in draft);
}

function buildResetAllKeys(section: SectionGroup): string[] {
  return section.items.map((item) => item.key);
}

function SectionActionButton({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Button variant="secondary" onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}
