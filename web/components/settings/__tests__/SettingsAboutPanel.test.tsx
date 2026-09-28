import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/ui', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-badge="true">{children}</span>,
  Section: ({ title, subtitle, children }: { title: React.ReactNode; subtitle: React.ReactNode; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      {children}
    </section>
  ),
}));

import { ABOUT_LINKS, compareVersions, resolveUpdateState, SettingsAboutPanel } from '../SettingsAboutPanel';

describe('compareVersions', () => {
  it('compares major.minor.patch and tolerates a v prefix', () => {
    expect(compareVersions('v1.3.24', '1.3.23')).toBe(1);
    expect(compareVersions('1.3.23', 'v1.3.23')).toBe(0);
    expect(compareVersions('1.2.9', '1.10.0')).toBe(-1);
  });

  it('ignores prerelease suffixes and rejects unparseable input', () => {
    expect(compareVersions('v1.3.24-pre.1', '1.3.23')).toBe(1);
    expect(compareVersions('latest', '1.3.23')).toBeNull();
  });
});

describe('resolveUpdateState', () => {
  const url = 'https://github.com/FFatTiger/lore/releases/tag/v1.4.0';

  it('reports a newer release with its link', () => {
    expect(resolveUpdateState('1.3.23', 'v1.4.0', url)).toEqual({ kind: 'available', tag: 'v1.4.0', url });
  });

  it('reports up to date when the running version is current or newer', () => {
    expect(resolveUpdateState('1.4.0', 'v1.4.0', url)).toEqual({ kind: 'latest' });
    expect(resolveUpdateState('1.5.0', 'v1.4.0', url)).toEqual({ kind: 'latest' });
  });

  it('is unknown when either version is missing', () => {
    expect(resolveUpdateState(undefined, 'v1.4.0', url)).toEqual({ kind: 'unknown' });
    expect(resolveUpdateState('1.3.23', undefined, url)).toEqual({ kind: 'unknown' });
  });
});

describe('SettingsAboutPanel', () => {
  it('renders the about rows and project links before data loads', () => {
    const html = renderToStaticMarkup(<SettingsAboutPanel />);
    for (const label of ['About', 'Version', 'Service status', 'License', 'Checking for updates…']) {
      expect(html).toContain(label);
    }
    for (const link of ABOUT_LINKS) {
      expect(html).toContain(`href="${link.href}"`);
    }
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });
});
