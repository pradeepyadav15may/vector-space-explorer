import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import * as THREE from 'three';
import type { MapPoint, Neighbor, QueryResponse } from './api';
import { NEIGHBOR_COLOR, QUERY_COLOR, SELECTED_COLOR, withAlpha } from './colors';
import { brightSet, visibleMatches } from './focus';
import { closeness, rankOf } from './metrics';
import type { GraphSettings } from './settings';

export interface SceneNode {
  id: string;
  label: string;
  docId: string | null;
  color: string;
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
  source: string | SceneNode;
  target: string | SceneNode;
  score: number;
  kind: 'match' | 'neighbor';
}

export type ViewPreset = 'front' | 'top' | 'side';

/** Camera actions the parent can trigger. Everything else flows through props. */
export interface SceneHandle {
  resetView: () => void;
  setView: (view: ViewPreset) => void;
  flyTo: (id: string) => void;
}

interface Props {
  ref?: Ref<SceneHandle>;
  points: MapPoint[];
  docColors: Record<string, string>;
  result: QueryResponse | null;
  neighbors: Neighbor[];
  selectedId: string | null;
  settings: GraphSettings;
  width: number;
  height: number;
  onSelect: (id: string | null) => void;
  onUserInteract: () => void;
}

const HOME = { x: 0, y: 0, z: 320 };
const VIEWS: Record<ViewPreset, { x: number; y: number; z: number }> = {
  front: HOME,
  top: { x: 0, y: 320, z: 0.001 }, // a tiny z keeps the orbit camera's "up" well defined
  side: { x: 320, y: 0, z: 0 },
};
const FLY_DISTANCE = 120;
const MIN_FRAME_DISTANCE = 170;
const DIM_ALPHA = 0.12;
const LABEL_HEIGHT = 0.03; // fraction of the viewport height: labels keep a constant on-screen size
const PULSE_MS = 700;
const PULSE_STAGGER_MS = 90;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function endId(end: string | SceneNode): string {
  return typeof end === 'string' ? end : end.id;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function makeLabel(text: string): THREE.Sprite {
  const font = '28px system-ui, sans-serif';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const height = 40;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 20;
  canvas.height = height;
  ctx.font = font; // resizing a canvas resets its context
  ctx.fillStyle = 'rgba(11, 13, 18, 0.72)';
  ctx.fillRect(0, 0, canvas.width, height);
  ctx.fillStyle = '#e8ebf2';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, sizeAttenuation: false }),
  );
  sprite.scale.set((canvas.width / height) * LABEL_HEIGHT, LABEL_HEIGHT, 1);
  sprite.position.set(0, 9, 0);
  sprite.renderOrder = 10;
  return sprite;
}

