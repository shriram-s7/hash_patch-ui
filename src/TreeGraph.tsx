import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, type Finding, type QuantumStatus } from "./cbom/types";
import { DetailPanel } from "./DetailPanel";
import { getNodeColor, FILTERABLE_STATUSES } from "./graphColors";
import { buildCallGraphEdges, buildDataChainEdges, type GraphEdge } from "./graphEdges";
import { ResizableDivider } from "./components/ResizableDivider";
import { GraphLegend } from "./components/GraphLegend";
import { ZoomControls } from "./components/ZoomControls";
import { GraphSearchFilterBar } from "./components/GraphSearchFilterBar";
import { GraphMinimap } from "./components/GraphMinimap";

const NODE_RADIUS = 13;
const TIER_GAP_Y = 110;
const SIBLING_GAP_X = 150;
const COMPONENT_GAP_X = 90;
const MARGIN = 80;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

interface PositionedNode {
  finding: Finding;
  x: number;
  y: number;
}

interface TreeLayout {
  connectedNodes: PositionedNode[];
  edges: { source: string; target: string }[];
  width: number;
  height: number;
}

/**
 * Static forest layout: one root-down tree per connected component (a node
 * with no caller among the others is a root; a fully-cyclic component with
 * no such node falls back to whichever node has the most outgoing edges,
 * preferring one flagged `live-external` reachability as a tie-break —
 * "entry-point-reachable per existing reachability data"), tiers expand via
 * outgoing (callee) edges. Computed once from `findings`/`edges` via
 * useMemo — no simulation, nothing ticks.
 *
 * Isolated findings (no caller/callee edge to anything else in this scan)
 * are NOT positioned by this layout — they render as a separate HTML chip
 * grid below the canvas instead of crowding the SVG as more circles.
 */
function buildTreeLayout(findings: Finding[], edges: { source: string; target: string }[]): TreeLayout {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const outAdj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const f of findings) {
    outAdj.set(f.id, []);
    inDegree.set(f.id, 0);
  }
  const hasEdge = new Set<string>();
  for (const e of edges) {
    outAdj.get(e.source)?.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    hasEdge.add(e.source);
    hasEdge.add(e.target);
  }

  const connectedFindings = findings.filter((f) => hasEdge.has(f.id));

  // Undirected adjacency, for connected-component grouping only.
  const undirected = new Map<string, Set<string>>();
  for (const f of connectedFindings) undirected.set(f.id, new Set());
  for (const e of edges) {
    undirected.get(e.source)?.add(e.target);
    undirected.get(e.target)?.add(e.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const f of connectedFindings) {
    if (visited.has(f.id)) continue;
    const comp: string[] = [];
    const stack = [f.id];
    visited.add(f.id);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of undirected.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    components.push(comp);
  }

  // Tier every node in every component via BFS from its root(s).
  const tiersByComponent: string[][][] = [];
  for (const comp of components) {
    const compSet = new Set(comp);
    let roots = comp.filter((id) => (inDegree.get(id) ?? 0) === 0);
    if (roots.length === 0) {
      // Fully cyclic component: no node with zero callers. Fall back to the
      // node with the most outgoing edges, preferring a live-external
      // (entry-point-reachable) one as a tie-break.
      let best = comp[0];
      let bestScore = -Infinity;
      for (const id of comp) {
        const outCount = (outAdj.get(id) ?? []).filter((t) => compSet.has(t)).length;
        const reachBonus = byId.get(id)?.reachability === "live-external" ? 1000 : 0;
        const score = outCount + reachBonus;
        if (score > bestScore) {
          bestScore = score;
          best = id;
        }
      }
      roots = [best];
    }

    const localTier = new Map<string, number>();
    for (const r of roots) localTier.set(r, 0);
    let frontier = roots;
    let tier = 0;
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const t of outAdj.get(id) ?? []) {
          if (!compSet.has(t) || localTier.has(t)) continue;
          localTier.set(t, tier + 1);
          next.push(t);
        }
      }
      frontier = next;
      tier++;
    }
    // Any leftover node in this component (cyclic partner the BFS above
    // didn't reach through outgoing edges) still renders — appended one
    // tier below the deepest reached, never dropped.
    const maxTier = Math.max(0, ...Array.from(localTier.values()));
    for (const id of comp) {
      if (!localTier.has(id)) localTier.set(id, maxTier + 1);
    }

    const tiersArr: string[][] = [];
    for (const [id, t] of localTier) {
      tiersArr[t] = tiersArr[t] ?? [];
      tiersArr[t].push(id);
    }
    tiersByComponent.push(tiersArr);
  }

  // Lay components out left-to-right; within a component, tiers stack
  // top-down, siblings within a tier spread horizontally and centered.
  const connectedNodes: PositionedNode[] = [];
  let xCursor = MARGIN;
  let maxTreeHeight = 0;
  for (const tiers of tiersByComponent) {
    const widestTier = Math.max(...tiers.map((t) => t.length));
    const componentWidth = Math.max(SIBLING_GAP_X, widestTier * SIBLING_GAP_X);
    tiers.forEach((tierNodes, t) => {
      const tierWidth = tierNodes.length * SIBLING_GAP_X;
      const startX = xCursor + (componentWidth - tierWidth) / 2 + SIBLING_GAP_X / 2;
      tierNodes.forEach((id, i) => {
        const finding = byId.get(id);
        if (!finding) return;
        connectedNodes.push({ finding, x: startX + i * SIBLING_GAP_X, y: MARGIN + t * TIER_GAP_Y });
      });
    });
    maxTreeHeight = Math.max(maxTreeHeight, tiers.length * TIER_GAP_Y);
    xCursor += componentWidth + COMPONENT_GAP_X;
  }

  const width = Math.max(xCursor, MARGIN * 2);
  const height = MARGIN + maxTreeHeight + MARGIN;

  return { connectedNodes, edges, width, height };
}

