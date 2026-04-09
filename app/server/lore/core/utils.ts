/**
 * Shared utility functions used across lore modules.
 */
import type { URI } from './types';

export function parseUri(uri: unknown): URI {
  const value = String(uri || '').trim();
  if (value.includes('://')) {
    const [domain, path] = value.split('://', 2);
    return { domain: domain.trim() || 'core', path: path.replace(/^\/+|\/+$/g, '') };
  }
  return { domain: 'core', path: value.replace(/^\/+|\/+$/g, '') };
}

export function dedupeTerms(values: unknown[], maxItems = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value || '').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function truncate(value: unknown, maxChars: number): string {
  const text = String(value || '').replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export function clampLimit(val: unknown, min: number, max: number, fallback: number): number {
  return Math.max(min, Math.min(max, Number(val) || fallback));
}
