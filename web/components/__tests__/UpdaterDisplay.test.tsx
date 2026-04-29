import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../ui', () => ({
  AppAvatar: ({ avatar, alt, className }: { avatar?: React.ReactNode; alt?: string; className?: string }) => (
    <div data-app-avatar="true" data-alt={alt} className={className}>{avatar}</div>
  ),
  Tooltip: ({ title, children }: { title: React.ReactNode; children: React.ReactNode }) => <span data-tooltip={String(title)}>{children}</span>,
}));

vi.mock('../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import UpdaterDisplay, { ChannelAvatar } from '../UpdaterDisplay';

describe('UpdaterDisplay', () => {
  it('renders through the AppAvatar Lobe wrapper', () => {
    const html = renderToStaticMarkup(<ChannelAvatar clientType="claudecode" size={24} elevated />);

    expect(html).toContain('data-app-avatar="true"');
    expect(html).toContain('data-alt="Claude Code"');
  });

  it('renders Codex avatar alt text', () => {
    const html = renderToStaticMarkup(
      <UpdaterDisplay
        updaters={[{ client_type: 'codex', source: 'api:test', updated_at: '2026-04-28T10:00:00.000Z', event_count: 1 }]}
        compact
      />,
    );

    expect(html).toContain('data-alt="Codex"');
  });

  it('renders history entry click target when history handler is provided', () => {
    const html = renderToStaticMarkup(
      <UpdaterDisplay
        updaters={[{ client_type: 'claudecode', source: 'api:test', updated_at: '2026-04-28T10:00:00.000Z', event_count: 2 }]}
        onOpenHistory={() => undefined}
      />,
    );

    expect(html).toContain('role="button"');
    expect(html).toContain('data-tooltip="View history changes"');
    expect(html).not.toContain('api:test');
  });
});