export function TreeGraph({
  findings,
  selectedId,
  onSelect,
  detailWidth = 340,
  onResizeDetail,
  searchTerm,
  onSearchChange,
  activeFilters,
  onToggleFilter,
}: {
  findings: Finding[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  detailWidth?: number;
  onResizeDetail?: (delta: number) => void;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  activeFilters: string[];
  onToggleFilter: (status: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const panState = useRef<{ dragging: boolean; startX: number; startY: number; viewX: number; viewY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    viewX: 0,
    viewY: 0,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const edges = useMemo(() => buildCallGraphEdges(findings), [findings]);
  // Data-chain edges are rendered ON TOP of the call-graph tree, but do NOT
  // participate in tree layout (roots/tiers) — the layout stays exactly the
  // call-graph shape it always was, and data-chain edges just connect
  // whatever positions the two endpoints land at.
  const dataChainEdges: GraphEdge[] = useMemo(() => buildDataChainEdges(findings), [findings]);
  const layout = useMemo(() => buildTreeLayout(findings, edges), [findings, edges]);
  const positionById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of layout.connectedNodes) map.set(n.finding.id, { x: n.x, y: n.y });
    return map;
  }, [layout]);

  const isolatedFindings = useMemo(() => {
    const connectedIds = new Set(layout.connectedNodes.map((n) => n.finding.id));
    return findings.filter((f) => !connectedIds.has(f.id));
  }, [findings, layout]);

  const selectedFinding = findings.find((f) => f.id === selectedId);

  const cleanSearch = searchTerm.trim().toLowerCase();
  function nodeMatchesFilter(status: QuantumStatus | undefined): boolean {
    if (status === undefined || !FILTERABLE_STATUSES.includes(status)) return true;
    return activeFilters.includes(status);
  }

  const onBackgroundPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Only pan when the background itself is grabbed, not a node — nodes
    // handle their own click via onSelect and must never be draggable.
    if (e.target !== e.currentTarget) return;
    panState.current = { dragging: true, startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onBackgroundPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!panState.current.dragging) return;
    setView((v) => ({
      ...v,
      x: panState.current.viewX + (e.clientX - panState.current.startX),
      y: panState.current.viewY + (e.clientY - panState.current.startY),
    }));
  };
  const onBackgroundPointerUp = () => {
    panState.current.dragging = false;
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * (e.deltaY < 0 ? 1.1 : 0.9))) }));
  };

  function zoomBy(factor: number) {
    setView((v) => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const cx = containerSize.width / 2;
      const cy = containerSize.height / 2;
      const contentX = (cx - v.x) / v.zoom;
      const contentY = (cy - v.y) / v.zoom;
      return { zoom: newZoom, x: cx - contentX * newZoom, y: cy - contentY * newZoom };
    });
  }
  function handleZoomIn() {
    zoomBy(1.25);
  }
  function handleZoomOut() {
    zoomBy(1 / 1.25);
  }
  function handleFitAll() {
    const scale = Math.min(containerSize.width / layout.width, containerSize.height / layout.height, MAX_ZOOM);
    const zoom = Math.max(MIN_ZOOM, scale * 0.92);
    setView({
      zoom,
      x: (containerSize.width - layout.width * zoom) / 2,
      y: (containerSize.height - layout.height * zoom) / 2,
    });
  }
  function handleMinimapNavigate(x: number, y: number) {
    setView((v) => ({ ...v, x: containerSize.width / 2 - x * v.zoom, y: containerSize.height / 2 - y * v.zoom }));
  }

  const minimapNodes = layout.connectedNodes.map((n) => ({ x: n.x, y: n.y, color: getNodeColor(n.finding.quantumStatus) }));
  const minimapViewport = {
    x: -view.x / view.zoom,
    y: -view.y / view.zoom,
    width: containerSize.width / view.zoom,
    height: containerSize.height / view.zoom,
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="border-b pb-2.5" style={{ borderColor: "#21262d" }}>
        <h2 className="text-xl font-bold text-white">Dependency Tree</h2>
        <p className="mt-0.5 max-w-3xl text-sm leading-relaxed" style={{ color: "#8b949e" }}>
          A static hierarchy built from the same call-graph edges as Cluster mode: a root (no caller among
          the other findings, or the entry-point-reachable one in a cyclic group) sits at the top of each
          tier, its callees fan out beneath it, solid arrows show which finding depends on which. Dashed
          amber arrows are same-function data chains (Java only) — one finding's output literally feeding
          another's input within the same method. Nothing here moves on its own — drag the background to
          pan, scroll to zoom; individual nodes are fixed.
        </p>
      </div>

      <GraphSearchFilterBar
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
        activeFilters={activeFilters}
        onToggleFilter={onToggleFilter}
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden rounded-xl border" style={{ borderColor: "#21262d" }}>
          <svg
            width="100%"
            height="100%"
            className="cursor-grab active:cursor-grabbing"
            style={{ backgroundColor: "#0d1117" }}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onBackgroundPointerMove}
            onPointerUp={onBackgroundPointerUp}
            onPointerLeave={onBackgroundPointerUp}
            onWheel={onWheel}
          >
            <defs>
              <marker id="tree-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="#8b949e" />
              </marker>
              <marker id="tree-arrow-chain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="#f59e0b" />
              </marker>
              <marker id="tree-arrow-chain-key" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="#6e7681" />
              </marker>
            </defs>

            <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
              {/* Edges */}
              {edges.map((e) => {
                const from = positionById.get(e.source);
                const to = positionById.get(e.target);
                if (!from || !to) return null;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const dist = Math.hypot(dx, dy) || 1;
                // Shorten the line so the arrowhead lands at the node's edge, not its center.
                const toX = to.x - (dx / dist) * (NODE_RADIUS + 4);
                const toY = to.y - (dy / dist) * (NODE_RADIUS + 4);
                return (
                  <line
                    key={`${e.source}->${e.target}`}
                    x1={from.x}
                    y1={from.y}
                    x2={toX}
                    y2={toY}
                    stroke="#8b949e"
                    strokeWidth={2.5}
                    markerEnd="url(#tree-arrow)"
                  />
                );
              })}

              {/* Same-function data-chain edges (Java only) — visually distinct
                  dashed/colored lines overlaid on the same node positions, never
                  merged with the solid call-graph edges above. Differentiates
                  ciphertext chaining (dashed amber) from key-material binding (dotted gray). */}
              {dataChainEdges.map((e) => {
                const from = positionById.get(e.source);
                const to = positionById.get(e.target);
                if (!from || !to) return null;
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const dist = Math.hypot(dx, dy) || 1;
                const toX = to.x - (dx / dist) * (NODE_RADIUS + 4);
                const toY = to.y - (dy / dist) * (NODE_RADIUS + 4);
                const isKeyMaterial = e.chainType === "key_material";
                return (
                  <line
                    key={`chain:${e.source}->${e.target}`}
                    x1={from.x}
                    y1={from.y}
                    x2={toX}
                    y2={toY}
                    stroke={isKeyMaterial ? "#6e7681" : "#f59e0b"}
                    strokeWidth={isKeyMaterial ? 1.5 : 2}
                    strokeDasharray={isKeyMaterial ? "2 3" : "4 3"}
                    markerEnd={isKeyMaterial ? "url(#tree-arrow-chain-key)" : "url(#tree-arrow-chain)"}
                  />
                );
              })}

              {/* Nodes */}
              {layout.connectedNodes.map(({ finding, x, y }) => {
                const isSelected = finding.id === selectedId;
                const isHovered = finding.id === hoveredId;
                const passesFilter = nodeMatchesFilter(finding.quantumStatus);
                const isSearchActive = cleanSearch !== "";
                const matchesSearch = !isSearchActive || displayName(finding).toLowerCase().includes(cleanSearch);
                const opacity = !passesFilter ? 0.06 : isSearchActive && !matchesSearch ? 0.2 : 1;
                const glow = passesFilter && isSearchActive && matchesSearch;
                return (
                  <g
                    key={finding.id}
                    transform={`translate(${x} ${y})`}
                    onClick={() => onSelect(finding.id)}
                    onMouseEnter={() => setHoveredId(finding.id)}
                    onMouseLeave={() => setHoveredId(undefined)}
                    style={{ cursor: "pointer", opacity }}
                  >
                    <circle
                      r={NODE_RADIUS}
                      fill={getNodeColor(finding.quantumStatus)}
                      stroke={isSelected || isHovered || glow ? "#f0f6fc" : "transparent"}
                      strokeWidth={2}
                      style={glow && !isSelected && !isHovered ? { filter: "drop-shadow(0 0 4px #ffffff)" } : undefined}
                    />
                    <text
                      y={NODE_RADIUS + 14}
                      textAnchor="middle"
                      fontSize={11}
                      fontFamily="Inter, sans-serif"
                      fill="#f0f6fc"
                    >
                      {displayName(finding)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFitAll={handleFitAll} />
          <GraphMinimap nodes={minimapNodes} viewport={minimapViewport} onNavigate={handleMinimapNavigate} />
          <GraphLegend />
        </div>

        {selectedFinding && (
          <>
            {onResizeDetail && <ResizableDivider onResize={onResizeDetail} />}
            <div className="shrink-0 overflow-hidden" style={{ width: detailWidth, minWidth: 320, transition: "width 200ms ease" }}>
              <DetailPanel finding={selectedFinding} onClose={() => onSelect(undefined)} />
            </div>
          </>
        )}
      </div>

      {isolatedFindings.length > 0 && (
        <div className="shrink-0 max-h-[160px] overflow-y-auto rounded-xl border p-3" style={{ background: "#161b22", borderColor: "#21262d" }}>
          <div className="mb-2 text-xs leading-relaxed" style={{ color: "#8b949e" }}>
            <span className="font-semibold text-white">
              {isolatedFindings.length} unconnected finding{isolatedFindings.length === 1 ? "" : "s"}
            </span>{" "}
            — no direct caller/callee edge to any other finding in this scan. An honest result, not a bug.
          </div>
          <div className="flex flex-wrap gap-2">
            {isolatedFindings.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelect(f.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors"
                style={{
                  borderColor: f.id === selectedId ? "#3b82f6" : "#21262d",
                  background: "#0d1117",
                }}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getNodeColor(f.quantumStatus) }} />
                <span className="text-xs" style={{ color: "#f0f6fc" }}>{displayName(f)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
