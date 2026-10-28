// 16 hand-picked colours that stay distinguishable on the dark background.
const PALETTE = [
  '#4cc9f0', '#f72585', '#b5e48c', '#ffd166', '#9d4edd', '#06d6a0', '#ff9f1c', '#8ecae6',
  '#ef476f', '#118ab2', '#c77dff', '#80ed99', '#ff7b00', '#e5989b', '#2ec4b6', '#bde0fe',
];

function overflowColor(index: number): string {
  // Past the palette, walk the hue wheel by the golden angle so neighbours stay far apart.
  return `hsl(${Math.round((index * 137.508) % 360)} 70% 62%)`;
}

/**
 * One colour per document, assigned by position in the (server-sorted) document list, so no two
 * documents share a colour until the palette is used up. Adding documents can shift later colours.
 */
export function buildDocColors(docIds: string[]): Record<string, string> {
  return Object.fromEntries(docIds.map((id, i) => [id, PALETTE[i] ?? overflowColor(i)]));
}

export const QUERY_COLOR = '#ffffff';
export const SELECTED_COLOR = '#ffd166';
export const NEIGHBOR_COLOR = '#4cc9f0';

/** Any CSS colour string (hex or hsl) with an alpha channel, for the 3D scene's per-node opacity. */
export function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  if (color.startsWith('#')) {
    const hex = color.length === 4 ? [...color.slice(1)].map((c) => c + c).join('') : color.slice(1);
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color.replace(/^hsl\((.*)\)$/, `hsl($1 / ${alpha})`);
}
