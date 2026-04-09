'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sun, Moon } from 'lucide-react';
import clsx from 'clsx';
import { getDomains, AUTH_ERROR_EVENT } from '../lib/api';
import { LanguageProvider, useT } from '../lib/i18n';
import { ThemeProvider, useTheme } from '../lib/theme';
import TokenAuth from './TokenAuth';
import { ConfirmProvider } from './ConfirmDialog';
import { AxiosError } from 'axios';

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
  { href: '/dream', label: '梦境' },
  { href: '/settings', label: 'Settings' },
];

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
      // scrollLeft is needed because translateX is relative to the nav content origin,
      // but getBoundingClientRect is viewport-relative. When the nav overflows on
      // mobile and scrolls, the viewport rects shift but the content origin doesn't.
      const scrollLeft = navRef.current.scrollLeft || 0;
      setIndicator({ x: elRect.left - navRect.left + scrollLeft, w: elRect.width, ready: true });
    };
    // Measure after paint so fonts and layout are settled
    requestAnimationFrame(measure);
    // Re-measure on resize (e.g. orientation change, font load)
    const nav = navRef.current;
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    // Also re-measure on scroll (user swipes through tabs on mobile)
    nav.addEventListener('scroll', measure, { passive: true });
    return () => { ro.disconnect(); nav.removeEventListener('scroll', measure); };
  }, [targetHref, pathname]);

  return (
    <header className="fixed top-3 md:top-4 left-1/2 z-50 max-w-[calc(100vw-16px)]" style={{ transform: 'translateX(-50%)' }}>
      <div className="animate-in relative flex items-center gap-0.5 md:gap-1.5 rounded-full border border-separator-thin bg-bg-elevated/80 backdrop-blur-2xl backdrop-saturate-150 pl-1.5 md:pl-2.5 pr-1 md:pr-2 py-1.5 md:py-2 shadow-dock">
        {/* brand */}
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

        {/* tabs with sliding pill */}
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
              hoverHref ? 'bg-fill-primary' : 'bg-sys-blue/15',
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
                      : 'font-medium text-txt-secondary',
                )}
              >
                {t(tab.label)}
              </button>
            );
          })}
        </nav>
        {/* Fade hint for scrollable tabs on mobile */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--bg-elevated)] to-transparent md:hidden" />
        </div>

        <div className="hidden md:block h-5 w-px bg-separator-thin mx-0.5" />

        {/* theme toggle */}
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

        {/* language switch — hidden on mobile, set it once on desktop */}
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
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [backendError, setBackendError] = useState(false);
  const { t } = useT();

  const handleAuthError = useCallback(() => setIsAuthenticated(false), []);
  const handleAuthenticated = useCallback(() => {
    setIsAuthenticated(true);
    setBackendError(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        await getDomains();
        if (mounted) {
          setIsAuthenticated(true);
          setBackendError(false);
          setIsCheckingAuth(false);
        }
      } catch (e) {
        if (mounted) {
          const err = e as AxiosError;
          if (!err.response) setBackendError(true);
          else if (err.response.status === 401) {
            setIsAuthenticated(false);
            setBackendError(false);
          }
          setIsCheckingAuth(false);
        }
      }
    };
    check();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    window.addEventListener(AUTH_ERROR_EVENT, handleAuthError);
    return () => window.removeEventListener(AUTH_ERROR_EVENT, handleAuthError);
  }, [handleAuthError]);

  useEffect(() => {
    if (isAuthenticated && pathname === '/') {
      router.replace('/memory');
    }
  }, [isAuthenticated, pathname, router]);

  if (isCheckingAuth) {
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
      <LanguageProvider>
        <ConfirmProvider>
          <AppShellInner>{children}</AppShellInner>
        </ConfirmProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
