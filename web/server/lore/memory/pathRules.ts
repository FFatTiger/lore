/**
 * Shared path and domain rules used by the memory audits and Dream.
 *
 * These helpers are pure so classification logic can be tested without a
 * database. The audits in `structuralAudit.ts` and `hygieneAudit.ts` build on
 * them, and Dream's write budgets use the canonical-domain check.
 */

const CANONICAL_DOMAINS = new Set(['project', 'core', 'preferences']);

/** Canonical domains are the ones memories are meant to live in. */
export function isCanonicalDomain(domain: unknown): boolean {
  return CANONICAL_DOMAINS.has(String(domain ?? '').trim());
}

export function lastPathSegment(path: unknown): string {
  const parts = String(path ?? '').replace(/^\/+|\/+$/g, '').split('/');
  return parts.length ? parts[parts.length - 1] : '';
}

export function parentPathOf(path: unknown): string {
  const trimmed = String(path ?? '').replace(/^\/+|\/+$/g, '');
  const index = trimmed.lastIndexOf('/');
  return index < 0 ? '' : trimmed.slice(0, index);
}

const DATE_TIME_PATH_SUFFIX_RE = /(^|_)((19|20)\d{2}_\d{2}_\d{2}(_\d{2}(_\d{2}){0,2})?|(19|20)\d{6}(_\d{6})?|\d{10,13})$/;
const ALLOWED_DATE_ARCHIVED_LEAF_RE = /^(dream_diary|daily_log|release|archive|incident)_(19|20)\d{2}_\d{2}_\d{2}(_\d{2}(_\d{2}){0,2})?$/;
const DATE_SUFFIX_LEAF_RE = /^(.*?)_((19|20)\d{2}_\d{2}_\d{2}(_\d{2}(_\d{2}){0,2})?|(19|20)\d{6}(_\d{6})?|\d{10,13})$/;

/** True when the last path segment ends with a date or epoch suffix. */
export function hasDateTimePathSuffix(path: unknown): boolean {
  return DATE_TIME_PATH_SUFFIX_RE.test(lastPathSegment(path));
}

/** Explicit archive concepts may carry a date in their own path. */
export function isAllowedDateArchivedPath(path: unknown): boolean {
  return ALLOWED_DATE_ARCHIVED_LEAF_RE.test(lastPathSegment(path));
}

/** Splits an ordinary date-suffixed leaf into its stable concept and date. */
export function splitDateSuffix(leaf: unknown): { concept: string; date: string } {
  const value = String(leaf ?? '');
  const match = DATE_SUFFIX_LEAF_RE.exec(value);
  if (!match) return { concept: value, date: '' };
  return { concept: match[1], date: match[2].replace(/_/g, '-') };
}

/**
 * Identifier-like glossary keywords: git hashes, version numbers,
 * IPv4(:port), host:port, ALL_CAPS tokens, paths, and hyphenated tokens with
 * digits on both sides. Case-sensitive full match.
 */
const IDENTIFIER_GLOSSARY_KEYWORD_RE = /^(?:[0-9a-f]{7,40}|v?\d+(?:\.\d+){1,3}[a-z0-9.-]*|\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?|[\w.-]+:\d{2,5}|[A-Z0-9_]{4,}|.*[/\\].*|[\w-]*\d[\w-]*-[\w-]*\d[\w-]*)$/;

export function isIdentifierGlossaryKeyword(keyword: unknown): boolean {
  return IDENTIFIER_GLOSSARY_KEYWORD_RE.test(String(keyword ?? '').trim());
}
