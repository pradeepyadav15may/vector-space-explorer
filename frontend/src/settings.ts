import { useCallback, useState } from 'react';
import type { Metric } from './api';

/** Plain JSON-friendly object, so a view can later be saved or put in a URL as-is. */
export interface GraphSettings {
  nodeSize: number; // multiplier on node radius
  linkOpacity: number;
  showLabels: boolean;
  showLinks: boolean; // query-to-match lines
  autoRotate: boolean;
  metric: Metric; // how closeness is measured and ranked
  topN: number; // matches shown per query chunk
  hiddenDocs: string[]; // document ids hidden from the map
}

export const DEFAULT_SETTINGS: GraphSettings = {
  nodeSize: 1,
  linkOpacity: 0.6,
  showLabels: false,
  showLinks: true,
  autoRotate: false,
  metric: 'cosine',
  topN: 5,
  hiddenDocs: [],
};

export function useGraphSettings() {
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS);

  const update = useCallback((patch: Partial<GraphSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const toggleDoc = useCallback((docId: string) => {
    setSettings((prev) => ({
      ...prev,
      hiddenDocs: prev.hiddenDocs.includes(docId)
        ? prev.hiddenDocs.filter((id) => id !== docId)
        : [...prev.hiddenDocs, docId],
    }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return { settings, update, toggleDoc, reset };
}
