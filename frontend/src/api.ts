export interface MapPoint {
  id: string;
  doc_id: string;
  doc_title: string;
  text: string;
  xyz: [number, number, number];
}

export interface MapResponse {
  embedder: string;
  docs: { id: string; title: string }[];
  points: MapPoint[];
}

export interface QueryPoint {
  id: string;
  text: string;
  xyz: [number, number, number];
}

export type Metric = 'cosine' | 'euclidean' | 'map';

/** One query-to-chunk or chunk-to-chunk comparison, scored three ways. */
interface Scored {
  chunk_id: string;
  doc_title: string;
  text: string;
  score: number; // cosine similarity on the full vectors
  euclidean: number; // straight-line distance between the full vectors
  map_distance: number; // distance between the 3D map positions
  ranks: Record<Metric, number>;
  rank: number; // same as ranks.cosine
}

export interface Match extends Scored {
  query_point_id: string;
}

export interface QueryResponse {
  query_points: QueryPoint[];
  matches: Match[];
}

export type Neighbor = Scored;

/** Matches the backend's MAX_TOP_K. The UI asks for this many once and slices on the client. */
export const MAX_MATCHES = 10;

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function fetchMap(): Promise<MapResponse> {
  return readJson<MapResponse>(await fetch('/api/map'));
}

export async function runQuery(text: string, k = MAX_MATCHES): Promise<QueryResponse> {
  return readJson<QueryResponse>(
    await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, k }),
    }),
  );
}

export async function fetchNeighbors(chunkId: string, k = 5): Promise<Neighbor[]> {
  const body = await readJson<{ neighbors: Neighbor[] }>(
    await fetch(`/api/neighbors/${encodeURIComponent(chunkId)}?k=${k}`),
  );
  return body.neighbors;
}
