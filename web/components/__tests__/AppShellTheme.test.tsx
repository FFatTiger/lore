import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const themeMock = vi.hoisted(() => ({
  auroraBackgroundEnabled: false,
  toggleAuroraBackground: vi.fn(),
  toggleTheme: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/memory',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@lobehub/ui', () => ({
  ConfigProvider: ({ children }: { children: React.ReactNode }) => <div data-lobe-config-provider="true">{children}</div>,
}));

vi.mock('@lobehub/ui/awesome', () => ({
  AuroraBackground: ({ children }: { children?: React.ReactNode }) => <div data-aurora-background="true">{children}</div>,
}));

vi.mock('@lobehub/ui/es/ThemeProvider/index', () => ({
  default: ({ appearance, children }: { appearance?: string; children: React.ReactNode }) => (
    <div data-lobe-theme-provider="true" data-appearance={appearance}>{children}</div>
  ),
}));

vi.mock('../TokenAuth', () => ({
  default: () => <div data-token-auth="true" />,
}));

vi.mock('../ConfirmDialog', () => ({
  ConfirmProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useConfirm: () => ({ confirm: vi.fn() }),
}));

vi.mock('../../lib/api', () => ({
  AUTH_ERROR_EVENT: 'auth-error',
  getDomains: vi.fn(() => new Promise(() => {})),
  getSetupFlowStatus: vi.fn(async () => ({ configured: true })),
}));

vi.mock('@/lib/bootSetup', () => ({
  SETUP_STATUS_CHANGED_EVENT: 'setup-status-changed',
  getSetupFlowDecision: () => ({ shouldPrompt: false }),
}));

vi.mock('../../lib/i18n', () => ({
  LANGUAGES: [
    { code: 'zh', label: '简体中文' },
    { code: 'en', label: 'English' },
  ],
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useT: () => ({ lang: 'zh', setLang: vi.fn(), t: (key: string) => key }),
}));

vi.mock('../../lib/theme', () => ({
  useTheme: () => ({
    auroraBackgroundEnabled: themeMock.auroraBackgroundEnabled,
    theme: 'light',
    toggleAuroraBackground: themeMock.toggleAuroraBackground,
    toggleTheme: themeMock.toggleTheme,
  }),
}));

vi.mock('../ui', () => ({
  AuroraBackdrop: () => <div data-aurora-background="true" />,
  AppUIProvider: ({ children }: { children: React.ReactNode }) => <div data-app-ui-provider="true">{children}</div>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  DropdownMenu: ({ items, children }: { items: Array<{ key: string; label: React.ReactNode }>; children: React.ReactNode }) => (
    <div data-dropdown="true">
      {children}
      <ul>{items.map((item) => <li key={item.key} data-menu-key={item.key}>{item.label}</li>)}</ul>
    </div>
  ),
}));

import { AppShellFrame, NavDock, navIndicatorClassName } from '../AppShell';
import { AppUIProvider } from '../ui';

describe('AppShell theme contrast', () => {
  beforeEach(() => {
    themeMock.auroraBackgroundEnabled = false;
    themeMock.toggleAuroraBackground.mockClear();
    themeMock.toggleTheme.mockClear();
  });

  it('passes the app theme through the self-owned UI provider bridge', () => {
    const html = renderToStaticMarkup(<AppUIProvider><div>content</div></AppUIProvider>);

    expect(html).toContain('data-app-ui-provider="true"');
  });

  it('uses a subtle fill background for active nav indicator', () => {
    expect(navIndicatorClassName).toContain('bg-fill-primary');
    expect(navIndicatorClassName).toContain('shadow-none');
  });

  it('renders the responsive nav dock with the final mobile behavior', () => {
    const html = renderToStaticMarkup(<NavDock />);

    expect(html).toContain('bottom-3');
    expect(html).toContain('md:bottom-auto');
    expect(html).toContain('md:top-4');
    expect(html).toContain('Enable Aurora Background');
    expect(html).not.toContain('Disable Aurora Background');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('bg-[var(--dock-bg-mobile)]');
    expect(html).toContain('md:bg-[var(--dock-bg)]');
    expect(html).not.toContain('bg-bg-elevated/80');
    expect(html).toContain('w-[min(calc(100vw-8px),24rem)] md:w-auto md:max-w-[calc(100vw-16px)]');
    expect(html).toContain('relative flex w-full items-center');
    expect(html).not.toContain('justify-between');
    expect(html).toContain('relative min-w-0 flex-1 overflow-hidden md:flex-none');
    expect(html).toContain('grid w-full grid-cols-5 items-center gap-0 overflow-hidden md:flex md:w-auto md:gap-0.5 md:overflow-x-auto');
    expect(html).toContain('min-w-0 truncate rounded-full px-1 py-2.5 text-center text-[12.5px]');
    expect(html).not.toContain('bg-[linear-gradient(to_left,var(--dock-bg-mobile),transparent)]');
    expect(html).toContain('pl-1.5 md:pl-2.5 pr-1.5 md:pr-2 py-2.5 md:py-2');
    expect(html).toContain('md:shrink-0 md:px-3.5 md:py-2 md:text-[13.5px]');
    expect(html).toContain('h-9 w-9 md:h-8 md:w-8');
    expect(html).toContain('hidden md:flex items-center gap-2');
  });

  it('renders the language switch as an icon that opens a menu of every language', () => {
    const html = renderToStaticMarkup(<NavDock />);

    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('lucide-languages');
    expect(html).toContain('data-menu-key="zh"');
    expect(html).toContain('data-menu-key="en"');
    expect(html).toContain('简体中文');
    expect(html).toContain('English');
    // Only the current language (zh) is checked.
    expect(html.match(/lucide-check/g)).toHaveLength(1);
    expect(html).toMatch(/lang="zh"[^>]*>简体中文<svg[^>]*lucide-check/);
    expect(html).not.toMatch(/>ZH</);
  });

  it('renders the aurora nav toggle as active when enabled', () => {
    themeMock.auroraBackgroundEnabled = true;

    const html = renderToStaticMarkup(<NavDock />);

    expect(html).toContain('Disable Aurora Background');
    expect(html).not.toContain('Enable Aurora Background');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('bg-sys-blue/15');
  });

  it('keeps the workspace aurora backdrop disabled by default', () => {
    const html = renderToStaticMarkup(
      <AppShellFrame auroraBackgroundEnabled={false}>
        <main>Workspace</main>
      </AppShellFrame>,
    );

    expect(html).toContain('Workspace');
    expect(html).not.toContain('data-aurora-background="true"');
  });

  it('renders the workspace aurora backdrop when enabled', () => {
    const html = renderToStaticMarkup(
      <AppShellFrame auroraBackgroundEnabled>
        <main>Workspace</main>
      </AppShellFrame>,
    );

    expect(html).toContain('Workspace');
    expect(html).toContain('data-aurora-background="true"');
  });
});
