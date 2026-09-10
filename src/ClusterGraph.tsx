import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import { displayName, type DataChainType, type Finding, type QuantumStatus } from "./cbom/types";
import { DetailPanel } from "./DetailPanel";
import { getNodeColor, FILTERABLE_STATUSES } from "./graphColors";
import { buildCallGraphEdges, buildDataChainEdges } from "./graphEdges";
import { ResizableDivider } from "./components/ResizableDivider";
import { GraphLegend } from "./components/GraphLegend";
import { ZoomControls } from "./components/ZoomControls";
import { GraphSearchFilterBar } from "./components/GraphSearchFilterBar";
import { GraphMinimap } from "./components/GraphMinimap";

const MIN_RADIUS = 4;
const MAX_RADIUS = 22;
const LABEL_ZOOM_THRESHOLD = 2.4;

interface GraphNode {
  id: string;
  name: string;
  quantumStatus: QuantumStatus | undefined;
  radius: number;
  finding: Finding;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

interface GraphLink {
  source: string;
  target: string;
  kind: "call" | "dataChain";
  chainType?: DataChainType;
}

// Fixed anchor points nodes are pulled toward when "cluster by status" is on.
const CLUSTER_CENTERS: Record<string, { x: number; y: number }> = {
  "broken-by-shor": { x: -180, y: -140 },
  "weakened-by-grover": { x: 180, y: -140 },
  "quantum-safe": { x: -180, y: 140 },
  neutral: { x: 180, y: 140 },
};

function clusterKey(status: string | undefined): string {
  return status === "broken-by-shor" || status === "weakened-by-grover" || status === "quantum-safe"
    ? status
    : "neutral";
}

function radiusFor(evidenceCount: number): number {
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(evidenceCount) * 2.2);
}

/**
 * The original force-directed scatter layout (pre-tree-layout-experiment) —
 * physics, node positions, and "cluster by status" behavior are untouched.
 * Node fill color, the legend, zoom controls, search/filter, and the detail
 * panel wiring are shared with Tree mode via graphColors.ts and the small
 * components in ./components/.
 */
