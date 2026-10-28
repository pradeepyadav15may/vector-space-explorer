import type { Match, Metric, Neighbor, QueryResponse } from './api';
import { rankOf } from './metrics';

/**
 * The top `topN` matches of each query chunk under a metric, best first. The API returns every
 * chunk that is in the top 10 under any metric, so this picks the ones that rank for this one.
 */
export function visibleMatches(result: QueryResponse | null, topN: number, metric: Metric): Match[] {
  if (!result) return [];
  return result.matches.filter((m) => rankOf(m, metric) <= topN).sort((a, b) => rankOf(a, metric) - rankOf(b, metric));
}

/** The same for the "similar chunks" of one selected chunk. */
export function visibleNeighbors(neighbors: Neighbor[], count: number, metric: Metric): Neighbor[] {
  return neighbors.filter((n) => rankOf(n, metric) <= count).sort((a, b) => rankOf(a, metric) - rankOf(b, metric));
}

/** How many of the top-`topN` matches under `metric` are not in the top `topN` by cosine. */
export function countRankChanges(result: QueryResponse | null, topN: number, metric: Metric): number {
  if (!result || metric === 'cosine') return 0;
  return result.matches.filter((m) => rankOf(m, metric) <= topN && m.ranks.cosine > topN).length;
}

/** Ids of every chunk shown in the results, best first, without repeats. For keyboard stepping. */
export function orderedMatchIds(matches: Match[], metric: Metric): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of [...matches].sort((a, b) => rankOf(a, metric) - rankOf(b, metric))) {
    if (!seen.has(m.chunk_id)) {
      seen.add(m.chunk_id);
      ids.push(m.chunk_id);
    }
  }
  return ids;
}

interface FocusInput {
  focusId: string | null;
  selectedId: string | null;
  matches: Match[];
  neighbors: Neighbor[];
}

/**
 * Which nodes stay bright. null means nothing is dimmed.
 * - Something focused: that node plus the nodes it is linked to (matches, or neighbours).
 * - No focus but a query is showing: the query chunks and their matches.
 */
export function brightSet({ focusId, selectedId, matches, neighbors }: FocusInput): Set<string> | null {
  if (focusId) {
    const bright = new Set<string>([focusId]);
    for (const m of matches) {
      if (m.query_point_id === focusId) bright.add(m.chunk_id);
      if (m.chunk_id === focusId) bright.add(m.query_point_id);
    }
    if (focusId === selectedId) for (const n of neighbors) bright.add(n.chunk_id);
    return bright;
  }
  if (matches.length > 0) {
    const bright = new Set<string>();
    for (const m of matches) {
      bright.add(m.query_point_id);
      bright.add(m.chunk_id);
    }
    return bright;
  }
  return null;
}
