/**
 * Dream apply-phase write budgets.
 *
 * Content changes (create, content/priority/disclosure updates, deletes, and
 * restructuring moves) draw on a small per-run budget. Hygiene-only operations
 * (glossary keyword removals and moves out of a legacy domain into a canonical
 * one) draw on a larger, separate budget.
 */

import { isCanonicalDomain } from '../memory/pathRules';

export const DREAM_WRITE_TOOLS = new Set(['create_node', 'update_node', 'delete_node', 'move_node']);
export const DREAM_CONTENT_WRITE_CAP = 2;
export const DREAM_HYGIENE_WRITE_CAP = 12;

export function isDreamWriteTool(name: string): boolean {
  return DREAM_WRITE_TOOLS.has(name);
}

function stringListArg(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = String(item ?? '').trim();
    return text ? [text] : [];
  });
}

function splitDomain(uri: unknown): string {
  const text = String(uri ?? '').trim();
  const separator = text.indexOf('://');
  return separator > 0 ? text.slice(0, separator) : '';
}

/**
 * True when the write only touches hygiene surfaces: a glossary keyword
 * removal with no content/metadata change, or a move from a legacy domain into
 * a canonical domain.
 */
export function isDreamHygieneWrite(name: string, args: Record<string, unknown>): boolean {
  if (name === 'update_node') {
    if (stringListArg(args.glossary_remove).length === 0) return false;
    return args.content === undefined
      && args.priority === undefined
      && args.disclosure === undefined
      && stringListArg(args.glossary_add).length === 0;
  }
  if (name === 'move_node') {
    const oldDomain = splitDomain(args.old_uri);
    const newDomain = splitDomain(args.new_uri);
    return oldDomain !== ''
      && newDomain !== ''
      && oldDomain !== newDomain
      && !isCanonicalDomain(oldDomain)
      && isCanonicalDomain(newDomain);
  }
  return false;
}

export function dreamWriteCapBlockedResult(cap = DREAM_CONTENT_WRITE_CAP): Record<string, unknown> {
  return {
    error: 'Dream apply write cap reached',
    code: 'dream_write_cap',
    blocked: true,
    detail: `Dream apply phase allows at most ${cap} content-change operations (create / update content / delete / restructure move).`,
  };
}

export function dreamHygieneCapBlockedResult(cap = DREAM_HYGIENE_WRITE_CAP): Record<string, unknown> {
  return {
    error: 'Dream hygiene budget reached',
    code: 'dream_hygiene_cap',
    blocked: true,
    detail: `Dream apply phase allows at most ${cap} hygiene-only operations per run (glossary keyword removals and moves out of legacy domains).`,
  };
}