export function Scene({
  ref,
  points,
  docColors,
  result,
  neighbors,
  selectedId,
  settings,
  width,
  height,
  onSelect,
  onUserInteract,
}: Props) {
  const fgRef = useRef<ForceGraphMethods<SceneNode, SceneLink> | undefined>(undefined);
  const labelSprites = useRef(new Map<string, THREE.Sprite>());
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const hiddenDocs = useMemo(() => new Set(settings.hiddenDocs), [settings.hiddenDocs]);
  const matches = useMemo(
    () => visibleMatches(result, settings.topN, settings.metric),
    [result, settings.topN, settings.metric],
  );
  // How close each matched chunk is to the query, 0..1 under the chosen metric. Drives node size.
  const bestCloseness = useMemo(() => {
    const best = new Map<string, number>();
    for (const m of matches) {
      best.set(m.chunk_id, Math.max(best.get(m.chunk_id) ?? 0, closeness(m, settings.metric)));
    }
    return best;
  }, [matches, settings.metric]);

  // Corpus points keep their UMAP positions: fixed coordinates, no physics simulation.
  const corpusNodes = useMemo<SceneNode[]>(
    () =>
      points.map((p) => ({
        id: p.id,
        label: p.doc_title,
        docId: p.doc_id,
        color: docColors[p.doc_id] ?? '#8ecae6',
        isQuery: false,
        x: p.xyz[0],
        y: p.xyz[1],
        z: p.xyz[2],
        fx: p.xyz[0],
        fy: p.xyz[1],
        fz: p.xyz[2],
        text: p.text,
      })),
    [points, docColors],
  );

  const queryNodes = useMemo<SceneNode[]>(
    () =>
      (result?.query_points ?? []).map((q) => ({
        id: q.id,
        label: 'Your query',
        docId: null,
        color: QUERY_COLOR,
        isQuery: true,
        x: q.xyz[0],
        y: q.xyz[1],
        z: q.xyz[2],
        fx: q.xyz[0],
        fy: q.xyz[1],
        fz: q.xyz[2],
        text: q.text,
      })),
    [result],
  );

  const visibleCorpus = useMemo(
    () => corpusNodes.filter((n) => !hiddenDocs.has(n.docId ?? '')),
    [corpusNodes, hiddenDocs],
  );

  const nodes = useMemo(() => [...visibleCorpus, ...queryNodes], [visibleCorpus, queryNodes]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const links = useMemo<SceneLink[]>(() => {
    const out: SceneLink[] = [];
    if (settings.showLinks) {
      for (const m of matches) {
        if (nodesById.has(m.query_point_id) && nodesById.has(m.chunk_id)) {
          out.push({ source: m.query_point_id, target: m.chunk_id, score: closeness(m, settings.metric), kind: 'match' });
        }
      }
    }
    if (selectedId && nodesById.has(selectedId)) {
      for (const n of neighbors) {
        if (nodesById.has(n.chunk_id)) {
          out.push({ source: selectedId, target: n.chunk_id, score: closeness(n, settings.metric), kind: 'neighbor' });
        }
      }
    }
    return out;
  }, [matches, neighbors, selectedId, settings.showLinks, settings.metric, nodesById]);

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links]);

  const focusId = hoveredId ?? selectedId;
  const bright = useMemo(
    () => brightSet({ focusId, selectedId, matches, neighbors }),
    [focusId, selectedId, matches, neighbors],
  );
  const isDim = useCallback((id: string) => bright !== null && !bright.has(id), [bright]);

  // ----- camera --------------------------------------------------------------------------------

  const duration = useCallback((ms: number) => (prefersReducedMotion() ? 0 : ms), []);

  useImperativeHandle(
    ref,
    () => ({
      resetView: () => fgRef.current?.cameraPosition(HOME, { x: 0, y: 0, z: 0 }, duration(800)),
      setView: (view) => fgRef.current?.cameraPosition(VIEWS[view], { x: 0, y: 0, z: 0 }, duration(800)),
      flyTo: (id) => {
        const fg = fgRef.current;
        const node = nodesById.get(id);
        if (!fg || !node) return;
        const target = new THREE.Vector3(node.x, node.y, node.z);
        // Keep the current viewing direction and move in close.
        const away = fg.camera().position.clone().sub(target);
        if (away.lengthSq() < 1) away.set(0, 0, 1);
        const to = target.clone().add(away.setLength(FLY_DISTANCE));
        fg.cameraPosition({ x: to.x, y: to.y, z: to.z }, target, duration(800));
      },
    }),
    [nodesById, duration],
  );

  useEffect(() => {
    fgRef.current?.cameraPosition(HOME, undefined, 0);
  }, []);

  // Orbit controls (see controlType below) support auto-rotate; stop it as soon as the user grabs the view.
  useEffect(() => {
    const controls = fgRef.current?.controls() as
      | (THREE.EventDispatcher<{ start: object }> & { autoRotate: boolean; autoRotateSpeed: number })
      | undefined;
    if (!controls) return;
    controls.autoRotate = settings.autoRotate;
    controls.autoRotateSpeed = 1.2;
    if (!settings.autoRotate) return;
    controls.addEventListener('start', onUserInteract);
    return () => controls.removeEventListener('start', onUserInteract);
  }, [settings.autoRotate, onUserInteract]);

  // ----- a new query: frame it and ripple through the matches ----------------------------------

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !result || result.matches.length === 0) return;
    const framed = new Set<string>(result.query_points.map((q) => q.id));
    for (const m of visibleMatches(result, settings.topN, settings.metric)) framed.add(m.chunk_id);
    // Frame the query and its matches from the current viewing angle. zoomToFit would hug a tight
    // cluster too closely, so use the bounding sphere with a minimum distance.
    const points = [...framed].flatMap((id) => {
      const n = nodesById.get(id);
      return n ? [new THREE.Vector3(n.x, n.y, n.z)] : [];
    });
    if (points.length > 0) {
      const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
      const radius = Math.max(...points.map((p) => p.distanceTo(center)));
      const camera = fg.camera() as THREE.PerspectiveCamera;
      const fit = (radius * 1.3) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const away = camera.position.clone().sub(center);
      if (away.lengthSq() < 1) away.set(0, 0, 1);
      const to = center.clone().add(away.setLength(Math.max(MIN_FRAME_DISTANCE, fit + 30)));
      fg.cameraPosition({ x: to.x, y: to.y, z: to.z }, center, duration(900));
    }

    if (prefersReducedMotion()) return;
    const swelling: { obj: THREE.Object3D; delay: number }[] = [];
    for (const m of visibleMatches(result, settings.topN, settings.metric)) {
      // The library attaches each node's three.js object to the node itself.
      const obj = (nodesById.get(m.chunk_id) as (SceneNode & { __threeObj?: THREE.Object3D }) | undefined)?.__threeObj;
      if (obj) swelling.push({ obj, delay: (rankOf(m, settings.metric) - 1) * PULSE_STAGGER_MS });
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      let running = false;
      for (const { obj, delay } of swelling) {
        const t = (now - start - delay) / PULSE_MS;
        if (t < 1) running = true;
        obj.scale.setScalar(t > 0 && t < 1 ? 1 + 0.9 * Math.sin(Math.PI * t) : 1);
      }
      if (running) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const { obj } of swelling) obj.scale.setScalar(1);
    };
    // Only a new result should re-frame the camera, not moving the top-N slider or toggling filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // ----- neighbourhood ring --------------------------------------------------------------------

  // A faint sphere around the selection, reaching its farthest shown neighbour in map space. Under
  // cosine or Euclidean it often swallows unrelated dots, which is the projection's distortion.
  const ringRadius = useMemo(() => {
    const node = selectedId ? nodesById.get(selectedId) : undefined;
    if (!node) return null;
    const distances = node.isQuery
      ? matches.filter((m) => m.query_point_id === node.id).map((m) => m.map_distance)
      : neighbors.map((n) => n.map_distance);
    return distances.length > 0 ? Math.max(...distances) : null;
  }, [selectedId, nodesById, matches, neighbors]);

  useEffect(() => {
    const fg = fgRef.current;
    const node = selectedId ? nodesById.get(selectedId) : undefined;
    if (!fg || !node || ringRadius === null) return;
    const geometry = new THREE.SphereGeometry(ringRadius, 32, 20);
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: NEIGHBOR_COLOR, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.BackSide }),
    );
    const wireGeometry = new THREE.WireframeGeometry(geometry);
    const wire = new THREE.LineSegments(
      wireGeometry,
      new THREE.LineBasicMaterial({ color: NEIGHBOR_COLOR, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    const ring = new THREE.Group();
    ring.add(fill, wire);
    ring.position.set(node.x, node.y, node.z);
    const scene = fg.scene();
    scene.add(ring);
    return () => {
      scene.remove(ring);
      geometry.dispose();
      wireGeometry.dispose();
      (fill.material as THREE.Material).dispose();
      (wire.material as THREE.Material).dispose();
    };
  }, [selectedId, nodesById, ringRadius]);

  // ----- labels --------------------------------------------------------------------------------

  // Called once when a node's object is created, so it must not change on hover or the library
  // would rebuild (and dispose) every node. Dimming is applied in the effect below instead.
  const labelFactory = useCallback((node: SceneNode) => {
    const sprite = makeLabel(truncate(node.label, 32));
    labelSprites.current.set(node.id, sprite);
    return sprite;
  }, []);

  useEffect(() => {
    const sprites = labelSprites.current;
    if (!settings.showLabels) sprites.clear(); // turning labels off rebuilds every node, dropping its sprite
    for (const [id, sprite] of sprites) {
      if (nodesById.has(id)) sprite.material.opacity = isDim(id) ? 0 : 1; // only the focused cluster stays labelled
      else sprites.delete(id);
    }
  }, [isDim, nodesById, settings.showLabels]);

  // ----- accessors -----------------------------------------------------------------------------

  const nodeVal = useCallback(
    (n: SceneNode) => {
      const base = n.isQuery ? 6 : 2 + (bestCloseness.get(n.id) ?? 0) * 5;
      return n.id === selectedId ? base * 1.5 : base;
    },
    [bestCloseness, selectedId],
  );

  const nodeColor = useCallback(
    (n: SceneNode) => {
      const base = n.id === selectedId ? SELECTED_COLOR : n.color;
      return isDim(n.id) ? withAlpha(base, DIM_ALPHA) : base;
    },
    [selectedId, isDim],
  );

  const linkColor = useCallback(
    (l: SceneLink) => {
      const dim = isDim(endId(l.source)) || isDim(endId(l.target));
      if (l.kind === 'neighbor') return withAlpha(NEIGHBOR_COLOR, dim ? DIM_ALPHA : 0.9);
      return `rgba(255, 255, 255, ${dim ? DIM_ALPHA : 0.55})`;
    },
    [isDim],
  );

  return (
    <ForceGraph3D<SceneNode, SceneLink>
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="#0b0d12"
      controlType="orbit"
      showNavInfo={false}
      cooldownTicks={0}
      enableNodeDrag={false}
      nodeRelSize={3 * settings.nodeSize}
      nodeVal={nodeVal}
      nodeColor={nodeColor}
      nodeThreeObject={settings.showLabels ? labelFactory : undefined}
      nodeThreeObjectExtend
      nodeLabel={(n) =>
        `<div class="vse-tooltip"><strong>${escapeHtml(n.label)}</strong><span>${escapeHtml(n.text.slice(0, 140))}</span></div>`
      }
      linkColor={linkColor}
      linkWidth={(l) => Math.max(0.5, l.score * (l.kind === 'match' ? 4 : 3))}
      linkOpacity={settings.linkOpacity}
      onNodeHover={(node) => setHoveredId(node ? node.id : null)}
      onNodeClick={(node) => onSelect(node.id)}
      onBackgroundClick={() => onSelect(null)}
    />
  );
}
