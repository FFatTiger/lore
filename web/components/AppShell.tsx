'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sun, Moon } from 'lucide-react';
import { ConfigProvider } from '@lobehub/ui';
import LobeThemeProvider from '@lobehub/ui/es/ThemeProvider/index';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { getDomains, getSetupFlowStatus, AUTH_ERROR_EVENT } from '../lib/api';
import { getSetupFlowDecision, SETUP_STATUS_CHANGED_EVENT, type SetupFlowStatus } from '@/lib/bootSetup';
import { LanguageProvider, useT } from '../lib/i18n';
import { ThemeProvider, useTheme } from '../lib/theme';
import TokenAuth from './TokenAuth';
import { ConfirmProvider, useConfirm } from './ConfirmDialog';
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
  { href: '/maintenance', label: 'Cleanup' },
  { href: '/dream', label: 'Dream' },
  { href: '/settings', label: 'Settings' },
];

export function navIndicatorClassName(isHovering: boolean): string {
  return isHovering ? 'bg-fill-primary shadow-none' : 'bg-sys-blue/12 shadow-[inset_0_0_0_1px_rgba(64,156,255,0.18)]';
}

export function LobeThemeBridge({ children }: { children: ReactNode }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <LobeThemeProvider appearance={theme === 'light' ? 'light' : 'dark'} enableCustomFonts={false} enableGlobalStyle={false}>
      {children}
    </LobeThemeProvider>
  );
}

interface IndicatorState {
  x: number;
  w: number;
  ready: boolean;
}

function NavDock(): React.JSX.Element {
  const pathname = usePathname() || '';
  const router = useRouter();
  const { t, lang, setLang } = useT();
  const { theme, toggleTheme } = useTheme();
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [hoverHref, setHoverHref] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<IndicatorState>({ x: 0, w: 0, ready: false });
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

  const targetHref = hoverHref || activeHref;

  useEffect(() => {
    if (!targetHref || !navRef.current) return;
    const measure = () => {
      const el = tabRefs.current.get(targetHref);
      if (!el || !navRef.current) return;
      const navRect = navRef.current.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scrollLeft = navRef.current.scrollLeft || 0;
      setIndicator({ x: elRect.left - navRect.left + scrollLeft, w: elRect.width, ready: true });
    };
    requestAnimationFrame(measure);
    const nav = navRef.current;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    nav.addEventListener('scroll', measure, { passive: true });
    return () => { ro.disconnect(); nav.removeEventListener('scroll', measure); };
  }, [targetHref, pathname]);

  return (
    <header className="fixed top-3 md:top-4 left-1/2 z-50 max-w-[calc(100vw-16px)]" style={{ transform: 'translateX(-50%)' }}>
      <div className="animate-in relative flex items-center gap-0.5 md:gap-1.5 rounded-full border border-separator-thin bg-bg-elevated/80 backdrop-blur-2xl backdrop-saturate-150 pl-1.5 md:pl-2.5 pr-1 md:pr-2 py-1.5 md:py-2 shadow-dock">
        <button
          onClick={() => router.push('/memory')}
          className="press flex items-center gap-1.5 md:gap-2 rounded-full pl-0.5 md:pl-1 pr-1.5 md:pr-2.5 py-1 hover:bg-fill-quaternary transition-colors"
        >
          <div className="flex h-6 w-6 md:h-7 md:w-7 items-center justify-center rounded-lg md:rounded-xl bg-gradient-to-br from-sys-blue to-sys-indigo">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-white md:hidden">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="9.5" cy="5" r="1.5" fill="currentColor" />
            </svg>
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" className="text-white hidden md:block">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="9.5" cy="5" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <span className="hidden md:inline text-[14px] font-semibold tracking-tight text-txt-primary">Lore</span>
          {version && (
            <span className="hidden md:inline text-[10px] text-txt-tertiary/60 font-normal select-none -ml-0.5">{version}</span>
          )}
        </button>

        <div className="hidden md:block h-5 w-px bg-separator-thin mx-0.5" />

        <div className="relative overflow-hidden">
          <nav
            ref={navRef}
            className="relative flex items-center gap-0.5 overflow-x-auto no-scrollbar"
            onMouseLeave={() => setHoverHref(null)}
          >
            <div
              aria-hidden
              className={clsx(
                'pointer-events-none absolute inset-y-0 rounded-full transition-all duration-300 ease-spring',
                indicator.ready ? 'opacity-100' : 'opacity-0',
                navIndicatorClassName(Boolean(hoverHref)),
              )}
              style={{ transform: `translateX(${indicator.x}px)`, width: `${indicator.w}px` }}
            />
            {tabs.map((tab) => {
              const isActive = activeHref === tab.href;
              const isHover = hoverHref === tab.href;
              const showAsActive = isActive && !hoverHref;
              return (
                <button
                  key={tab.href}
                  ref={(el) => { if (el) tabRefs.current.set(tab.href, el); }}
                  onMouseEnter={() => setHoverHref(tab.href)}
                  onClick={() => router.push(tab.href)}
                  className={clsx(
                    'press relative z-10 shrink-0 rounded-full px-2.5 md:px-3.5 py-1.5 md:py-2 text-[12px] md:text-[13.5px] transition-colors duration-200 ease-spring',
                    showAsActive
                      ? 'font-semibold text-sys-blue'
                      : isHover
                        ? 'font-medium text-txt-primary'
                        : 'font-medium text-txt-secondary/90',
                  )}
                >
                  {t(tab.label)}
                </button>
              );
            })}
          </nav>
          <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--bg-elevated)] to-transparent md:hidden" />
        </div>

        <div className="hidden md:block h-5 w-px bg-separator-thin mx-0.5" />

        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? t('Switch to light') : t('Switch to dark')}
          title={theme === 'dark' ? t('Switch to light') : t('Switch to dark')}
          className="press flex h-7 w-7 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-full text-txt-secondary hover:bg-fill-quaternary hover:text-txt-primary transition-colors"
        >
          {theme === 'dark'
            ? <Moon size={14} strokeWidth={2} />
            : <Sun size={14} strokeWidth={2} />}
        </button>

        <div className="hidden sm:flex items-center rounded-full bg-fill-quaternary p-[3px]">
          {(['zh', 'en'] as const).map((code) => (
            <button
              key={code}
              onClick={() => setLang(code)}
              className={clsx(
                'press rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors',
                lang === code ? 'bg-bg-raised text-txt-primary shadow-sm' : 'text-txt-tertiary hover:text-txt-secondary',
              )}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

interface AppShellInnerProps {
  children: ReactNode;
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
      message: t('Lore needs boot initialization before you can enter the normal workspace.'),
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
        <button
          onClick={() => window.location.reload()}
          className="press mt-2 h-9 rounded-full bg-sys-blue px-5 text-[13px] font-medium text-white hover:bg-[#1E90FF]"
        >
          {t('Try Again')}
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <TokenAuth onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="relative h-screen w-full max-w-full overflow-hidden bg-bg-system text-txt-primary">
      <NavDock />
      <div className="h-full w-full max-w-full overflow-x-hidden pt-[60px] md:pt-[80px]">{children}</div>
    </div>
  );
}

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps): React.JSX.Element {
  return (
    <ThemeProvider>
      <ConfigProvider motion={motion}>
        <LobeThemeBridge>
          <LanguageProvider>
            <ConfirmProvider>
              <AppShellInner>{children}</AppShellInner>
            </ConfirmProvider>
          </LanguageProvider>
        </LobeThemeBridge>
      </ConfigProvider>
    </ThemeProvider>
  );
}
