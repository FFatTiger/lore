import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DOMAIN, ROOT_NODE_UUID, MIN_DISPLAY_SCORE,
  DEFAULT_RECALL_LIMIT, SCORE_DECIMALS, FTS_CONFIGS,
  MAX_GLOSSARY_TERMS, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT,
  SEMANTIC_WEIGHT, MAX_DISPLAY_DEFAULT, SNIPPET_LENGTH,
  RECENCY_HALF_LIFE_DAYS, VIEW_TYPE_GIST, VIEW_TYPE_QUESTION,
  EVENT_SOURCE_MCP, EVENT_SOURCE_API, EVENT_SOURCE_DREAM
} from '../constants';

describe('constants', () => {
  it('DEFAULT_DOMAIN is core', () => {
    expect(DEFAULT_DOMAIN).toBe('core');
  });

  it('ROOT_NODE_UUID is valid UUID format', () => {
    expect(ROOT_NODE_UUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('MIN_DISPLAY_SCORE is between 0 and 1', () => {
    expect(MIN_DISPLAY_SCORE).toBeGreaterThan(0);
    expect(MIN_DISPLAY_SCORE).toBeLessThan(1);
  });

  it('DEFAULT_RECALL_LIMIT is positive integer', () => {
    expect(DEFAULT_RECALL_LIMIT).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_RECALL_LIMIT)).toBe(true);
  });

  it('SCORE_DECIMALS is 6', () => {
    expect(SCORE_DECIMALS).toBe(6);
  });

  it('FTS_CONFIGS contains expected configs', () => {
    expect(FTS_CONFIGS).toContain('zhparser');
    expect(FTS_CONFIGS).toContain('jiebacfg');
    expect(FTS_CONFIGS).toContain('simple');
  });

  it('MAX_GLOSSARY_TERMS is positive', () => {
    expect(MAX_GLOSSARY_TERMS).toBeGreaterThan(0);
  });

  it('search limits are ordered correctly', () => {
    expect(DEFAULT_SEARCH_LIMIT).toBeLessThan(MAX_SEARCH_LIMIT);
  });

  it('SEMANTIC_WEIGHT is between 0 and 1', () => {
    expect(SEMANTIC_WEIGHT).toBeGreaterThan(0);
    expect(SEMANTIC_WEIGHT).toBeLessThan(1);
  });

  it('view types are correct strings', () => {
    expect(VIEW_TYPE_GIST).toBe('gist');
    expect(VIEW_TYPE_QUESTION).toBe('question');
  });

  it('event sources are correct strings', () => {
    expect(EVENT_SOURCE_MCP).toBe('mcp');
    expect(EVENT_SOURCE_API).toBe('api');
    expect(EVENT_SOURCE_DREAM).toBe('dream:auto');
  });
});
