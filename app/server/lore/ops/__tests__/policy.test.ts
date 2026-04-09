import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db', () => ({ sql: vi.fn() }));
vi.mock('../../config/settings', () => ({ getSetting: vi.fn() }));

import { sql } from '../../../db';
import { getSetting } from '../../config/settings';
import { validateCreatePolicy, validateUpdatePolicy, validateDeletePolicy } from '../policy';

const mockSql = vi.mocked(sql);
const mockGetSetting = vi.mocked(getSetting);

function makeResult(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as any;
}

// ---------------------------------------------------------------------------
// validateCreatePolicy
// ---------------------------------------------------------------------------

describe('validateCreatePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no errors or warnings when all policies are disabled', async () => {
    mockGetSetting.mockResolvedValue(false as any);

    const result = await validateCreatePolicy({ priority: 0, disclosure: '' });
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns no errors when priority budget is within cap', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.priority_budget_enabled') return true as any;
      return false as any;
    });
    // priority=1, cap=15, current count=10 → still within budget
    mockSql.mockResolvedValue(makeResult([{ priority: 1, cnt: 10 }]));

    const result = await validateCreatePolicy({ priority: 1 });
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when priority 0 budget is exceeded', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.priority_budget_enabled') return true as any;
      return false as any;
    });
    // priority=0, cap=5, current count=5 → exceeded
    mockSql.mockResolvedValue(makeResult([
      { priority: 0, cnt: 5 },
      { priority: 1, cnt: 3 },
    ]));

    const result = await validateCreatePolicy({ priority: 0 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Priority 0');
    expect(result.errors[0]).toContain('5/5');
  });

  it('returns error when priority 1 budget is exceeded', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.priority_budget_enabled') return true as any;
      return false as any;
    });
    mockSql.mockResolvedValue(makeResult([
      { priority: 0, cnt: 2 },
      { priority: 1, cnt: 15 },
    ]));

    const result = await validateCreatePolicy({ priority: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Priority 1');
    expect(result.errors[0]).toContain('15/15');
  });

  it('does not check budget for priority >= 2', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.priority_budget_enabled') return true as any;
      return false as any;
    });

    const result = await validateCreatePolicy({ priority: 2 });
    expect(result.errors).toHaveLength(0);
    // sql should not have been called for priority budget query
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('warns when disclosure is missing', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.disclosure_warning_enabled') return true as any;
      return false as any;
    });

    const result = await validateCreatePolicy({ priority: 3, disclosure: '' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('disclosure');
  });

  it('warns when disclosure contains OR logic (或者)', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.disclosure_warning_enabled') return true as any;
      return false as any;
    });

    const result = await validateCreatePolicy({ priority: 3, disclosure: '当用户提到A或者B时' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('OR 逻辑');
  });

  it('warns when disclosure contains OR logic (以及)', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.disclosure_warning_enabled') return true as any;
      return false as any;
    });

    const result = await validateCreatePolicy({ priority: 3, disclosure: '当A以及B发生时' });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('OR 逻辑');
  });

  it('returns no disclosure warning for clean single-condition disclosure', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.disclosure_warning_enabled') return true as any;
      return false as any;
    });

    const result = await validateCreatePolicy({ priority: 3, disclosure: '当用户询问天气时召回' });
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateUpdatePolicy
// ---------------------------------------------------------------------------

