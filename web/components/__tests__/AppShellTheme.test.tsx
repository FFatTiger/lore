import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const themeMock = vi.hoisted(() => ({
  toggleTheme: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/memory',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@lobehub/ui', () => ({
  ConfigProvider: ({ children }: { children: React.ReactNode }) => <div data-lobe-config-provider="true">{children}</div>,
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
  LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useT: () => ({ lang: 'zh', setLang: vi.fn(), t: (key: string) => key }),
}));

vi.mock('../../lib/theme', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: themeMock.toggleTheme,
  }),
}));

vi.mock('../ui', () => ({
  ActionIcon: ({ icon: Icon, title }: { icon: React.ElementType; title: string }) => (
    <button data-action-icon="true" title={title}>
      <Icon />
    </button>
  ),
  AppUIProvider: ({ children }: { children: React.ReactNode }) => <div data-app-ui-provider="true">{children}</div>,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  SegmentedTabs: ({ options = [], value }: { options?: Array<{ value: string; label: React.ReactNode }>; value?: string }) => (
    <div data-segmented-tabs="true" data-value={value}>
      {options.map((option) => <button key={option.value}>{option.label}</button>)}
    </div>
  ),
  Tabs: ({ activeKey, items = [] }: {
    activeKey?: string;
    items?: Array<{ key: string; label: React.ReactNode }>;
  }) => {
    return (
      <div data-lobe-tabs="true" data-active-key={activeKey}>
        {items.map((item) => <button key={item.key} data-tab-key={item.key}>{item.label}</button>)}
      </div>
    );
  },
}));

import { AppShellFrame, NavDock } from '../AppShell';
import { AppUIProvider } from '../ui';

describe('AppShell theme contrast', () => {
  beforeEach(() => {
    themeMock.toggleTheme.mockClear();
  });

  it('passes the app theme through the self-owned UI provider bridge', () => {
    const html = renderToStaticMarkup(<AppUIProvider><div>content</div></AppUIProvider>);

    expect(html).toContain('data-app-ui-provider="true"');
  });

  it('renders the workspace header around one default Lobe Tabs surface', () => {
    const html = renderToStaticMarkup(<NavDock />);

    expect((html.match(/data-lobe-tabs="true"/g) || []).length).toBe(1);
    expect(html).toContain('data-active-key="/memory"');
    expect(html).toContain('data-tab-key="/memory"');
    expect(html).toContain('data-tab-key="/recall"');
    expect(html).toContain('data-tab-key="/recall/drilldown"');
    expect(html).toContain('Lore');
    expect(html).toContain('data-shell-nav-left="true"');
    expect(html).toContain('data-shell-nav-tabs="true"');
    expect((html.match(/data-action-icon="true"/g) || []).length).toBe(1);
    expect(html).not.toContain('Enable Aurora Background');
    expect(html).not.toContain('Disable Aurora Background');
    expect(html).toContain('data-segmented-tabs="true"');
    expect(html).toContain('ZH');
    expect(html).not.toContain('bottom-3');
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]');
    expect(html).not.toContain('bg-[var(--dock-bg-mobile)]');
  });

  it('renders the workspace frame without an aurora backdrop layer', () => {
    const html = renderToStaticMarkup(
      <AppShellFrame>
        <main>Workspace</main>
      </AppShellFrame>,
    );

    expect(html).toContain('Workspace');
    expect(html).not.toContain('data-aurora-background="true"');
  });
});
