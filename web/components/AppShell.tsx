'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Moon, Sun } from 'lucide-react';
import { getDomains, getSetupFlowStatus, AUTH_ERROR_EVENT } from '../lib/api';
import { getSetupFlowDecision, SETUP_STATUS_CHANGED_EVENT, type SetupFlowStatus } from '@/lib/bootSetup';
import { LanguageProvider, useT } from '../lib/i18n';
import { ThemeProvider, useTheme } from '../lib/theme';
import TokenAuth from './TokenAuth';
import { ConfirmProvider, useConfirm } from './ConfirmDialog';
import { ActionIcon, AppUIProvider, Button, SegmentedTabs, Tabs } from './ui';
import { AxiosError } from 'axios';

const BOOT_SETUP_ACK_KEY = 'lore-boot-setup-confirmed';

interface Tab {
  href: string;
  label: string;
  match?: (pathname: string) => boolean;
}

const tabs: Tab[] = [
  { href: '/memory', label: 'Memory' },
  { href: '/recall', label: 'Recall', match: (p) => p === '/recall' },
  { href: '/recall/drilldown', label: 'Analytics', match: (p) => p === '/recall/drilldown' },
  { href: '/dream', label: 'Dream' },
  { href: '/settings', label: 'Settings' },
];

const appContentClassName = 'relative z-10 min-h-0 w-full max-w-full flex-1 overflow-x-hidden';

function LoreLogoMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
      viewBox="126 130 260 260"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        className="fill-current"
        d="M310.3 144.5A124 124 0 1 0 368.4 203.6L339.4 217.1A92 92 0 1 1 296.3 173.3Z"
      />
      <path
        className="fill-current"
        d="M224 160H270V276C270 286 276 292 286 292H356L337 321H250C234 321 224 311 224 294Z"
      />
      <circle cx="336" cy="172" r="18" className="fill-sys-orange" />
    </svg>
  );
}