export function ClusterGraph({
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
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined);
  const [clustered, setClustered] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = findings.map((f) => ({
      id: f.id,
      name: displayName(f),
      quantumStatus: f.quantumStatus,
      radius: radiusFor(f.evidence.length),
      finding: f,
    }));

    const links: GraphLink[] = [
      ...buildCallGraphEdges(findings).map((e) => ({ ...e, kind: "call" as const })),
      ...buildDataChainEdges(findings).map((e) => ({ ...e, kind: "dataChain" as const, chainType: e.chainType })),
    ];

    return { nodes, links };
  }, [findings]);

  // "Cluster by status" adds a custom d3-force pulling each node toward a
  // fixed per-status anchor; turning it off removes the force and reheats
  // the simulation back to free-form physics.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (clustered) {
      fg.d3Force("cluster", (alpha: number) => {
        for (const node of graphData.nodes) {
          const target = CLUSTER_CENTERS[clusterKey(node.quantumStatus)];
          if (node.x === undefined || node.y === undefined) continue;
          node.vx = (node.vx ?? 0) + (target.x - node.x) * alpha * 0.25;
          node.vy = (node.vy ?? 0) + (target.y - node.y) * alpha * 0.25;
        }
      });
    } else {
      fg.d3Force("cluster", null);
      // Removing the cluster force alone leaves nodes packed into two tiny,
      // widely-separated blobs — charge repulsion is short-range, so it
      // can't pull them back across the whole canvas on its own. Scatter
      // them back out before reheating so repulsion has room to work with.
      for (const node of graphData.nodes) {
        node.x = (Math.random() - 0.5) * 400;
        node.y = (Math.random() - 0.5) * 400;
      }
    }
    // cooldownTime hard-stops the render loop after it elapses from mount;
    // reheating the simulation alone recomputes positions but won't repaint
    // once that loop has stopped, so explicitly resume it too.
    fg.resumeAnimation();
    fg.d3ReheatSimulation();
  }, [clustered, graphData]);

  const selectedFinding = findings.find((f) => f.id === selectedId);

  const cleanSearch = searchTerm.trim().toLowerCase();

  function nodeMatchesFilter(status: QuantumStatus | undefined): boolean {
    if (status === undefined || !FILTERABLE_STATUSES.includes(status)) return true;
    return activeFilters.includes(status);
  }

  function handleZoomIn() {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(fg.zoom() * 1.4, 300);
  }
  function handleZoomOut() {
    const fg = fgRef.current;
    if (!fg) return;
    fg.zoom(fg.zoom() / 1.4, 300);
  }
  function handleFitAll() {
    fgRef.current?.zoomToFit(400, 40);
  }
  function handleMinimapNavigate(x: number, y: number) {
    fgRef.current?.centerAt(x, y, 400);
  }

  const minimapNodes = graphData.nodes
    .filter((n) => n.x !== undefined && n.y !== undefined)
    .map((n) => ({ x: n.x as number, y: n.y as number, color: getNodeColor(n.quantumStatus) }));

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5" style={{ borderColor: "#21262d" }}>
        <div>
          <h2 className="text-xl font-bold text-white">Asset Relationships</h2>
          <p className="mt-0.5 max-w-3xl text-sm leading-relaxed" style={{ color: "#8b949e" }}>
            Solid edges are real call-graph edges between findings whose enclosing functions directly call
            each other (Hash Patch's reachability call graph). Dashed edges are same-function data chains
            (Java only) — one finding's output literally feeds another's input within the same method. A
            finding with neither relationship to another finding renders isolated — that is an honest
            result, not a bug.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setClustered((c) => !c)}
          aria-pressed={clustered}
          className="rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-white/5"
          style={{ borderColor: clustered ? "#3b82f6" : "#30363d", color: clustered ? "#3b82f6" : "#c9d1d9" }}
        >
          {clustered ? "Clustered by status" : "Cluster by status"}
        </button>
      </div>

      <GraphSearchFilterBar
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
        activeFilters={activeFilters}
        onToggleFilter={onToggleFilter}
      />

      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden rounded-xl border" style={{ borderColor: "#21262d" }}>
          <ForceGraph
            ref={fgRef}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor="#0d1117"
            nodeId="id"
            nodeLabel={() => ""}
            linkColor={(link) => {
              const gl = link as unknown as GraphLink;
              if (gl.kind === "dataChain") {
                return gl.chainType === "key_material" ? "#6e7681" : "#f59e0b";
              }
              return "#8b949e";
            }}
            linkWidth={(link) => {
              const gl = link as unknown as GraphLink;
              if (gl.kind === "dataChain") {
                return gl.chainType === "key_material" ? 1.5 : 2;
              }
              return 2.5;
            }}
            linkLineDash={(link) => {
              const gl = link as unknown as GraphLink;
              if (gl.kind === "dataChain") {
                return gl.chainType === "key_material" ? [2, 3] : [4, 3];
              }
              return null;
            }}
            cooldownTime={15000}
            onNodeClick={(node) => onSelect(node.id as string)}
            onNodeHover={(node) => setHoveredId((node?.id as string | undefined) ?? undefined)}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as unknown as GraphNode;
              const isSelected = n.id === selectedId;
              const isHovered = n.id === hoveredId;

              const passesFilter = nodeMatchesFilter(n.quantumStatus);
              const matchesSearch = cleanSearch === "" || n.name.toLowerCase().includes(cleanSearch);
              const isSearchActive = cleanSearch !== "";

              let opacity = 1;
              if (!passesFilter) opacity = 0.06;
              else if (isSearchActive && !matchesSearch) opacity = 0.2;

              ctx.save();
              ctx.globalAlpha = opacity;

              if (passesFilter && isSearchActive && matchesSearch) {
                ctx.shadowColor = "#ffffff";
                ctx.shadowBlur = 10;
              }

              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, n.radius, 0, 2 * Math.PI);
              ctx.fillStyle = getNodeColor(n.quantumStatus);
              ctx.fill();

              ctx.shadowBlur = 0;

              if (isSelected || isHovered) {
                ctx.lineWidth = 2 / globalScale;
                ctx.strokeStyle = "#f0f6fc";
                ctx.stroke();
              } else if (passesFilter && isSearchActive && matchesSearch) {
                ctx.lineWidth = 2 / globalScale;
                ctx.strokeStyle = "#ffffff";
                ctx.stroke();
              }

              if (globalScale > LABEL_ZOOM_THRESHOLD || isHovered || isSelected) {
                const fontSize = 12 / globalScale;
                ctx.font = `${fontSize}px "Inter", sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = "#f0f6fc";
                ctx.fillText(n.name, node.x ?? 0, (node.y ?? 0) + n.radius + 2 / globalScale);
              }
              ctx.restore();
            }}
            nodePointerAreaPaint={(node, color, ctx) => {
              const n = node as unknown as GraphNode;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, n.radius, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
          />

          <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFitAll={handleFitAll} />
          <GraphMinimap nodes={minimapNodes} onNavigate={handleMinimapNavigate} />
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
    </div>
  );
}
