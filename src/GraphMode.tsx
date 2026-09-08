import { useState } from "react";
import type { Finding } from "./cbom/types";
import { ClusterGraph } from "./ClusterGraph";
import { TreeGraph } from "./TreeGraph";
import { relationshipFindings } from "./relationshipFindings";

type LayoutMode = "cluster" | "tree";

/**
 * Relationships view: a mode switch picks which layout engine renders the
 * whole view. Cluster mode (ClusterGraph.tsx) is the original force-directed
 * scatter layout, untouched apart from bolder edges. Tree mode (TreeGraph.tsx)
 * is a fully separate, non-physics hierarchical layout. The two are
 * independent code paths on purpose — neither shares layout state with the
 * other, so switching between them can never bleed physics or positions from
 * one into the other. Both read the same call-graph edge data (graphEdges.ts).
 *
 * Filtering out reference/certificate findings happens once, here, rather
 * than inside each graph component -- so Cluster mode and Tree mode can never
 * drift into two different node sets.
 */
export function GraphMode({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  metrics?: unknown;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const [mode, setMode] = useState<LayoutMode>("cluster");
  const graphFindings = relationshipFindings(findings);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
          Layout
        </span>
        <div className="inline-flex rounded-sm border border-line p-0.5" role="group" aria-label="Relationships layout mode">
          <button
            type="button"
            onClick={() => setMode("cluster")}
            aria-pressed={mode === "cluster"}
            className={`rounded-sm px-3 py-1 font-heading text-xs font-semibold uppercase tracking-wider transition-colors ${
              mode === "cluster" ? "bg-ink text-page" : "text-ink-secondary hover:text-ink"
            }`}
          >
            Cluster
          </button>
          <button
            type="button"
            onClick={() => setMode("tree")}
            aria-pressed={mode === "tree"}
            className={`rounded-sm px-3 py-1 font-heading text-xs font-semibold uppercase tracking-wider transition-colors ${
              mode === "tree" ? "bg-ink text-page" : "text-ink-secondary hover:text-ink"
            }`}
          >
            Tree
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {mode === "cluster" ? (
          <ClusterGraph findings={graphFindings} selectedId={selectedId} onSelect={onSelect} />
        ) : (
          <TreeGraph findings={graphFindings} selectedId={selectedId} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}
