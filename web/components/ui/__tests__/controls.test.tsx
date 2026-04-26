import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui/es/Button/index', () => ({
  default: ({ children, className }: { children: React.ReactNode; className?: string }) => <button className={className}>{children}</button>,
}));

vi.mock('@lobehub/ui/es/Alert/index', () => ({
  default: ({ description }: { description?: React.ReactNode }) => <aside>{description}</aside>,
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

import { AppAvatar, AppCheckbox, AppInput, Badge, Button, Disclosure, SegmentedTabs, StatCard } from '../controls';

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
});
