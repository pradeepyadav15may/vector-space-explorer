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

export interface Match {
  query_point_id: string;
  chunk_id: string;
  doc_title: string;
  text: string;
  score: number;
  rank: number;
}

export interface QueryResponse {
  query_points: QueryPoint[];
  matches: Match[];
}

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

export async function runQuery(text: string, k = 5): Promise<QueryResponse> {
  return readJson<QueryResponse>(
    await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, k }),
    }),
  );
}
