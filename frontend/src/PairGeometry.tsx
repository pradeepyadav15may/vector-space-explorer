import type { Metric } from './api';
import { angleDegrees, rankOf, type Compared } from './metrics';

interface Props {
  label: string;
  item: Compared;
  metric: Metric;
}

const WIDTH = 220;
const HEIGHT = 140;
const CX = WIDTH / 2;
const CY = 128;
const R = 92; // length of both unit vectors on screen
const ARC_R = 36;

/**
 * Two unit vectors from the origin with the angle between them (what cosine measures) and the
 * chord between their tips (what Euclidean distance measures). Drawn symmetrically around "up".
 */
export function PairGeometry({ label, item, metric }: Props) {
  const theta = angleDegrees(item.score);
  const half = (theta / 2) * (Math.PI / 180);
  const left = { x: CX - R * Math.sin(half), y: CY - R * Math.cos(half) };
  const right = { x: CX + R * Math.sin(half), y: CY - R * Math.cos(half) };
  const arcLeft = { x: CX - ARC_R * Math.sin(half), y: CY - ARC_R * Math.cos(half) };
  const arcRight = { x: CX + ARC_R * Math.sin(half), y: CY - ARC_R * Math.cos(half) };

  return (
    <div className="geometry">
      <h3>{label}</h3>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Angle ${theta.toFixed(0)} degrees, Euclidean distance ${item.euclidean.toFixed(2)}`}>
        <line className="geo-vec" x1={CX} y1={CY} x2={left.x} y2={left.y} />
        <line className="geo-vec" x1={CX} y1={CY} x2={right.x} y2={right.y} />
        <line className={`geo-chord${metric === 'euclidean' ? ' on' : ''}`} x1={left.x} y1={left.y} x2={right.x} y2={right.y} />
        <path className={`geo-arc${metric === 'cosine' ? ' on' : ''}`} d={`M ${arcLeft.x} ${arcLeft.y} A ${ARC_R} ${ARC_R} 0 0 1 ${arcRight.x} ${arcRight.y}`} />
        <circle className="geo-tip" cx={left.x} cy={left.y} r="4" />
        <circle className="geo-tip" cx={right.x} cy={right.y} r="4" />
        <text className={`geo-text${metric === 'cosine' ? ' on' : ''}`} x={CX} y={CY - ARC_R - 6} textAnchor="middle">
          {theta.toFixed(0)}°
        </text>
        <text className={`geo-text${metric === 'euclidean' ? ' on' : ''}`} x={CX} y={left.y - 7} textAnchor="middle">
          d = {item.euclidean.toFixed(2)}
        </text>
      </svg>
      <table className="geo-table">
        <thead>
          <tr>
            <th />
            <th>Value</th>
            <th>Rank</th>
          </tr>
        </thead>
        <tbody>
          <tr className={metric === 'cosine' ? 'on' : ''}>
            <th>Cosine</th>
            <td>{(item.score * 100).toFixed(1)}%</td>
            <td>#{rankOf(item, 'cosine')}</td>
          </tr>
          <tr className={metric === 'euclidean' ? 'on' : ''}>
            <th>Euclidean</th>
            <td>{item.euclidean.toFixed(2)}</td>
            <td>#{rankOf(item, 'euclidean')}</td>
          </tr>
          <tr className={metric === 'map' ? 'on' : ''}>
            <th>Map distance</th>
            <td>{item.map_distance.toFixed(0)} u</td>
            <td>#{rankOf(item, 'map')}</td>
          </tr>
        </tbody>
      </table>
      <p className="subtle geo-note">
        d² = 2 − 2·cos: {item.euclidean.toFixed(2)}² = {(item.euclidean ** 2).toFixed(2)} and 2 − 2×{item.score.toFixed(2)} ={' '}
        {(2 - 2 * item.score).toFixed(2)}. Map distance is measured in the 3D map, not in the full space.
      </p>
    </div>
  );
}
