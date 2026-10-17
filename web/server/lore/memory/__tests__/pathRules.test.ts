import { describe, it, expect } from 'vitest';
import {
  hasDateTimePathSuffix,
  isAllowedDateArchivedPath,
  isCanonicalDomain,
  isIdentifierGlossaryKeyword,
  splitDateSuffix,
} from '../pathRules';

describe('isCanonicalDomain', () => {
  it('accepts the canonical domains', () => {
    expect(isCanonicalDomain('core')).toBe(true);
    expect(isCanonicalDomain('project')).toBe(true);
    expect(isCanonicalDomain('preferences')).toBe(true);
  });

  it('rejects legacy and malformed domains', () => {
    expect(isCanonicalDomain('work')).toBe(false);
    expect(isCanonicalDomain('notes')).toBe(false);
    expect(isCanonicalDomain('core://agent')).toBe(false);
    expect(isCanonicalDomain('')).toBe(false);
  });
});

describe('hasDateTimePathSuffix', () => {
  it('detects ordinary date and epoch suffixes', () => {
    expect(hasDateTimePathSuffix('lore/dream_review_2026_05_07')).toBe(true);
    expect(hasDateTimePathSuffix('lore/release_2026_05_07_12_30')).toBe(true);
    expect(hasDateTimePathSuffix('lore/20260507')).toBe(true);
    expect(hasDateTimePathSuffix('lore/1714975200000')).toBe(true);
  });

  it('ignores stable concepts', () => {
    expect(hasDateTimePathSuffix('lore/dream_review')).toBe(false);
    expect(hasDateTimePathSuffix('lore/v2')).toBe(false);
  });
});

describe('isAllowedDateArchivedPath', () => {
  it('allows explicit archive concepts with a date', () => {
    expect(isAllowedDateArchivedPath('archive/daily_log_2026_05_07')).toBe(true);
    expect(isAllowedDateArchivedPath('archive/release_2026_05_07')).toBe(true);
  });

  it('does not allow ordinary concepts with a date', () => {
    expect(isAllowedDateArchivedPath('lore/dream_review_2026_05_07')).toBe(false);
    expect(isAllowedDateArchivedPath('archive/notes_2026_05_07')).toBe(false);
  });
});

describe('splitDateSuffix', () => {
  it('splits a date-suffixed leaf into concept and date', () => {
    expect(splitDateSuffix('dream_review_2026_05_07')).toEqual({ concept: 'dream_review', date: '2026-05-07' });
  });

  it('returns the leaf unchanged without a date suffix', () => {
    expect(splitDateSuffix('dream_review')).toEqual({ concept: 'dream_review', date: '' });
  });
});

describe('isIdentifierGlossaryKeyword', () => {
  it('recognises hashes, versions, addresses, paths, and caps tokens', () => {
    expect(isIdentifierGlossaryKeyword('deadbeefcafe')).toBe(true);
    expect(isIdentifierGlossaryKeyword('v1.3.7')).toBe(true);
    expect(isIdentifierGlossaryKeyword('192.168.1.10:5432')).toBe(true);
    expect(isIdentifierGlossaryKeyword('api.huu.im:30147')).toBe(true);
    expect(isIdentifierGlossaryKeyword('BM25')).toBe(true);
    expect(isIdentifierGlossaryKeyword('web/server/lore')).toBe(true);
    expect(isIdentifierGlossaryKeyword('v1-2')).toBe(true);
  });

  it('does not treat natural language words as identifiers', () => {
    expect(isIdentifierGlossaryKeyword('记忆')).toBe(false);
    expect(isIdentifierGlossaryKeyword('webhook')).toBe(false);
    expect(isIdentifierGlossaryKeyword('idempotency-key')).toBe(false);
    expect(isIdentifierGlossaryKeyword('gpt-4o')).toBe(false);
    expect(isIdentifierGlossaryKeyword('dream diary')).toBe(false);
  });
});
