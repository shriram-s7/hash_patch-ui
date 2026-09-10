import { useState } from "react";
import type { Finding } from "./cbom/types";
import { ClusterGraph } from "./ClusterGraph";
import { TreeGraph } from "./TreeGraph";
import { relationshipFindings } from "./relationshipFindings";
import { FILTERABLE_STATUSES } from "./graphColors";

type LayoutMode = "cluster" | "tree";

const DETAIL_WIDTH_KEY = "rel-detail-width";
const DETAIL_WIDTH_DEFAULT = 340;
const DETAIL_WIDTH_MIN = 320;
const DETAIL_WIDTH_MAX = 480;

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
 *
 * The right-side detail panel's width is also owned here (not inside
 * ClusterGraph/TreeGraph) so it stays in sync across a mode switch instead
 * of resetting to the default every time the layout engine changes.
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

  // Search/filter state lives here (not inside ClusterGraph/TreeGraph) for
  // the same reason detailWidth does -- so it survives a Cluster/Tree mode
  // switch instead of resetting.
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>(FILTERABLE_STATUSES);
  const toggleFilter = (status: string) => {
    setActiveFilters((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  };

  const [detailWidth, setDetailWidth] = useState(() => {
    const saved = localStorage.getItem(DETAIL_WIDTH_KEY);
    return saved ? parseInt(saved) : DETAIL_WIDTH_DEFAULT;
  });

  const handleDetailResize = (delta: number) => {
    if (delta === 0) {
      setDetailWidth(DETAIL_WIDTH_DEFAULT);
      localStorage.removeItem(DETAIL_WIDTH_KEY);
      return;
    }
    setDetailWidth((w) => {
      // The divider sits to the LEFT of this panel, so dragging it right
      // (positive delta) should shrink the panel, not grow it.
      const next = Math.min(DETAIL_WIDTH_MAX, Math.max(DETAIL_WIDTH_MIN, w - delta));
      localStorage.setItem(DETAIL_WIDTH_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-end gap-2">
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Relationships layout mode" style={{ borderColor: "#30363d" }}>
          <button
            type="button"
            onClick={() => setMode("cluster")}
            aria-pressed={mode === "cluster"}
            className="rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors"
            style={mode === "cluster" ? { background: "#3b82f6", color: "#ffffff" } : { color: "#8b949e" }}
          >
            Cluster
          </button>
          <button
            type="button"
            onClick={() => setMode("tree")}
            aria-pressed={mode === "tree"}
            className="rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors"
            style={mode === "tree" ? { background: "#3b82f6", color: "#ffffff" } : { color: "#8b949e" }}
          >
            Tree
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {mode === "cluster" ? (
          <ClusterGraph
            findings={graphFindings}
            selectedId={selectedId}
            onSelect={onSelect}
            detailWidth={detailWidth}
            onResizeDetail={handleDetailResize}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            activeFilters={activeFilters}
            onToggleFilter={toggleFilter}
          />
        ) : (
          <TreeGraph
            findings={graphFindings}
            selectedId={selectedId}
            onSelect={onSelect}
            detailWidth={detailWidth}
            onResizeDetail={handleDetailResize}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            activeFilters={activeFilters}
            onToggleFilter={toggleFilter}
          />
        )}
      </div>
    </div>
  );
}
