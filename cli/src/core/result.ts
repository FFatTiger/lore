import type { ChannelResult } from './types.js';

export type InstallOutcomeKind = 'success' | 'partial' | 'failed' | 'aborted';

export type InstallOutcome = {
  kind: InstallOutcomeKind;
  /** Process exit code: 0 only for full success (ok + optional skips, zero fails). */
  exitCode: number;
  ok: number;
  skipped: number;
  failed: number;
  total: number;
};

/**
 * Summarize channel results for final messaging and exit code.
 * - success: at least one ok, zero failed (skips allowed)
 * - partial: mix of ok and failed
 * - failed: zero ok and at least one failed, or nothing ran successfully
 * - aborted: no channels selected / empty results with explicit abort handled elsewhere
 */
export function summarizeChannelResults(results: ChannelResult[]): InstallOutcome {
  const ok = results.filter((r) => r.status === 'ok').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const total = results.length;

  if (total === 0) {
    return { kind: 'failed', exitCode: 1, ok: 0, skipped: 0, failed: 0, total: 0 };
  }
  if (failed === 0 && ok > 0) {
    return { kind: 'success', exitCode: 0, ok, skipped, failed, total };
  }
  if (failed === 0 && ok === 0 && skipped > 0) {
    // Everything skipped (e.g. missing CLIs) — not a success install
    return { kind: 'failed', exitCode: 1, ok, skipped, failed, total };
  }
  if (ok > 0 && failed > 0) {
    return { kind: 'partial', exitCode: 1, ok, skipped, failed, total };
  }
  return { kind: 'failed', exitCode: 1, ok, skipped, failed, total };
}
