import { useMemo, useRef, useState } from "react";
import { displayName, type Finding } from "./cbom/types";
import { DetailPanel } from "./DetailPanel";
import { quantumStatusColor, useThemeColors } from "./useThemeColors";
import { buildCallGraphEdges, buildDataChainEdges, type GraphEdge } from "./graphEdges";

const NODE_RADIUS = 13;
const TIER_GAP_Y = 110;
const SIBLING_GAP_X = 150;
const COMPONENT_GAP_X = 90;
const ISOLATED_GAP_Y = 130;
const ISOLATED_COL_GAP = 130;
const ISOLATED_ROW_GAP = 70;
const ISOLATED_COLS = 6;
const MARGIN = 80;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.5;

const LEGEND: { status: string; label: string; dotClass: string }[] = [
  { status: "CRITICAL", label: "Critical", dotClass: "bg-status-critical" },
  { status: "HIGH", label: "High", dotClass: "bg-status-high" },
  { status: "MEDIUM", label: "Medium", dotClass: "bg-status-medium" },
  { status: "LOW", label: "Low", dotClass: "bg-status-low" },
];

interface PositionedNode {
  finding: Finding;
  x: number;
  y: number;
}

interface TreeLayout {
  connectedNodes: PositionedNode[];
  isolatedNodes: PositionedNode[];
  edges: { source: string; target: string }[];
  width: number;
  height: number;
  isolatedLabelY: number;
}

