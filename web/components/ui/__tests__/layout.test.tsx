import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui/es/Block/index', () => ({
  default: ({ children, className, clickable, padding }: { children: React.ReactNode; className?: string; clickable?: boolean; padding?: number }) => (
    <section data-lobe-block="true" data-clickable={clickable} data-padding={padding} className={className}>{children}</section>
  ),
}));

import { Card } from '../layout';

describe('ui layout Card', () => {
  it('renders through Lobe Block with default padding 16', () => {
    const html = renderToStaticMarkup(<Card>Content</Card>);

    expect(html).toContain('data-lobe-block="true"');
    expect(html).toContain('data-padding="16"');
    expect(html).toContain('border border-separator-thin');
    expect(html).toContain('Content');
  });

  it('renders with zero padding when padded is false', () => {
    const html = renderToStaticMarkup(<Card padded={false}>Content</Card>);

    expect(html).toContain('data-padding="0"');
    expect(html).not.toContain('data-padding="16"');
  });

  it('preserves interactive hover styling through clickable prop', () => {
    const html = renderToStaticMarkup(<Card interactive>Content</Card>);

    expect(html).toContain('data-clickable="true"');
    expect(html).toContain('hover:border-separator');
    expect(html).toContain('hover:bg-bg-raised');
  });
});
