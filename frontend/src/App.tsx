import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { fetchMap, runQuery, type MapResponse, type QueryResponse } from './api';
import { Scene } from './Scene';
import { docColor } from './colors';

const EXAMPLE_QUERIES = [
  'How did astronauts get to the Moon?',
  'Why do corals turn white?',
  'Which brewing method uses pressure?',
  'What was the first transistor used for?',
];

export function App() {
  const [map, setMap] = useState<MapResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchMap()
      .then(setMap)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const pointById = useMemo(() => new Map(map?.points.map((p) => [p.id, p]) ?? []), [map]);
  const selected = selectedId ? pointById.get(selectedId) ?? null : null;

  async function submit(query: string) {
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setQueryError(null);
    setSelectedId(null);
    try {
      setResult(await runQuery(trimmed));
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(text);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Vector Space Explorer</h1>
          <p className="subtle">Each dot is a chunk of text. Ask a question to see which chunks match it.</p>
        </div>
        {map && (
          <div className="meta">
            <span>{map.docs.length} documents</span>
            <span>{map.points.length} chunks</span>
            <span title="Embedding model">{map.embedder}</span>
          </div>
        )}
      </header>

      <main className="layout">
        <section className="stage" aria-label="3D map">
          {loadError && <div className="banner error">Could not load the map: {loadError}</div>}
          {!map && !loadError && <div className="banner">Loading the map…</div>}
          {map && <Scene points={map.points} result={result} selectedId={selectedId} onSelect={setSelectedId} />}
          <p className="hint">Drag to rotate · scroll to zoom · click a dot for details</p>
        </section>

        <aside className="panel">
          <form onSubmit={onSubmit} className="ask">
            <label htmlFor="query">Ask the documents</label>
            <textarea
              id="query"
              value={text}
              maxLength={500}
              rows={3}
              placeholder="e.g. What makes coffee bitter?"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" disabled={busy || !text.trim() || !map}>
              {busy ? 'Searching…' : 'Find matches'}
            </button>
          </form>

          <div className="examples">
            {EXAMPLE_QUERIES.map((q) => (
              <button
                key={q}
                type="button"
                className="chip"
                disabled={busy || !map}
                onClick={() => {
                  setText(q);
                  void submit(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>

          {queryError && <div className="banner error">{queryError}</div>}

          {result && result.matches.length > 0 && (
            <div className="results">
              {result.query_points.map((qp) => (
                <div key={qp.id} className="query-piece">
                  <h2>Query chunk: “{qp.text}”</h2>
                  <ol>
                    {result.matches
                      .filter((m) => m.query_point_id === qp.id)
                      .map((m) => (
                        <li
                          key={`${m.query_point_id}-${m.chunk_id}`}
                          className={selectedId === m.chunk_id ? 'active' : ''}
                          onClick={() => setSelectedId(m.chunk_id)}
                        >
                          <div className="match-head">
                            <span className="dot" style={{ background: docColor(m.chunk_id.split(':')[0]) }} />
                            <strong>{m.doc_title}</strong>
                            <span className="score" title="Cosine similarity on the full embedding">
                              {(m.score * 100).toFixed(1)}%
                            </span>
                          </div>
                          <p>{m.text}</p>
                        </li>
                      ))}
                  </ol>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="detail">
              <h2>{selected.doc_title}</h2>
              <p>{selected.text}</p>
              <button type="button" className="link" onClick={() => setSelectedId(null)}>
                Close
              </button>
            </div>
          )}

          <p className="fineprint">
            3D positions are a UMAP projection, for looks only. Ranking uses cosine similarity on the full embeddings.
          </p>
        </aside>
      </main>
    </div>
  );
}
