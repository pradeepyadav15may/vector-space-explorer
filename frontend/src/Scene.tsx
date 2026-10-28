import { useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import type { MapPoint, QueryResponse } from './api';
import { docColor, QUERY_COLOR } from './colors';

export interface SceneNode {
  id: string;
  label: string;
  color: string;
  val: number;
  isQuery: boolean;
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
  text: string;
}

interface SceneLink {
  source: string;
  target: string;
  score: number;
}

interface Props {
  points: MapPoint[];
  result: QueryResponse | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function Scene({ points, result, selectedId, onSelect }: Props) {
  const fgRef = useRef<ForceGraphMethods<SceneNode, SceneLink> | undefined>(undefined);

  // Corpus points keep their UMAP positions: fixed coordinates, no physics simulation.
  const corpusNodes = useMemo<SceneNode[]>(
    () =>
      points.map((p) => ({
        id: p.id,
        label: p.doc_title,
        color: docColor(p.doc_id),
        val: 2,
        isQuery: false,
        x: p.xyz[0],
        y: p.xyz[1],
        z: p.xyz[2],
        fx: p.xyz[0],
        fy: p.xyz[1],
        fz: p.xyz[2],
        text: p.text,
      })),
    [points],
  );

  const { nodes, links } = useMemo(() => {
    const queryNodes: SceneNode[] = (result?.query_points ?? []).map((q) => ({
      id: q.id,
      label: 'Your query',
      color: QUERY_COLOR,
      val: 6,
      isQuery: true,
      x: q.xyz[0],
      y: q.xyz[1],
      z: q.xyz[2],
      fx: q.xyz[0],
      fy: q.xyz[1],
      fz: q.xyz[2],
      text: q.text,
    }));
    const matchLinks: SceneLink[] = (result?.matches ?? []).map((m) => ({
      source: m.query_point_id,
      target: m.chunk_id,
      score: m.score,
    }));
    return { nodes: [...corpusNodes, ...queryNodes], links: matchLinks };
  }, [corpusNodes, result]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.cameraPosition({ x: 0, y: 0, z: 320 }, undefined, 0);
  }, []);

  return (
    <ForceGraph3D<SceneNode, SceneLink>
      ref={fgRef}
      graphData={{ nodes, links }}
      backgroundColor="#0b0d12"
      showNavInfo={false}
      cooldownTicks={0}
      enableNodeDrag={false}
      nodeRelSize={3}
      nodeVal={(n) => n.val}
      nodeColor={(n) => (selectedId && n.id === selectedId ? '#ffd166' : n.color)}
      nodeLabel={(n) =>
        `<div class="vse-tooltip"><strong>${escapeHtml(n.label)}</strong><span>${escapeHtml(n.text.slice(0, 140))}</span></div>`
      }
      linkColor={() => 'rgba(255,255,255,0.55)'}
      linkWidth={(l) => Math.max(0.5, (l as SceneLink).score * 4)}
      linkOpacity={0.6}
      onNodeClick={(node) => onSelect(node.id)}
      onBackgroundClick={() => onSelect(null)}
    />
  );
}