/**
 * Static forest layout: one root-down tree per connected component (a node
 * with no caller among the others is a root; a fully-cyclic component with
 * no such node falls back to whichever node has the most outgoing edges,
 * preferring one flagged `live-external` reachability as a tie-break —
 * "entry-point-reachable per existing reachability data"), tiers expand via
 * outgoing (callee) edges. Computed once from `findings`/`edges` via
 * useMemo — no simulation, nothing ticks.
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

  const isolatedFindings = findings.filter((f) => !hasEdge.has(f.id));
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
  const tierOf = new Map<string, number>();
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
      tierOf.set(id, t);
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

  const treeAreaWidth = Math.max(xCursor, MARGIN * 2);
  const isolatedLabelY = MARGIN + maxTreeHeight + ISOLATED_GAP_Y;

  const isolatedNodes: PositionedNode[] = isolatedFindings.map((finding, i) => {
    const col = i % ISOLATED_COLS;
    const row = Math.floor(i / ISOLATED_COLS);
    return {
      finding,
      x: MARGIN + col * ISOLATED_COL_GAP + ISOLATED_COL_GAP / 2,
      y: isolatedLabelY + 40 + row * ISOLATED_ROW_GAP,
    };
  });

  const isolatedRows = Math.ceil(isolatedFindings.length / ISOLATED_COLS);
  const height =
    isolatedFindings.length > 0
      ? isolatedLabelY + 40 + isolatedRows * ISOLATED_ROW_GAP + MARGIN
      : MARGIN + maxTreeHeight + MARGIN;
  const width = Math.max(treeAreaWidth, ISOLATED_COLS * ISOLATED_COL_GAP + MARGIN * 2);

  return { connectedNodes, isolatedNodes, edges, width, height, isolatedLabelY };
}

export function TreeGraph({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const colors = useThemeColors();
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const panState = useRef<{ dragging: boolean; startX: number; startY: number; viewX: number; viewY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    viewX: 0,
    viewY: 0,
  });

  const edges = useMemo(() => buildCallGraphEdges(findings), [findings]);
  // Data-chain edges are rendered ON TOP of the call-graph tree, but do NOT
  // participate in tree layout (roots/tiers) — the layout stays exactly the
  // call-graph shape it always was, and data-chain edges just connect
  // whatever positions the two endpoints land at (tree area or isolated
  // grid), the same way `edges` connects tree-area nodes.
  const dataChainEdges: GraphEdge[] = useMemo(() => buildDataChainEdges(findings), [findings]);
  const layout = useMemo(() => buildTreeLayout(findings, edges), [findings, edges]);
  const positionById = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const n of [...layout.connectedNodes, ...layout.isolatedNodes]) map.set(n.finding.id, { x: n.x, y: n.y });
    return map;
  }, [layout]);

  const selectedFinding = findings.find((f) => f.id === selectedId);

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

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="border-b border-line pb-2.5">
        <h2 className="font-heading text-[26px] font-medium text-ink tracking-tight">Dependency Tree</h2>
        <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
          A static hierarchy built from the same call-graph edges as Cluster mode: a root (no caller among
          the other findings, or the entry-point-reachable one in a cyclic group) sits at the top of each
          tier, its callees fan out beneath it, solid arrows show which finding depends on which. Dashed
          amber arrows are same-function data chains (Java only) — one finding's output literally feeding
          another's input within the same method. Nothing here moves on its own — drag the background to
          pan, scroll to zoom; individual nodes are fixed.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-sm border border-line">
          <svg
            width="100%"
            height="100%"
            className="cursor-grab active:cursor-grabbing"
            style={{ backgroundColor: colors["--page"] }}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onBackgroundPointerMove}
            onPointerUp={onBackgroundPointerUp}
            onPointerLeave={onBackgroundPointerUp}
            onWheel={onWheel}
          >
            <defs>
              <marker
                id="tree-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill={colors["--ink-secondary"]} />
              </marker>
              <marker
                id="tree-arrow-chain"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill={colors["--status-warning"]} />
              </marker>
              <marker
                id="tree-arrow-chain-key"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill={colors["--ink-muted"] ?? "#9ca3af"} />
              </marker>
            </defs>

            <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
              {/* Isolated-section separator + label */}
              {layout.isolatedNodes.length > 0 && (
                <>
                  <line
                    x1={0}
                    y1={layout.isolatedLabelY - 20}
                    x2={layout.width}
                    y2={layout.isolatedLabelY - 20}
                    stroke={colors["--line"]}
                    strokeWidth={1}
                    strokeDasharray="4 5"
                  />
                  <text
                    x={MARGIN}
                    y={layout.isolatedLabelY}
                    fill={colors["--ink-muted"]}
                    fontSize={12}
                    fontFamily="Inter, sans-serif"
                    fontWeight={600}
                    style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}
                  >
                    Unconnected findings ({layout.isolatedNodes.length}) — no direct caller/callee edge
                  </text>
                </>
              )}

              {/* Edges (tree area only — isolated nodes have none by definition) */}
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
                    stroke={colors["--ink-secondary"]}
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
                    stroke={isKeyMaterial ? (colors["--ink-muted"] ?? "#9ca3af") : colors["--status-warning"]}
                    strokeWidth={isKeyMaterial ? 1.5 : 2}
                    strokeDasharray={isKeyMaterial ? "2 3" : "4 3"}
                    markerEnd={isKeyMaterial ? "url(#tree-arrow-chain-key)" : "url(#tree-arrow-chain)"}
                  />
                );
              })}

              {/* Nodes */}
              {[...layout.connectedNodes, ...layout.isolatedNodes].map(({ finding, x, y }) => {
                const isSelected = finding.id === selectedId;
                const isHovered = finding.id === hoveredId;
                return (
                  <g
                    key={finding.id}
                    transform={`translate(${x} ${y})`}
                    onClick={() => onSelect(finding.id)}
                    onMouseEnter={() => setHoveredId(finding.id)}
                    onMouseLeave={() => setHoveredId(undefined)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      r={NODE_RADIUS}
                      fill={quantumStatusColor(colors, finding.quantumStatus)}
                      stroke={isSelected || isHovered ? colors["--ink"] : "transparent"}
                      strokeWidth={2}
                    />
                    <text
                      y={NODE_RADIUS + 14}
                      textAnchor="middle"
                      fontSize={11}
                      fontFamily="Inter, sans-serif"
                      fill={colors["--ink"]}
                    >
                      {displayName(finding)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-sm border border-line bg-surface/90 px-2.5 py-2">
            {LEGEND.map((item) => (
              <div key={item.status} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${item.dotClass}`} aria-hidden="true" />
                <span className="text-[11px] uppercase tracking-wide text-ink-secondary">{item.label}</span>
              </div>
            ))}
            <div className="mt-1 flex flex-col gap-1 border-t border-line pt-1">
              <div className="flex items-center gap-1.5">
                <span className="h-0 w-3 border-t-2 border-ink-secondary" aria-hidden="true" />
                <span className="text-[11px] uppercase tracking-wide text-ink-secondary">Cross-function call</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-0 w-3 border-t-2 border-dashed"
                  style={{ borderColor: colors["--status-warning"] }}
                  aria-hidden="true"
                />
                <span className="text-[11px] uppercase tracking-wide text-ink-secondary">Ciphertext chain</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-0 w-3 border-t-[1.5px] border-dotted"
                  style={{ borderColor: colors["--ink-muted"] ?? "#9ca3af" }}
                  aria-hidden="true"
                />
                <span className="text-[11px] uppercase tracking-wide text-ink-secondary">Key-material binding</span>
              </div>
            </div>
          </div>
        </div>

        {selectedFinding && (
          <div className="w-[340px] shrink-0 overflow-y-auto">
            <DetailPanel finding={selectedFinding} onClose={() => onSelect(undefined)} />
          </div>
        )}
      </div>
    </div>
  );
}
