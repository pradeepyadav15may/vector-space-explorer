// Stable colour per document, so the same document keeps its colour across queries.
const PALETTE = ['#4cc9f0', '#f72585', '#b5e48c', '#ffd166', '#9d4edd', '#06d6a0', '#ff9f1c', '#8ecae6'];

export function docColor(docId: string): string {
  let hash = 0;
  for (const ch of docId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export const QUERY_COLOR = '#ffffff';
