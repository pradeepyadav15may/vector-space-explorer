import { useState, type ReactNode } from 'react';
import { METRICS } from './metrics';
import type { ViewPreset } from './Scene';
import type { GraphSettings } from './settings';

interface Props {
  settings: GraphSettings;
  onChange: (patch: Partial<GraphSettings>) => void;
  onResetView: () => void;
  onView: (view: ViewPreset) => void;
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  reset: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  rotate: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  labels: 'M4 7h16M4 12h10M4 17h13',
  links: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  display: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
};

const VIEWS: { id: ViewPreset; label: string }[] = [
  { id: 'front', label: 'Front' },
  { id: 'top', label: 'Top' },
  { id: 'side', label: 'Side' },
];

interface ToolButtonProps {
  label: string;
  icon: string;
  onClick: () => void;
  pressed?: boolean;
  expanded?: boolean;
  children?: ReactNode;
}

function ToolButton({ label, icon, onClick, pressed, expanded }: ToolButtonProps) {
  return (
    <button
      type="button"
      className="tool"
      onClick={onClick}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-label={label}
      title={label}
    >
      <Icon d={icon} />
      <span className="tool-label">{label}</span>
    </button>
  );
}

export function Toolbar({ settings, onChange, onResetView, onView }: Props) {
  const [displayOpen, setDisplayOpen] = useState(false);

  return (
    <div className="toolbar" role="toolbar" aria-label="Map controls">
      <ToolButton label="Reset view" icon={ICONS.reset} onClick={onResetView} />
      <div className="segmented" role="group" aria-label="View angle">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className="tool" onClick={() => onView(v.id)} title={`${v.label} view`}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Similarity metric">
        {METRICS.map((m) => (
          <button
            key={m.id}
            type="button"
            className="tool"
            aria-pressed={settings.metric === m.id}
            onClick={() => onChange({ metric: m.id })}
            title={`Measure closeness with ${m.label.toLowerCase()}`}
          >
            {m.short}
          </button>
        ))}
      </div>
      <ToolButton
        label="Auto-rotate"
        icon={ICONS.rotate}
        pressed={settings.autoRotate}
        onClick={() => onChange({ autoRotate: !settings.autoRotate })}
      />
      <ToolButton
        label="Labels"
        icon={ICONS.labels}
        pressed={settings.showLabels}
        onClick={() => onChange({ showLabels: !settings.showLabels })}
      />
      <ToolButton
        label="Match lines"
        icon={ICONS.links}
        pressed={settings.showLinks}
        onClick={() => onChange({ showLinks: !settings.showLinks })}
      />
      <ToolButton label="Display" icon={ICONS.display} expanded={displayOpen} onClick={() => setDisplayOpen((o) => !o)} />

      {displayOpen && (
        <div className="popover">
          <label>
            <span>Node size</span>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.1}
              value={settings.nodeSize}
              onChange={(e) => onChange({ nodeSize: Number(e.target.value) })}
            />
          </label>
          <label>
            <span>Line opacity</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={settings.linkOpacity}
              onChange={(e) => onChange({ linkOpacity: Number(e.target.value) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
