import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const stateCall = vi.hoisted(() => ({ count: 0 }));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <T,>(initial: T) => {
      stateCall.count += 1;
      if (stateCall.count === 5) return [true, vi.fn()] as const;
      return actual.useState(initial);
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('../../../components/RecallStages', () => ({
  default: () => <div data-recall-stages="true" />,
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../components/ui', () => ({
  PageCanvas: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageTitle: ({ title }: { title: React.ReactNode }) => <header>{title}</header>,
  Section: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  EmptyState: ({ text }: { text: string }) => <div>{text}</div>,
  AppCheckbox: ({ checked, children }: { checked?: boolean; children?: React.ReactNode }) => <div data-app-checkbox="true" data-checked={checked}>{children}</div>,
  AppInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-input="true" {...props} />,
  AppTextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea data-app-text-area="true" {...props} />,
  AppSelect: ({ options = [], value }: { options?: Array<{ label: React.ReactNode; value: string }>; value?: string }) => (
    <div data-app-select="true" data-value={value}>
      {options.map((option) => <span key={option.value}>{option.label}</span>)}
    </div>
  ),
  inputClass: '',
  fmt: (value: unknown) => String(value ?? '—'),
  asNumber: (value: unknown, fallback = 0) => Number(value) || fallback,
}));

import RecallWorkbench from '../RecallWorkbench';

describe('RecallWorkbench foundation controls', () => {
  it('renders advanced selectors through AppSelect instead of native select', () => {
    stateCall.count = 0;
    const html = renderToStaticMarkup(<RecallWorkbench />);

    expect(html).toContain('data-app-select="true"');
    expect((html.match(/data-app-input="true"/g) || []).length).toBe(6);
    expect(html).toContain('data-app-checkbox="true"');
    expect(html).toContain('data-app-text-area="true"');
    expect(html).not.toContain('<select');
  });
});
