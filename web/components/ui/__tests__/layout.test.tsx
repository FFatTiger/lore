import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('antd', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <section data-antd-card="true" className={className}>{children}</section>
  ),
}));

import { Card } from '../layout';

describe('ui layout Card', () => {
  it('keeps compact padded surface styling by default', () => {
    const html = renderToStaticMarkup(<Card>Content</Card>);

    expect(html).toContain('data-antd-card="true"');
    expect(html).toContain('border border-separator-thin');
    expect(html).toContain('[&amp;_.ant-card-body]:p-4');
    expect(html).toContain('[&amp;_.ant-card-body]:md:p-5');
    expect(html).not.toContain('[&amp;_.ant-card-body]:md:p-6');
    expect(html).toContain('Content');
  });

  it('can render without padding for edge-to-edge content', () => {
    const html = renderToStaticMarkup(<Card padded={false}>Content</Card>);

    expect(html).toContain('[&amp;_.ant-card-body]:p-0');
    expect(html).not.toContain('[&amp;_.ant-card-body]:p-4');
    expect(html).not.toContain('[&amp;_.ant-card-body]:md:p-5');
  });

  it('keeps interactive hover styling when requested', () => {
    const html = renderToStaticMarkup(<Card interactive>Content</Card>);

    expect(html).toContain('hover:border-separator');
    expect(html).toContain('hover:bg-bg-raised');
  });
});
