import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { Finding } from "./cbom/types";
import { MetricCard } from "./MetricCard";
import { DetailPanel } from "./DetailPanel";
import { quantumStatusColor, useThemeColors } from "./useThemeColors";

const LEGEND: { status: string; label: string; dotClass: string }[] = [
  { status: "broken-by-shor", label: "Broken by Shor", dotClass: "bg-status-critical" },
  { status: "weakened-by-grover", label: "Weakened by Grover", dotClass: "bg-status-warning" },
  { status: "quantum-safe", label: "Quantum-safe", dotClass: "bg-status-good" },
  { status: "broken-classically", label: "Broken classically", dotClass: "bg-status-neutral-fg" },
];

const MIN_RADIUS = 4;
const MAX_RADIUS = 22;
const LABEL_ZOOM_THRESHOLD = 2.4;

interface GraphNode {
  id: string;
  name: string;
  quantumStatus: string | undefined;
  radius: number;
  finding: Finding;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
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

export function GraphMode({
  findings,
  metrics,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  metrics: { totalAssets: number; brokenByShor: number; contradictions: number; longestShelfLife: number };
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<NodeObject<GraphNode>> | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hoveredId, setHoveredId] = useState<string | undefined>(undefined);
  const [clustered, setClustered] = useState(false);
  const colors = useThemeColors();

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
      name: f.name,
      quantumStatus: f.quantumStatus,
      radius: radiusFor(f.evidence.length),
      finding: f,
    }));
    return { nodes, links: [] };
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

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <MetricCard compact label="Total assets" value={metrics.totalAssets} />
        <MetricCard compact label="Broken by Shor" value={metrics.brokenByShor} />
        <MetricCard compact label="Contradictions" value={metrics.contradictions} />
        <MetricCard compact label="Longest shelf-life (yrs)" value={metrics.longestShelfLife} />
        <button
          type="button"
          onClick={() => setClustered((c) => !c)}
          aria-pressed={clustered}
          className={`ml-auto rounded-sm border px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide ${
            clustered
              ? "border-accent bg-accent text-accent-fg"
              : "border-line text-ink-secondary hover:border-line-strong hover:text-ink"
          }`}
        >
          Cluster by status
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden rounded-sm border border-line">
          <ForceGraph
            ref={fgRef}
            width={size.width}
            height={size.height}
            graphData={graphData}
            backgroundColor={colors["--page"]}
            nodeId="id"
            nodeLabel={() => ""}
            cooldownTime={15000}
            onNodeClick={(node) => onSelect(node.id as string)}
            onNodeHover={(node) => setHoveredId((node?.id as string | undefined) ?? undefined)}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as unknown as GraphNode;
              const isSelected = n.id === selectedId;
              const isHovered = n.id === hoveredId;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, n.radius, 0, 2 * Math.PI);
              ctx.fillStyle = quantumStatusColor(colors, n.quantumStatus);
              ctx.fill();
              if (isSelected || isHovered) {
                ctx.lineWidth = 2 / globalScale;
                ctx.strokeStyle = colors["--accent"];
                ctx.stroke();
              }
              if (globalScale > LABEL_ZOOM_THRESHOLD || isHovered || isSelected) {
                const fontSize = 12 / globalScale;
                ctx.font = `${fontSize}px "Inter", sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillStyle = colors["--ink"];
                ctx.fillText(n.name, node.x ?? 0, (node.y ?? 0) + n.radius + 2 / globalScale);
              }
            }}
            nodePointerAreaPaint={(node, color, ctx) => {
              const n = node as unknown as GraphNode;
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, n.radius, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
          />

          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-sm border border-line bg-surface/90 px-2.5 py-2">
            {LEGEND.map((item) => (
              <div key={item.status} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${item.dotClass}`} aria-hidden="true" />
                <span className="text-[10px] uppercase tracking-wide text-ink-secondary">{item.label}</span>
              </div>
            ))}
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
