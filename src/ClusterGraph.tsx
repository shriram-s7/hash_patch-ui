import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import { displayName, type DataChainType, type Finding, type QuantumStatus } from "./cbom/types";
import { DetailPanel } from "./DetailPanel";
import { quantumStatusColor, useThemeColors } from "./useThemeColors";
import { buildCallGraphEdges, buildDataChainEdges } from "./graphEdges";

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
 * The ONLY change from that original is edge visibility: real call-graph
 * edges now render as a solid, higher-contrast charcoal band instead of a
 * faded hairline (see `linkColor`/`linkWidth` below) — everything else in
 * this file is byte-for-byte the same logic as before.
 */
export function ClusterGraph({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
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

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div>
          <h2 className="font-heading text-[26px] font-medium text-ink tracking-tight">
            Asset Relationships
          </h2>
          <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
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
          className={`rounded-sm border px-3 py-1.5 font-heading text-xs font-semibold uppercase tracking-wider transition-colors ${
            clustered
              ? "border-ink bg-surface-2 text-ink"
              : "border-line text-ink-secondary hover:border-line-strong hover:text-ink"
          }`}
        >
          {clustered ? "Clustered by status" : "Cluster by status"}
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
            linkColor={(link) => {
              const gl = link as unknown as GraphLink;
              if (gl.kind === "dataChain") {
                return gl.chainType === "key_material"
                  ? (colors["--ink-muted"] ?? "#9ca3af")
                  : colors["--status-warning"];
              }
              return colors["--ink-secondary"];
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
              ctx.beginPath();
              ctx.arc(node.x ?? 0, node.y ?? 0, n.radius, 0, 2 * Math.PI);
              ctx.fillStyle = quantumStatusColor(colors, n.quantumStatus);
              ctx.fill();
              if (isSelected || isHovered) {
                ctx.lineWidth = 2 / globalScale;
                ctx.strokeStyle = colors["--ink"];
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
