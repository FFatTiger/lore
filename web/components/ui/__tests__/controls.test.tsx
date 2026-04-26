import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui/es/Button/index', () => ({
  default: ({ children, className, size, type, danger, variant }: { children: React.ReactNode; className?: string; size?: string; type?: string; danger?: boolean; variant?: string }) => (
    <button className={className} data-lobe-button-size={size} data-lobe-button-type={type} data-lobe-button-danger={danger} data-lobe-button-variant={variant}>{children}</button>
  ),
}));

vi.mock('@lobehub/ui/es/Alert/index', () => ({
  default: ({ message, description, type, showIcon, icon }: { message?: React.ReactNode; description?: React.ReactNode; type?: string; showIcon?: boolean; icon?: React.ReactNode }) => (
    <aside data-lobe-alert-type={type} data-lobe-alert-show-icon={showIcon}>
      {icon && <span data-lobe-alert-icon="">{icon}</span>}
      {message && <strong>{message}</strong>}
      {description}
    </aside>
  ),
}));

vi.mock('@lobehub/ui/es/Input/InputPassword', () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@lobehub/ui/es/Input/TextArea', () => ({
  default: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@lobehub/ui/es/Avatar/index', () => ({
  default: ({ avatar, title }: { avatar?: React.ReactNode; title?: React.ReactNode }) => <div>{avatar || title}</div>,
}));

vi.mock('@lobehub/ui/es/Input/Input', () => ({
  default: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@lobehub/ui/es/Select/Select', () => ({
  default: ({ options = [], value }: { options?: Array<{ label: React.ReactNode; value: string }>; value?: string }) => (
    <select value={value} readOnly>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

vi.mock('@lobehub/ui/es/Segmented/index', () => ({
  default: ({ options = [], value }: { options?: Array<{ label: React.ReactNode; value: string }>; value?: string }) => (
    <div data-lobe-segmented="true" data-value={value}>
      {options.map((option) => <button key={option.value} type="button">{option.label}</button>)}
    </div>
  ),
}));

vi.mock('@lobehub/ui/es/Accordion/index', () => ({
  Accordion: ({ children, expandedKeys, className }: { children: React.ReactNode; expandedKeys?: React.Key[]; className?: string }) => (
    <div data-lobe-accordion="true" data-expanded-keys={(expandedKeys || []).join(',')} className={className}>{children}</div>
  ),
  AccordionItem: ({ children, title, className }: { children: React.ReactNode; title: React.ReactNode; className?: string }) => (
    <section className={className}><div>{title}</div>{children}</section>
  ),
}));

vi.mock('@lobehub/ui/es/Checkbox/index', () => ({
  default: ({ checked, children }: { checked?: boolean; children?: React.ReactNode }) => <div data-lobe-checkbox="true" data-checked={checked}>{children}</div>,
}));

vi.mock('@lobehub/ui/es/Tag/Tag', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@lobehub/ui/es/Empty/index', () => ({
  default: ({ description, title, action, icon: Icon, emoji }: { description?: React.ReactNode; title?: React.ReactNode; action?: React.ReactNode; icon?: React.ElementType; emoji?: string }) => (
    <div data-lobe-empty="true">
      {emoji && <span data-emoji={emoji} />}
      {Icon && <span data-lobe-empty-icon="true"><Icon /></span>}
      {title && <strong>{title}</strong>}
      {description && <p>{description}</p>}
      {action}
    </div>
  ),
}));

vi.mock('@lobehub/ui/es/CopyButton/index', () => ({
  default: ({ content }: { content: string }) => <button data-lobe-copy="true" data-content={content}>Copy</button>,
}));

vi.mock('@lobehub/ui/es/ActionIcon/index', () => ({
  default: ({ icon: Icon, title, size, variant, disabled, loading }: { icon: React.ElementType; title: string; size?: string; variant?: string; disabled?: boolean; loading?: boolean }) => (
    <button data-lobe-action-icon="true" data-size={size} data-variant={variant} data-loading={loading} disabled={disabled} title={title}>
      <Icon data-lobe-action-icon-icon="true" />
    </button>
  ),
}));

vi.mock('@lobehub/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@lobehub/ui')>();
  return {
    ...original,
    Tooltip: ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => (
      <span data-lobe-tooltip="true" data-title={typeof title === 'string' ? title : undefined}>
        {children}
      </span>
    ),
  };
});

import { ActionIcon, AppAvatar, AppCheckbox, AppInput, Badge, Button, CopyButton, Disclosure, Empty, Notice, SegmentedTabs, StatCard, Tooltip } from '../controls';

