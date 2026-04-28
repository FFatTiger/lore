import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedHistoryEvent } from '../../../../server/lore/memory/history';

vi.mock('../../../../components/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-badge="true">{children}</span>,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  CodeDiff: ({ fileName, oldContent, newContent }: { fileName?: string; oldContent: string; newContent: string }) => (
    <pre data-code-diff="true">{fileName}: {oldContent} =&gt; {newContent}</pre>
  ),
  Disclosure: ({ children, open, trigger }: { children: React.ReactNode; open: boolean; trigger: React.ReactNode }) => (
    <div data-disclosure="true">{trigger}{open ? children : null}</div>
  ),
  Empty: ({ action, text, title }: { action?: React.ReactNode; text?: React.ReactNode; title?: React.ReactNode }) => (
    <div>{title}{text}{action}</div>
  ),
  PageCanvas: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageTitle: ({ description, eyebrow, right, title }: {
    description?: React.ReactNode;
    eyebrow?: React.ReactNode;
    right?: React.ReactNode;
    title?: React.ReactNode;
  }) => <header>{eyebrow}{title}{description}{right}</header>,
  Section: ({ children, right, subtitle, title }: {
    children?: React.ReactNode;
    right?: React.ReactNode;
    subtitle?: React.ReactNode;
    title?: React.ReactNode;
  }) => <section>{title}{subtitle}{right}{children}</section>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('domain=core&path=agent'),
}));

vi.mock('../../../../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../../components/ConfirmDialog', () => ({
  useConfirm: () => ({ confirm: vi.fn(), toast: vi.fn() }),
}));

vi.mock('../../../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../../components/UpdaterDisplay', () => ({
  ChannelAvatar: ({ clientType }: { clientType?: string | null }) => <span data-channel-avatar={clientType || 'legacy'} />,
}));

vi.mock('../../../../components/clientTypeMeta', () => ({
  clientTypeLabel: (clientType?: string | null) => (clientType === 'admin' ? 'Admin' : 'Legacy'),
}));

import MemoryHistoryPage, { HistoryEventCard } from '../MemoryHistoryPage';

function event(overrides: Partial<NormalizedHistoryEvent>): NormalizedHistoryEvent {
  return {
    id: 1,
    event_type: 'update',
    node_uri: 'core://agent',
    node_uuid: 'node-1',
    source: 'api:test',
    session_id: 'session-1',
    client_type: 'admin',
    before_snapshot: null,
    after_snapshot: null,
    details: {},
    created_at: '2026-04-28T10:00:00.000Z',
    diffs: [],
    rollback_supported: false,
    is_rollback: false,
    summary: 'update',
    ...overrides,
  };
}

describe('MemoryHistoryPage static rendering', () => {
  it('renders diff labels collapsed by default', () => {
    const html = renderToStaticMarkup(<HistoryEventCard event={event({
      diffs: [
        { field: 'content', kind: 'text', before: 'old body', after: 'new body' },
        { field: 'priority', kind: 'value', before: 1, after: 2 },
        { field: 'uri', kind: 'value', before: 'core://old', after: 'core://agent' },
      ],
    })} onRollback={() => undefined} rollingBack={false} t={(key) => key} />);

    expect((html.match(/data-disclosure="true"/g) || []).length).toBe(3);
    expect(html).toContain('Content');
    expect(html).toContain('Priority');
    expect(html).toContain('Move');
    expect(html).toContain('Expand');
    expect(html).toContain('Admin');
    expect(html).toContain('data-channel-avatar="admin"');
    expect(html).not.toContain('data-code-diff="true"');
    expect(html).not.toContain('old body');
    expect(html).not.toContain('new body');
    expect(html).not.toContain('core://old');
  });

  it('shows loading state before history loads', () => {
    const html = renderToStaticMarkup(<MemoryHistoryPage />);

    expect(html).toContain('skeleton');
  });

  it('shows rollback action only for supported event cards', () => {
    const onRollback = vi.fn();
    const t = (key: string) => key;
    const html = renderToStaticMarkup(
      <section>
        <HistoryEventCard event={event({ id: 10, summary: 'supported', rollback_supported: true })} onRollback={onRollback} rollingBack={false} t={t} />
        <HistoryEventCard event={event({ id: 11, event_type: 'move', summary: 'unsupported', rollback_supported: false })} onRollback={onRollback} rollingBack={false} t={t} />
      </section>,
    );

    expect(html).toContain('supported');
    expect(html).toContain('unsupported');
    expect((html.match(/Rollback/g) || []).length).toBe(1);
  });
});
