import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  fetchMap,
  fetchNeighbors,
  MAX_MATCHES,
  runQuery,
  type MapResponse,
  type Neighbor,
  type QueryResponse,
} from './api';
import { buildDocColors } from './colors';
import { countRankChanges, orderedMatchIds, visibleMatches, visibleNeighbors } from './focus';
import { formatValue, METRIC_HELP, rankOf, valueTitle } from './metrics';
import { PairGeometry } from './PairGeometry';
import { Legend } from './Legend';
import { Scene, type SceneHandle } from './Scene';
import { useGraphSettings } from './settings';
import { Toolbar } from './Toolbar';
import { useElementSize } from './useElementSize';

const EXAMPLE_QUERIES = [
  'How did astronauts get to the Moon?',
  'Why do corals turn white?',
  'Which brewing method uses pressure?',
  'What was the first transistor used for?',
];

const NEIGHBOR_COUNT = 5;

const METRIC_LABELS = { cosine: 'Cosine', euclidean: 'Euclidean', map: 'Map distance' } as const;

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function App() {
  const [map, setMap] = useState<MapResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [neighborError, setNeighborError] = useState<string | null>(null);

  const { settings, update, toggleDoc } = useGraphSettings();
  const sceneRef = useRef<SceneHandle>(null);
  const stageRef = useRef<HTMLElement>(null);
  const stageSize = useElementSize(stageRef);
  const neighborCache = useRef(new Map<string, Neighbor[]>());

  useEffect(() => {
    fetchMap()
      .then(setMap)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  const pointById = useMemo(() => new Map(map?.points.map((p) => [p.id, p]) ?? []), [map]);
  const docColors = useMemo(() => buildDocColors(map?.docs.map((d) => d.id) ?? []), [map]);
  const selected = selectedId ? (pointById.get(selectedId) ?? null) : null;
  const matches = useMemo(
    () => visibleMatches(result, settings.topN, settings.metric),
    [result, settings.topN, settings.metric],
  );
  const shownNeighbors = useMemo(
    () => visibleNeighbors(neighbors, NEIGHBOR_COUNT, settings.metric),
    [neighbors, settings.metric],
  );
  const rankChanges = countRankChanges(result, settings.topN, settings.metric);

  // What the geometry panel compares the selected chunk with: the query that matched it, else its nearest neighbour.
  const geometrySubjects = useMemo(() => {
    if (!selected) return [];
    const matched = (result?.matches ?? []).filter((m) => m.chunk_id === selected.id);
    if (matched.length > 0) {
      return matched.map((m) => ({
        key: m.query_point_id,
        label: `Your query: “${result?.query_points.find((q) => q.id === m.query_point_id)?.text.slice(0, 48) ?? ''}”`,
        item: m,
      }));
    }
    const nearest = shownNeighbors[0];
    return nearest ? [{ key: nearest.chunk_id, label: `Nearest neighbour: ${nearest.doc_title}`, item: nearest }] : [];
  }, [selected, result, shownNeighbors]);

  // Hiding the document of the selected chunk would leave a selection nobody can see.
  useEffect(() => {
    if (selected && settings.hiddenDocs.includes(selected.doc_id)) setSelectedId(null);
  }, [selected, settings.hiddenDocs]);

  // Every selection, wherever it came from (map, results list, keyboard), moves the camera.
  useEffect(() => {
    if (selectedId) sceneRef.current?.flyTo(selectedId);
  }, [selectedId]);

  // Similar chunks for the selected chunk. Cached, so revisiting one costs no request.
  useEffect(() => {
    setNeighborError(null);
    if (!selectedId || !pointById.has(selectedId)) {
      setNeighbors([]);
      return;
    }
    const cached = neighborCache.current.get(selectedId);
    if (cached) {
      setNeighbors(cached);
      return;
    }
    setNeighbors([]);
    let stale = false;
    fetchNeighbors(selectedId, NEIGHBOR_COUNT)
      .then((found) => {
        neighborCache.current.set(selectedId, found);
        if (!stale) setNeighbors(found);
      })
      .catch((err: Error) => {
        if (!stale) setNeighborError(err.message);
      });
    return () => {
      stale = true;
    };
  }, [selectedId, pointById]);

  const stepMatch = useCallback(
    (direction: 1 | -1) => {
      const ids = orderedMatchIds(matches, settings.metric);
      if (ids.length === 0) return;
      const at = selectedId ? ids.indexOf(selectedId) : -1;
      const next = at < 0 ? (direction > 0 ? 0 : ids.length - 1) : (at + direction + ids.length) % ids.length;
      setSelectedId(ids[next]);
    },
    [matches, selectedId, settings.metric],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      if (isEditable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'r' || event.key === 'R') {
        sceneRef.current?.resetView();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        stepMatch(1);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        stepMatch(-1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stepMatch]);

  async function submit(query: string) {
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setQueryError(null);
    setSelectedId(null);
    try {
      // Always fetch the maximum; the "matches per query chunk" slider just slices it on the client.
      setResult(await runQuery(trimmed, MAX_MATCHES));
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

  const stopAutoRotate = useCallback(() => update({ autoRotate: false }), [update]);

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
        <section className="stage" aria-label="3D map" ref={stageRef}>
          {loadError && <div className="banner error">Could not load the map: {loadError}</div>}
          {!map && !loadError && <div className="banner">Loading the map…</div>}
          {map && stageSize.width > 0 && (
            <Scene
              ref={sceneRef}
              points={map.points}
              docColors={docColors}
              result={result}
              neighbors={shownNeighbors}
              selectedId={selectedId}
              settings={settings}
              width={stageSize.width}
              height={stageSize.height}
              onSelect={setSelectedId}
              onUserInteract={stopAutoRotate}
            />
          )}
          {map && (
            <Toolbar
              settings={settings}
              onChange={update}
              onResetView={() => sceneRef.current?.resetView()}
              onView={(view) => sceneRef.current?.setView(view)}
            />
          )}
          <p className="hint">
            Drag to rotate · scroll to zoom · click a dot to focus · <kbd>Esc</kbd> clears · <kbd>R</kbd> resets ·{' '}
            <kbd>←</kbd>
            <kbd>→</kbd> step through matches
          </p>
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

          <p className="metric-note">
            <strong>{METRIC_LABELS[settings.metric]}.</strong> {METRIC_HELP[settings.metric]}
            {rankChanges > 0 && (
              <>
                {' '}
                <em>
                  {rankChanges} of these matches {rankChanges === 1 ? 'is' : 'are'} not in the cosine top {settings.topN}.
                </em>
              </>
            )}
          </p>

          {queryError && <div className="banner error">{queryError}</div>}

          {result && result.matches.length > 0 && (
            <div className="results">
              <label className="slider-row">
                <span>
                  Matches per query chunk: <strong>{settings.topN}</strong>
                </span>
                <input
                  type="range"
                  min={1}
                  max={MAX_MATCHES}
                  value={settings.topN}
                  onChange={(e) => update({ topN: Number(e.target.value) })}
                />
              </label>
              {result.query_points.map((qp) => (
                <div key={qp.id} className="query-piece">
                  <h2>Query chunk: “{qp.text}”</h2>
                  <ol>
                    {matches
                      .filter((m) => m.query_point_id === qp.id)
                      .map((m) => {
                        const active = selectedId === m.chunk_id;
                        return (
                          <li
                            key={`${m.query_point_id}-${m.chunk_id}`}
                            className={active ? 'active' : ''}
                            ref={(el) => {
                              if (active && el) el.scrollIntoView({ block: 'nearest' });
                            }}
                          >
                            <button type="button" className="match-btn" aria-pressed={active} onClick={() => setSelectedId(m.chunk_id)}>
                              <span className="match-head">
                                <span className="dot" style={{ background: docColors[pointById.get(m.chunk_id)?.doc_id ?? ''] }} />
                                <strong>{m.doc_title}</strong>
                                {settings.metric !== 'cosine' && m.ranks.cosine !== rankOf(m, settings.metric) && (
                                  <span className="rank-shift" title="Rank by cosine, the true ordering">
                                    cos #{m.ranks.cosine}
                                  </span>
                                )}
                                <span className="score" title={valueTitle(settings.metric)}>
                                  {formatValue(m, settings.metric)}
                                </span>
                              </span>
                              <span className="match-text">{m.text}</span>
                            </button>
                          </li>
                        );
                      })}
                  </ol>
                </div>
              ))}
            </div>
          )}

          {selected && (
            <div className="detail">
              <h2>{selected.doc_title}</h2>
              <p>{selected.text}</p>

              <h3>Similar chunks</h3>
              {neighborError && <div className="banner error">{neighborError}</div>}
              {!neighborError && shownNeighbors.length === 0 && <p className="subtle">Looking for similar chunks…</p>}
              {shownNeighbors.length > 0 && (
                <ol className="neighbors">
                  {shownNeighbors.map((n) => (
                    <li key={n.chunk_id}>
                      <button type="button" className="match-btn" onClick={() => setSelectedId(n.chunk_id)}>
                        <span className="match-head">
                          <span className="dot" style={{ background: docColors[pointById.get(n.chunk_id)?.doc_id ?? ''] }} />
                          <strong>{n.doc_title}</strong>
                          <span className="score" title={valueTitle(settings.metric)}>
                            {formatValue(n, settings.metric)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}

              {geometrySubjects.map((subject) => (
                <PairGeometry key={subject.key} label={subject.label} item={subject.item} metric={settings.metric} />
              ))}

              <button type="button" className="link" onClick={() => setSelectedId(null)}>
                Close
              </button>
            </div>
          )}

          {map && (
            <Legend
              docs={map.docs}
              docColors={docColors}
              hiddenDocs={settings.hiddenDocs}
              onToggle={toggleDoc}
              onShowAll={() => update({ hiddenDocs: [] })}
              onHideAll={() => update({ hiddenDocs: map.docs.map((d) => d.id) })}
            />
          )}

          <p className="fineprint">
            3D positions are a UMAP projection, for looks only. Ranking uses cosine similarity on the full embeddings.
          </p>
        </aside>
      </main>
    </div>
  );
}