describe('ui controls Lobe wrappers', () => {
  it('maps secondary buttons to a green-tinted selected state for light-mode contrast', () => {
    const html = renderToStaticMarkup(<Button variant="secondary">Selected</Button>);

    expect(html).toContain('bg-sys-green/15');
    expect(html).toContain('text-sys-green');
    expect(html).toContain('border-sys-green/20');
  });

  it('keeps destructive buttons readable on red backgrounds', () => {
    const html = renderToStaticMarkup(<Button variant="destructive">Delete</Button>);

    expect(html).toContain('bg-sys-red/15');
    expect(html).toContain('!text-sys-red');
    expect(html).not.toContain('text-white');
  });

  it('renders primary buttons with blue background and type primary', () => {
    const html = renderToStaticMarkup(<Button variant="primary">Create</Button>);

    expect(html).toContain('bg-sys-blue');
    expect(html).toContain('text-white');
    expect(html).toContain('hover:bg-[#1E90FF]');
    expect(html).toContain('data-lobe-button-type="primary"');
    expect(html).not.toContain('data-lobe-button-danger="true"');
  });

  it('renders ghost buttons as transparent text-only controls', () => {
    const html = renderToStaticMarkup(<Button variant="ghost">Cancel</Button>);

    expect(html).toContain('bg-transparent');
    expect(html).toContain('text-txt-secondary');
    expect(html).toContain('hover:bg-fill-quaternary');
    expect(html).toContain('data-lobe-button-type="text"');
    expect(html).not.toContain('data-lobe-button-danger="true"');
  });

  it('maps sm size to Lobe small, md to middle, lg to large', () => {
    const sm = renderToStaticMarkup(<Button size="sm">Sm</Button>);
    const md = renderToStaticMarkup(<Button size="md">Md</Button>);
    const lg = renderToStaticMarkup(<Button size="lg">Lg</Button>);

    expect(sm).toContain('data-lobe-button-size="small"');
    expect(md).toContain('data-lobe-button-size="middle"');
    expect(lg).toContain('data-lobe-button-size="large"');
  });

  it('defaults button variant to secondary and size to md', () => {
    const html = renderToStaticMarkup(<Button>Default</Button>);

    expect(html).toContain('bg-sys-green/15');
    expect(html).toContain('data-lobe-button-size="middle"');
  });

  it('renders text content inside all button variants', () => {
    for (const [variant, label] of [['primary', 'Save'], ['secondary', 'Edit'], ['ghost', 'Back'], ['destructive', 'Remove']] as const) {
      const html = renderToStaticMarkup(<Button variant={variant}>{label}</Button>);
      expect(html).toContain(label);
    }
  });

  it('renders Notice for all four tones with message and children', () => {
    const tones = ['info', 'warning', 'danger', 'success'] as const;
    const expectedTypes: Record<string, string> = { info: 'info', warning: 'warning', danger: 'error', success: 'success' };

    for (const tone of tones) {
      const html = renderToStaticMarkup(<Notice tone={tone} title="Header">Body text</Notice>);
      expect(html).toContain('data-lobe-alert-type="' + expectedTypes[tone] + '"', `tone ${tone} should map to Lobe type ${expectedTypes[tone]}`);
      expect(html).toContain('Body text');
      expect(html).toContain('Header');
    }
  });

  it('renders Notice icon when provided', () => {
    const html = renderToStaticMarkup(
      <Notice tone="info" icon={<svg data-test-id="notice-icon" />} title="Test">
        Content
      </Notice>,
    );

    expect(html).toContain('data-test-id="notice-icon"');
    expect(html).toContain('data-lobe-alert-show-icon="true"');
  });

  it('defaults Notice tone to info', () => {
    const html = renderToStaticMarkup(<Notice>Default notice</Notice>);

    expect(html).toContain('data-lobe-alert-type="info"');
    expect(html).toContain('Default notice');
  });
  it('exports an AppInput wrapper that renders an input control', () => {
    const html = renderToStaticMarkup(<AppInput placeholder="Search memories" />);

    expect(html).toContain('Search memories');
  });

  it('exports an AppAvatar wrapper that renders avatar content', () => {
    const html = renderToStaticMarkup(<AppAvatar title="Lore" avatar="L" />);

    expect(html).toContain('L');
  });

  it('keeps Badge dot content rendering through the wrapper', () => {
    const html = renderToStaticMarkup(<Badge dot>Active</Badge>);

    expect(html).toContain('Active');
  });

  it('exports an AppCheckbox wrapper that renders Lobe Checkbox', () => {
    const html = renderToStaticMarkup(<AppCheckbox checked onValueChange={() => undefined}>Exclude boot</AppCheckbox>);

    expect(html).toContain('data-lobe-checkbox="true"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('Exclude boot');
  });

  it('renders SegmentedTabs through Lobe Segmented', () => {
    const html = renderToStaticMarkup(
      <SegmentedTabs
        value="view"
        onValueChange={() => undefined}
        options={[
          { value: 'path', label: 'By path' },
          { value: 'view', label: 'By view' },
        ]}
      />,
    );

    expect(html).toContain('data-lobe-segmented="true"');
    expect(html).toContain('data-value="view"');
    expect(html).toContain('By path');
  });

  it('renders Disclosure through Lobe Accordion', () => {
    const html = renderToStaticMarkup(
      <Disclosure open onOpenChange={() => undefined} trigger={<span>Filters</span>}>
        <div>Filter content</div>
      </Disclosure>,
    );

    expect(html).toContain('data-lobe-accordion="true"');
    expect(html).toContain('data-expanded-keys="open"');
    expect(html).toContain('bg-transparent');
    expect(html).toContain('shadow-none');
    expect(html).toContain('[&amp;_.ant-collapse-item]:border-0');
    expect(html).toContain('[&amp;_.ant-collapse-header]:p-0');
    expect(html).toContain('[&amp;_.ant-collapse-content-box]:p-0');
    expect(html).toContain('Filters');
    expect(html).toContain('Filter content');
  });

  it('renders compact StatCard larger for recall overview tabs', () => {
    const html = renderToStaticMarkup(<StatCard compact label="Merged" value="12" />);

    expect(html).toContain('p-5');
    expect(html).toContain('text-[12px]');
    expect(html).toContain('text-[30px]');
    expect(html).not.toContain('text-[26px]');
  });

  it('renders Empty through Lobe Empty with description', () => {
    const html = renderToStaticMarkup(<Empty text="Nothing here" />);

    expect(html).toContain('data-lobe-empty="true"');
    expect(html).toContain('Nothing here');
  });

  it('renders EmptyState as a deprecated alias for Empty', async () => {
    const { EmptyState } = await import('../controls');
    const html = renderToStaticMarkup(<EmptyState text="Deprecated" />);

    expect(html).toContain('data-lobe-empty="true"');
    expect(html).toContain('Deprecated');
  });

  it('renders Empty with title and icon', () => {
    const TestIcon = ({ size, className }: { size?: number; className?: string }) => <svg data-size={size} className={className} />;
    const html = renderToStaticMarkup(<Empty text="No data" title="Empty" icon={TestIcon} />);

    expect(html).toContain('<strong>Empty</strong>');
    expect(html).toContain('No data');
    expect(html).toContain('data-lobe-empty-icon="true"');
  });

  it('renders Empty with emoji and action', () => {
    const html = renderToStaticMarkup(
      <Empty text="No items" emoji="📭" action={<button data-test-action="true">Create</button>} />,
    );

    expect(html).toContain('data-emoji="📭"');
    expect(html).toContain('data-test-action="true"');
  });

  it('renders CopyButton with content', () => {
    const html = renderToStaticMarkup(<CopyButton content="https://example.com" />);

    expect(html).toContain('data-lobe-copy="true"');
    expect(html).toContain('data-content="https://example.com"');
  });

  it('renders ActionIcon with icon and title', () => {
    const TestIcon = ({ size }: { size?: number }) => <svg data-test-icon-size={size} />;
    const html = renderToStaticMarkup(<ActionIcon icon={TestIcon} title="Settings" />);

    expect(html).toContain('data-lobe-action-icon="true"');
    expect(html).toContain('data-size="small"');
    expect(html).toContain('title="Settings"');
  });

  it('renders ActionIcon with custom size, variant, and loading state', () => {
    const TestIcon = () => <svg />;
    const html = renderToStaticMarkup(
      <ActionIcon icon={TestIcon} title="Delete" size="middle" variant="filled" loading disabled />,
    );

    expect(html).toContain('data-size="middle"');
    expect(html).toContain('data-variant="filled"');
    expect(html).toContain('data-loading="true"');
    expect(html).toContain('disabled=""');
  });

  it('renders Tooltip wrapping children', () => {
    const html = renderToStaticMarkup(
      <Tooltip title="Help text">
        <button>Hover me</button>
      </Tooltip>,
    );

    expect(html).toContain('data-lobe-tooltip="true"');
    expect(html).toContain('data-title="Help text"');
    expect(html).toContain('Hover me');
  });
});
