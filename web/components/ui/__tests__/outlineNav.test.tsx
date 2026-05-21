import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OutlineNavFloatingPanel, OutlineNavGroup, OutlineNavItem, OutlineNavShell } from '../outlineNav';

describe('OutlineNav', () => {
  it('renders a line-based grouped navigation', () => {
    const html = renderToStaticMarkup(
      <OutlineNavShell title="Contents" ariaLabel="Settings sections">
        <OutlineNavGroup label="Recall">
          <OutlineNavItem active>Weights</OutlineNavItem>
          <OutlineNavItem level={1}>Display</OutlineNavItem>
        </OutlineNavGroup>
      </OutlineNavShell>,
    );

    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('Contents');
    expect(html).toContain('Recall');
    expect(html).toContain('Weights');
    expect(html).toContain('Display');
    expect(html).toContain('border-l border-separator-hairline');
    expect(html).toContain('min-h-7');
    expect(html).not.toContain('tracking-[0.04em]');
    expect(html).not.toContain('before:bg-sys-blue');
    expect(html).not.toContain('before:-translate-x-3');
  });

  it('renders the shared floating panel shell with a placeholder and footer', () => {
    const html = renderToStaticMarkup(
      <OutlineNavFloatingPanel
        title="Domains"
        ariaLabel="Memory domains"
        left="max(1.5rem, calc((100vw - 1400px) / 2 + 1.5rem))"
        breakpoint="md"
        placeholderClassName="w-52"
        panelClassName="w-52"
        footer={<code>core://root</code>}
      >
        <OutlineNavGroup label="core">
          <OutlineNavItem active>soul</OutlineNavItem>
        </OutlineNavGroup>
      </OutlineNavFloatingPanel>,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('style="left:max(1.5rem, calc((100vw - 1400px) / 2 + 1.5rem))"');
    expect(html).toContain('fixed left-6 top-1/2');
    expect(html).toContain('hidden md:flex');
    expect(html).toContain('hover-scrollbar');
    expect(html).toContain('core://root');
  });
});
