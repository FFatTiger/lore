import type { ScoredResult } from './recallScoring';

export interface RecallDisplayItem extends ScoredResult {
  score_display: number;
  read: boolean;
  boot: boolean;
}

export interface RecallSuppressed {
  boot: number;
  read: number;
  score: number;
}

export function buildRecallDisplay({
  ranked,
  readUris,
  bootUris,
  scorePrecision,
  minScore,
  candidateCount,
  maxDisplayItems,
  minDisplayScore,
  readNodeDisplayMode,
}: {
  ranked: ScoredResult[];
  readUris: Set<string>;
  bootUris: Set<string>;
  scorePrecision: number;
  minScore: number;
  candidateCount: number;
  maxDisplayItems: number;
  minDisplayScore: number;
  readNodeDisplayMode: string;
}): {
  ranked: RecallDisplayItem[];
  candidates: RecallDisplayItem[];
  items: RecallDisplayItem[];
  suppressed: RecallSuppressed;
} {
  const decorated = ranked
    .map((item) => ({
      ...item,
      score_display: Number(item.score.toFixed(scorePrecision)),
      read: readUris.has(item.uri),
      boot: bootUris.has(item.uri),
    }))
    .filter((item) => item.score >= minScore);

  const candidates = decorated.slice(0, candidateCount);
  const items: RecallDisplayItem[] = [];
  const suppressed: RecallSuppressed = { boot: 0, read: 0, score: 0 };

  for (const item of candidates) {
    if (item.boot) {
      suppressed.boot += 1;
      continue;
    }
    if (item.read) {
      if (readNodeDisplayMode === 'hard') {
        suppressed.read += 1;
        continue;
      }
      if (readNodeDisplayMode === 'soft' && item.score < Math.max(minDisplayScore + 0.1, 0.62)) {
        suppressed.read += 1;
        continue;
      }
    }
    if (item.score < minDisplayScore) {
      suppressed.score += 1;
      continue;
    }
    items.push(item);
    if (items.length >= maxDisplayItems) break;
  }

  return { ranked: decorated, candidates, items, suppressed };
}
