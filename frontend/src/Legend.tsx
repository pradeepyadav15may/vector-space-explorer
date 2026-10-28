import type { MapResponse } from './api';

interface Props {
  docs: MapResponse['docs'];
  docColors: Record<string, string>;
  hiddenDocs: string[];
  onToggle: (docId: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

/** The colour key, which also decides which documents appear on the map. */
export function Legend({ docs, docColors, hiddenDocs, onToggle, onShowAll, onHideAll }: Props) {
  const shown = docs.length - hiddenDocs.length;
  return (
    <fieldset className="legend">
      <legend>
        Documents <span className="subtle">({shown}/{docs.length} shown)</span>
      </legend>
      <div className="legend-actions">
        <button type="button" className="link" onClick={onShowAll} disabled={hiddenDocs.length === 0}>
          Show all
        </button>
        <button type="button" className="link" onClick={onHideAll} disabled={shown === 0}>
          Hide all
        </button>
      </div>
      <ul>
        {docs.map((doc) => (
          <li key={doc.id}>
            <label>
              <input type="checkbox" checked={!hiddenDocs.includes(doc.id)} onChange={() => onToggle(doc.id)} />
              <span className="dot" style={{ background: docColors[doc.id] }} />
              <span className="legend-title">{doc.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