export function NavDock(): React.JSX.Element {
  const pathname = usePathname() || '';
  const router = useRouter();
  const { t, lang, setLang } = useT();
  const { theme, toggleTheme } = useTheme();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => { if (mounted && data.version) setVersion(data.version); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const activeHref = useMemo((): string | null => {
    for (const tab of tabs) {
      const match = tab.match ? tab.match(pathname) : (pathname === tab.href || pathname.startsWith(`${tab.href}/`));
      if (match) return tab.href;
    }
    return null;
  }, [pathname]);

  const navItems = useMemo(() => (
    tabs.map((tab) => ({
      key: tab.href,
      label: t(tab.label),
    }))
  ), [t]);

  return (
    <header className="relative z-50 flex h-16 items-center justify-between gap-4 border-b border-separator-thin bg-bg-system px-6">
      <div className="flex min-w-0 items-center gap-8" data-shell-nav-left="true">
        <button
          className="press flex min-w-0 items-center gap-3 text-txt-primary"
          type="button"
          onClick={() => router.push('/memory')}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center text-txt-primary">
            <LoreLogoMark className="h-8 w-8" />
          </span>
          <span className="text-[15px] font-semibold">Lore</span>
          {version ? <span className="text-[12px] text-txt-tertiary">{version}</span> : null}
        </button>

        <div className="min-w-0" data-shell-nav-tabs="true">
          <Tabs
            activeKey={activeHref ?? undefined}
            items={navItems}
            onChange={(key) => router.push(key)}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ActionIcon
          icon={theme === 'dark' ? Moon : Sun}
          title={theme === 'dark' ? t('Switch to light') : t('Switch to dark')}
          onClick={toggleTheme}
        />
        <div className="ml-2 border-l border-separator-thin pl-3">
          <SegmentedTabs
            value={lang}
            options={[
              { value: 'zh', label: 'ZH' },
              { value: 'en', label: 'EN' },
            ]}
            onValueChange={(value) => {
              if (value === 'zh' || value === 'en') setLang(value);
            }}
          />
        </div>
      </div>
    </header>
  );
}

interface AppShellInnerProps {
  children: ReactNode;
}

interface AppShellFrameProps {
  children: ReactNode;
}

export function AppShellFrame({ children }: AppShellFrameProps): React.JSX.Element {
  return (
    <div className="relative flex h-screen w-full max-w-full flex-col overflow-hidden bg-bg-system text-txt-primary">
      <NavDock />
      <div className={appContentClassName}>{children}</div>
    </div>
  );
}

function AppShellInner({ children }: AppShellInnerProps): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname() || '';
  const { confirm } = useConfirm();
  const { t } = useT();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [backendError, setBackendError] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupFlowStatus | null>(null);
  const [hasCheckedSetup, setHasCheckedSetup] = useState(false);
  const [setupRefreshToken, setSetupRefreshToken] = useState(0);
  const [hasAcknowledgedSetupPrompt, setHasAcknowledgedSetupPrompt] = useState(false);
  const promptingSetupRef = useRef(false);

  const clearSetupPromptAck = useCallback(() => {
    setHasAcknowledgedSetupPrompt(false);
    promptingSetupRef.current = false;
    try {
      window.sessionStorage.removeItem(BOOT_SETUP_ACK_KEY);
    } catch {}
  }, []);

  const handleAuthError = useCallback(() => {
    setIsAuthenticated(false);
    setSetupStatus(null);
    setHasCheckedSetup(false);
    clearSetupPromptAck();
  }, [clearSetupPromptAck]);

  const handleAuthenticated = useCallback(() => {
    setIsAuthenticated(true);
    setBackendError(false);
    setSetupStatus(null);
    setHasCheckedSetup(false);
    promptingSetupRef.current = false;
    try {
      setHasAcknowledgedSetupPrompt(window.sessionStorage.getItem(BOOT_SETUP_ACK_KEY) === '1');
    } catch {
      setHasAcknowledgedSetupPrompt(false);
    }
  }, []);

  const handleSetupStatusChanged = useCallback(() => {
    setSetupRefreshToken((prev) => prev + 1);
  }, []);

  useEffect(() => {
    window.addEventListener(AUTH_ERROR_EVENT, handleAuthError);
    window.addEventListener(SETUP_STATUS_CHANGED_EVENT, handleSetupStatusChanged);
    return () => {
      window.removeEventListener(AUTH_ERROR_EVENT, handleAuthError);
      window.removeEventListener(SETUP_STATUS_CHANGED_EVENT, handleSetupStatusChanged);
    };
  }, [handleAuthError, handleSetupStatusChanged]);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        await getDomains();
        if (mounted) {
          setIsAuthenticated(true);
          setBackendError(false);
          setSetupStatus(null);
          setHasCheckedSetup(false);
          setIsCheckingAuth(false);
        }
      } catch (e) {
        if (mounted) {
          const err = e as AxiosError;
          if (!err.response) setBackendError(true);
          else if (err.response.status === 401) {
            setIsAuthenticated(false);
            setBackendError(false);
            setSetupStatus(null);
            setHasCheckedSetup(false);
          }
          setIsCheckingAuth(false);
        }
      }
    };
    void check();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let mounted = true;
    const loadSetupStatus = async () => {
      try {
        const next = await getSetupFlowStatus();
        if (mounted) {
          setSetupStatus(next);
        }
      } catch {
        if (mounted) {
          setSetupStatus(null);
        }
      } finally {
        if (mounted) {
          setHasCheckedSetup(true);
        }
      }
    };
    void loadSetupStatus();
    return () => { mounted = false; };
  }, [isAuthenticated, setupRefreshToken]);

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      setHasAcknowledgedSetupPrompt(window.sessionStorage.getItem(BOOT_SETUP_ACK_KEY) === '1');
    } catch {
      setHasAcknowledgedSetupPrompt(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!hasCheckedSetup) return;
    if (!setupStatus?.complete) return;
    clearSetupPromptAck();
  }, [clearSetupPromptAck, hasCheckedSetup, setupStatus]);

  const setupDecision = useMemo(() => {
    if (!isAuthenticated || !hasCheckedSetup) return { kind: 'none' as const, target: null };
    return getSetupFlowDecision(pathname, setupStatus, hasAcknowledgedSetupPrompt);
  }, [hasAcknowledgedSetupPrompt, hasCheckedSetup, isAuthenticated, pathname, setupStatus]);

  const setupRedirect = setupDecision.kind === 'redirect' ? setupDecision.target : null;
  const shouldPromptSetup = setupDecision.kind === 'prompt';
  const setupPromptTarget = setupDecision.target || '/setup/embedding';

  const homeFallbackRedirect = useMemo(() => {
    if (!isAuthenticated || !hasCheckedSetup) return null;
    if (setupDecision.kind !== 'none') return null;
    return pathname === '/' ? '/memory' : null;
  }, [hasCheckedSetup, isAuthenticated, pathname, setupDecision.kind]);

  useEffect(() => {
    if (!setupRedirect || setupRedirect === pathname) return;
    router.replace(setupRedirect);
  }, [pathname, router, setupRedirect]);

  useEffect(() => {
    if (!shouldPromptSetup || promptingSetupRef.current) return;
    promptingSetupRef.current = true;
    void confirm({
      title: t('Setup required'),
      message: t('Lore needs first-run setup before you can enter the normal workspace.'),
      confirmLabel: t('Continue'),
      hideCancel: true,
      dismissible: false,
    }).then((accepted) => {
      promptingSetupRef.current = false;
      if (!accepted) return;
      try {
        window.sessionStorage.setItem(BOOT_SETUP_ACK_KEY, '1');
      } catch {}
      setHasAcknowledgedSetupPrompt(true);
      router.replace(setupPromptTarget);
    });
  }, [confirm, router, setupPromptTarget, shouldPromptSetup, t]);

  useEffect(() => {
    if (!homeFallbackRedirect || homeFallbackRedirect === pathname) return;
    router.replace(homeFallbackRedirect);
  }, [homeFallbackRedirect, pathname, router]);

  if (isCheckingAuth || (isAuthenticated && !hasCheckedSetup)) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-system">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue" />
      </div>
    );
  }

  if (setupRedirect && setupRedirect !== pathname) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-system">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue" />
      </div>
    );
  }

  if (shouldPromptSetup) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-system">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-fill-tertiary border-t-sys-blue" />
      </div>
    );
  }

  if (backendError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-5 bg-bg-system px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sys-red/15">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-sys-red">
            <path d="M12 8v4m0 4h.01M12 3l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-txt-primary">{t('Unable to connect')}</h1>
          <p className="mt-1 text-[14px] text-txt-secondary">{t('Check that the backend service is running.')}</p>
        </div>
        <Button variant="primary" onClick={() => window.location.reload()}>
          {t('Try Again')}
        </Button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <TokenAuth onAuthenticated={handleAuthenticated} />;
  }

  return (
    <AppShellFrame>
      {children}
    </AppShellFrame>
  );
}

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <ThemeProvider>
      <AppUIProvider>
        <LanguageProvider>
          <ConfirmProvider>
            <AppShellInner>{children}</AppShellInner>
          </ConfirmProvider>
        </LanguageProvider>
      </AppUIProvider>
    </ThemeProvider>
  );
}
