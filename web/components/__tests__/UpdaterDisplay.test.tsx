import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../ui', () => ({
  AppAvatar: ({ avatar, alt, className }: { avatar?: React.ReactNode; alt?: string; className?: string }) => (
    <div data-app-avatar="true" data-alt={alt} className={className}>{avatar}</div>
  ),
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('../lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@radix-ui/react-popover', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ChannelAvatar } from '../UpdaterDisplay';

describe('ChannelAvatar', () => {
  it('renders through the AppAvatar Lobe wrapper', () => {
    const html = renderToStaticMarkup(<ChannelAvatar clientType="claudecode" size={24} elevated />);

    expect(html).toContain('data-app-avatar="true"');
    expect(html).toContain('data-alt="Claude Code"');
  });
});