describe('validateUpdatePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns when node has not been read before modification', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.read_before_modify_enabled') return true as any;
      if (key === 'policy.read_before_modify_window_minutes') return 10 as any;
      return false as any;
    });
    // getRecentRead returns no rows → not read
    mockSql.mockResolvedValue(makeResult([]));

    const result = await validateUpdatePolicy({
      domain: 'core',
      path: 'agent/prefs',
      sessionId: 'sess-1',
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('core://agent/prefs');
    expect(result.warnings[0]).toContain('lore_get_node');
  });

  it('does not warn when node has been read recently', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.read_before_modify_enabled') return true as any;
      if (key === 'policy.read_before_modify_window_minutes') return 10 as any;
      return false as any;
    });
    // getRecentRead returns a row → was read
    mockSql.mockResolvedValue(makeResult([{ 1: 1 }]));

    const result = await validateUpdatePolicy({
      domain: 'core',
      path: 'agent/prefs',
      sessionId: 'sess-1',
    });

    expect(result.warnings).toHaveLength(0);
  });

  it('returns no read warning when read_before_modify is disabled', async () => {
    mockGetSetting.mockResolvedValue(false as any);

    const result = await validateUpdatePolicy({
      domain: 'core',
      path: 'agent/prefs',
      sessionId: 'sess-1',
    });

    expect(result.warnings).toHaveLength(0);
  });

  it('returns error when updating priority and budget exceeded', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.priority_budget_enabled') return true as any;
      if (key === 'policy.read_before_modify_enabled') return false as any;
      return false as any;
    });
    // getCurrentPriority returns null (different from target 1)
    // getPriorityBudget returns count=15 for priority=1
    mockSql
      .mockResolvedValueOnce(makeResult([]))          // getCurrentPriority → null
      .mockResolvedValueOnce(makeResult([            // getPriorityBudget
        { priority: 0, cnt: 2 },
        { priority: 1, cnt: 15 },
      ]));

    const result = await validateUpdatePolicy({
      domain: 'core',
      path: 'agent/prefs',
      priority: 1,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Priority 1');
  });

  it('skips budget check when node already has the target priority', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.priority_budget_enabled') return true as any;
      if (key === 'policy.read_before_modify_enabled') return false as any;
      return false as any;
    });
    // getCurrentPriority returns 1 (same as target)
    mockSql.mockResolvedValueOnce(makeResult([{ priority: 1 }]));

    const result = await validateUpdatePolicy({
      domain: 'core',
      path: 'agent/prefs',
      priority: 1,
    });

    expect(result.errors).toHaveLength(0);
    // Should not call getPriorityBudget
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('warns about OR logic in disclosure when updating', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.disclosure_warning_enabled') return true as any;
      return false as any;
    });

    const result = await validateUpdatePolicy({
      domain: 'core',
      path: 'agent/prefs',
      disclosure: '当A或者B时',
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('OR 逻辑');
  });

  it('does not check disclosure when disclosure is not being updated', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.disclosure_warning_enabled') return true as any;
      return false as any;
    });

    // disclosure is undefined → not being updated
    const result = await validateUpdatePolicy({
      domain: 'core',
      path: 'agent/prefs',
    });

    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateDeletePolicy
// ---------------------------------------------------------------------------

describe('validateDeletePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('warns when node has not been read before deletion', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.read_before_modify_enabled') return true as any;
      if (key === 'policy.read_before_modify_window_minutes') return 10 as any;
      return false as any;
    });
    mockSql.mockResolvedValue(makeResult([]));

    const result = await validateDeletePolicy({
      domain: 'core',
      path: 'old/node',
      sessionId: 'sess-x',
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('core://old/node');
    expect(result.warnings[0]).toContain('lore_get_node');
  });

  it('does not warn when node was recently read', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.read_before_modify_enabled') return true as any;
      if (key === 'policy.read_before_modify_window_minutes') return 10 as any;
      return false as any;
    });
    mockSql.mockResolvedValue(makeResult([{ 1: 1 }]));

    const result = await validateDeletePolicy({
      domain: 'core',
      path: 'old/node',
      sessionId: 'sess-x',
    });

    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty errors and warnings when all policies are disabled', async () => {
    mockGetSetting.mockResolvedValue(false as any);

    const result = await validateDeletePolicy({
      domain: 'core',
      path: 'any/path',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns no warning when sessionId is null (cannot check read history)', async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === 'policy.read_before_modify_enabled') return true as any;
      if (key === 'policy.read_before_modify_window_minutes') return 10 as any;
      return false as any;
    });
    // getRecentRead returns false when sessionId is null
    mockSql.mockResolvedValue(makeResult([]));

    const result = await validateDeletePolicy({
      domain: 'core',
      path: 'old/node',
      sessionId: null,
    });

    // With null sessionId, getRecentRead returns false → warns
    expect(result.warnings).toHaveLength(1);
  });
});
