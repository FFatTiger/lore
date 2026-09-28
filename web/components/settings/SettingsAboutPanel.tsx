'use client';

import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge, Section, type BadgeTone } from '@/components/ui';
import { useT } from '@/lib/i18n';

const REPO = 'FFatTiger/lore';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export const ABOUT_LINKS = [
  { label: 'Website', href: 'https://loremem.com', text: 'loremem.com' },
  { label: 'Source code', href: `https://github.com/${REPO}`, text: `github.com/${REPO}` },
  { label: 'Release notes', href: `https://github.com/${REPO}/releases`, text: 'GitHub Releases' },
  { label: 'Report an issue', href: `https://github.com/${REPO}/issues`, text: 'GitHub Issues' },
] as const;

interface HealthInfo {
  status?: string;
  version?: string;
  database?: string;
  cache?: { provider?: string; ok?: boolean };
}

type UpdateState =
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; tag: string; url: string }
  | { kind: 'unknown' };

function parseVersion(version: string): number[] | null {
  const match = version.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

/** Compare release versions by major.minor.patch; null when either can't be parsed. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function resolveUpdateState(current: string | undefined, latestTag: string | undefined, url: string): UpdateState {
  if (!current || !latestTag) return { kind: 'unknown' };
  const cmp = compareVersions(latestTag, current);
  if (cmp === null) return { kind: 'unknown' };
  return cmp > 0 ? { kind: 'available', tag: latestTag, url } : { kind: 'latest' };
}

function AboutRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-separator-hairline px-4 py-3.5 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center sm:gap-4 md:px-6">
      <div className="text-[13px] text-txt-secondary">{label}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13.5px] text-txt-primary">{children}</div>
    </div>
  );
}

function ExternalAnchor({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-sys-blue hover:underline"
    >
      {children}
      <ExternalLink size={12} aria-hidden />
    </a>
  );
}

function StatusBadge({ ok, children }: { ok: boolean | undefined; children: React.ReactNode }): React.JSX.Element {
  const tone: BadgeTone = ok === undefined ? 'soft' : ok ? 'green' : 'red';
  return <Badge tone={tone} dot>{children}</Badge>;
}

export function SettingsAboutPanel(): React.JSX.Element {
  const { t } = useT();
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      let info: HealthInfo | null = null;
      try {
        // /api/health answers 503 with the same body when degraded.
        info = (await (await fetch('/api/health')).json()) as HealthInfo;
      } catch {
        info = null;
      }
      if (!active) return;
      setHealth(info);

      try {
        const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res.ok) throw new Error(String(res.status));
        const release = (await res.json()) as { tag_name?: string; html_url?: string };
        if (!active) return;
        setUpdate(resolveUpdateState(info?.version, release.tag_name, release.html_url || `https://github.com/${REPO}/releases/latest`));
      } catch {
        if (active) setUpdate({ kind: 'unknown' });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const version = health?.version;
  const cacheOk = health?.cache?.ok;

  return (
    <Section padded={false} title={t('About')} subtitle={t('Version, service status, and project links')}>
      <AboutRow label={t('Version')}>
        <span className="font-mono tabular-nums">{version ? `v${version.replace(/^v/i, '')}` : '—'}</span>
        {update.kind === 'checking' && <Badge tone="soft">{t('Checking for updates…')}</Badge>}
        {update.kind === 'latest' && <Badge tone="green">{t('Up to date')}</Badge>}
        {update.kind === 'available' && (
          <>
            <Badge tone="orange">{t('Update available')}: {update.tag}</Badge>
            <ExternalAnchor href={update.url}>{t('View release')}</ExternalAnchor>
          </>
        )}
        {update.kind === 'unknown' && <Badge tone="soft">{t('Update check unavailable')}</Badge>}
      </AboutRow>
      <AboutRow label={t('Service status')}>
        <StatusBadge ok={health ? health.database === 'connected' : undefined}>
          {t('Database')} · {health ? t(health.database === 'connected' ? 'Connected' : 'Disconnected') : '—'}
        </StatusBadge>
        <StatusBadge ok={cacheOk}>
          {t('Cache')} · {health?.cache?.provider ?? '—'}
        </StatusBadge>
      </AboutRow>
      {ABOUT_LINKS.map((link) => (
        <AboutRow key={link.href} label={t(link.label)}>
          <ExternalAnchor href={link.href}>{link.text}</ExternalAnchor>
        </AboutRow>
      ))}
      <AboutRow label={t('License')}>
        <span>MIT</span>
      </AboutRow>
    </Section>
  );
}
