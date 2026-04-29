import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('../../../components/RecallStages', () => ({
  default: () => <div data-recall-stages="true" />,
}));

vi.mock('../../../components/UpdaterDisplay', () => ({
  ChannelAvatar: () => <span data-channel-avatar="true" />,
}));

vi.mock('../../../components/clientTypeMeta', () => ({
  KNOWN_CLIENT_TYPES: ['claudecode', 'codex'],
  clientTypeLabel: (value: unknown) => String(value || 'Legacy'),
}));

vi.mock('../../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../components/ui', () => ({
  PageCanvas: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageTitle: ({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) => <header>{title}{right}</header>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  Section: ({ children, title }: { children: React.ReactNode; title: React.ReactNode }) => <section>{title}{children}</section>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Notice: ({ children }: { children: React.ReactNode }) => <aside>{children}</aside>,
  StatCard: ({ label, value }: { label: React.ReactNode; value: React.ReactNode }) => <div data-stat-card="true">{label}{value}</div>,
  Disclosure: ({ children, trigger }: { children: React.ReactNode; trigger: React.ReactNode }) => <div>{trigger}{children}</div>,
  SegmentedTabs: () => <div data-segmented-tabs="true" />,
  AppInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input data-app-input="true" {...props} />,
  AppSelect: () => <select />,
  Table: ({ columns, rows, empty }: { columns: Array<{ key: string; label: React.ReactNode; render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode }>; rows?: Record<string, unknown>[]; empty?: string }) => {
    const keys = columns.map((column) => column.key);
    if (new Set(keys).size !== keys.length) throw new Error(`duplicate column keys: ${keys.join(',')}`);
    return (
      <table>
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{rows?.length ? rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row[column.key], row) : String(row[column.key] ?? '—')}</td>)}</tr>) : <tr><td>{empty}</td></tr>}</tbody>
      </table>
    );
  },
  inputClass: '',
  fmt: (value: unknown) => value == null ? '—' : String(value),
  trunc: (value: unknown) => String(value ?? ''),
  asNumber: (value: unknown, fallback = 0) => Number(value) || fallback,
}));

import RecallDrilldown from '../RecallDrilldown';

describe('RecallDrilldown threshold analysis', () => {
  beforeEach(() => {
    navigationState.searchParams = new URLSearchParams();
  });

  it('renders threshold analysis as the source table without summary cards or detail panels', () => {
    const html = renderToStaticMarkup(<RecallDrilldown />);

    const thresholdSection = html.slice(html.indexOf('Display threshold analysis'));
    expect(thresholdSection).toContain('<table');
    expect(thresholdSection).not.toContain('Current threshold');
    expect(thresholdSection).not.toContain('Current</div>');
    expect(thresholdSection).not.toContain('Average shown');
    expect(thresholdSection).not.toContain('Average used');
    expect(thresholdSection).not.toContain('Basis');
    expect(thresholdSection).not.toContain('Shown candidates');
  });

  it('renders threshold analysis before the filter controls', () => {
    const html = renderToStaticMarkup(<RecallDrilldown />);

    expect(html.indexOf('Display threshold analysis')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('Adjust filters')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('Adjust filters')).toBeLessThan(html.indexOf('Loading…'));
    expect(html).not.toContain('Show filters');
    expect(html).not.toContain('Hide filters');
  });

  it('keeps filter inputs out of the page body until filters are opened', () => {
    const html = renderToStaticMarkup(<RecallDrilldown />);

    expect((html.match(/data-app-input="true"/g) || []).length).toBe(0);
    expect(html).toContain('Adjust filters');
  });

  it('does not render appendix controls or content', () => {
    const html = renderToStaticMarkup(<RecallDrilldown />);

    expect(html).not.toContain('Show appendix');
    expect(html).not.toContain('Hide appendix');
    expect(html).not.toContain('By path');
    expect(html).not.toContain('By view');
    expect(html).not.toContain('Noisy nodes');
    expect(html).not.toContain('Raw events');
  });

  it('hides overview and threshold cards when a query detail is open', () => {
    navigationState.searchParams = new URLSearchParams('query_id=q1');
    const html = renderToStaticMarkup(<RecallDrilldown />);

    expect(html).not.toContain('data-stat-card="true"');
    expect(html).not.toContain('Display threshold analysis');
    expect(html).toContain('Adjust filters');
    expect(html).toContain('Loading…');
  });
});
