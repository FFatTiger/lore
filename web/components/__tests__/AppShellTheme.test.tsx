import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

import { LobeThemeBridge, navIndicatorClassName } from '../AppShell';

describe('AppShell theme contrast', () => {
  it('passes the app theme into Lobe UI components', () => {
    const html = renderToStaticMarkup(<LobeThemeBridge><div>content</div></LobeThemeBridge>);

    expect(html).toContain('data-lobe-theme-provider="true"');
    expect(html).toContain('data-appearance="light"');
  });

  it('uses a visible active navigation indicator instead of a white-on-white surface', () => {
    expect(navIndicatorClassName(false)).toContain('bg-sys-blue/');
    expect(navIndicatorClassName(false)).not.toContain('bg-bg-elevated');
  });
});
