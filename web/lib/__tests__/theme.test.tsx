import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from '../theme';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function installBrowserState({ themeAttribute = 'dark' }: { themeAttribute?: string } = {}): void {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => store.set(key, value)),
      },
    },
  });

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        getAttribute: vi.fn((key: string) => (key === 'data-theme' ? themeAttribute : null)),
        setAttribute: vi.fn(),
      },
    },
  });
}

function restoreBrowserState(): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
}

function ThemeProbe(): React.JSX.Element {
  const { theme, toggleTheme } = useTheme();

  return (
    <span
      data-theme={theme}
      data-toggle-theme-type={typeof toggleTheme}
    />
  );
}

describe('ThemeProvider app theme preference', () => {
  afterEach(() => {
    restoreBrowserState();
  });

  it('reads the initial app theme from the document attribute', () => {
    installBrowserState();

    const html = renderToStaticMarkup(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-toggle-theme-type="function"');
  });

  it('restores the light theme from the document attribute', () => {
    installBrowserState({ themeAttribute: 'light' });

    const html = renderToStaticMarkup(<ThemeProvider><ThemeProbe /></ThemeProvider>);

    expect(html).toContain('data-theme="light"');
  });
});
