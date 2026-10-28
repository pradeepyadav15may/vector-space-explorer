import type { Metric } from './api';

export const METRICS: { id: Metric; label: string; short: string }[] = [
  { id: 'cosine', label: 'Cosine', short: 'Cosine' },
  { id: 'euclidean', label: 'Euclidean', short: 'Euclid.' },
  { id: 'map', label: 'Map distance', short: 'Map' },
];

export interface Compared {
  score: number;
  euclidean: number;
  map_distance: number;
  ranks: Record<Metric, number>;
}

export function rankOf(item: Compared, metric: Metric): number {
  return item.ranks[metric];
}

/** The number to show for a metric. Cosine is a similarity (higher is closer); the others are distances. */
export function formatValue(item: Compared, metric: Metric): string {
  if (metric === 'cosine') return `${(item.score * 100).toFixed(1)}%`;
  if (metric === 'euclidean') return `d ${item.euclidean.toFixed(2)}`;
  return `${item.map_distance.toFixed(0)} u`;
}

export function valueTitle(metric: Metric): string {
  if (metric === 'cosine') return 'Cosine similarity on the full 384-number vectors';
  if (metric === 'euclidean') return 'Euclidean distance between the full vectors (smaller is closer)';
  return 'Distance in the 3D map, in map units (smaller is closer)';
}

/** 0..1, higher is closer, so the scene can size nodes and lines the same way for every metric. */
export function closeness(item: Compared, metric: Metric): number {
  if (metric === 'cosine') return Math.max(0, item.score);
  if (metric === 'euclidean') return Math.max(0, 1 - item.euclidean / 2);
  return Math.max(0.05, 1 - item.map_distance / 150);
}

export const METRIC_HELP: Record<Metric, string> = {
  cosine: 'Cosine compares the angle between two vectors. Closer to 100% means they point the same way.',
  euclidean:
    'Euclidean is the straight-line gap between the vector tips. Our vectors have length 1, so d² = 2 − 2·cos and the ranking matches cosine exactly.',
  map: 'Map distance is measured between the 3D dots. The map squeezes 384 numbers into 3, so this ranking can disagree with the true one. That gap is the projection’s distortion.',
};

/** Angle between two unit vectors, in degrees, from their cosine. */
export function angleDegrees(cosine: number): number {
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}
