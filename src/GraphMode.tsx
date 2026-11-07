import { useEffect, useRef, useState } from "react";
import type { Finding } from "./cbom/types";
import { ClusterGraph } from "./ClusterGraph";
import { TreeGraph } from "./TreeGraph";
import { relationshipFindings } from "./relationshipFindings";
import { FILTERABLE_STATUSES } from "./graphColors";
import { FEATURE_GUIDED_UI } from "./tour/flags";
import { Coachmark } from "./tour/Coachmark";
import { tourStore } from "./tour/store";
import { useTourStep } from "./tour/useTourStep";

type LayoutMode = "cluster" | "tree";

const RELATIONSHIPS_INTRO_TOUR_ID = "relationships.intro";
const STEP_CLUSTER_BY_STATUS = "relationships.intro.cluster-by-status";
const STEP_LAYOUT_TOGGLE = "relationships.intro.layout-toggle";
const RELATIONSHIPS_INTRO_STEPS = [STEP_CLUSTER_BY_STATUS, STEP_LAYOUT_TOGGLE];

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

  // Tour refs & step hooks for relationships.intro
  const clusterButtonRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const showClusterStep = useTourStep(STEP_CLUSTER_BY_STATUS);
  const showToggleStep = useTourStep(STEP_LAYOUT_TOGGLE);

  // Auto-arm relationships.intro tour once on first entry to Asset Relationships view
  useEffect(() => {
    if (!FEATURE_GUIDED_UI) return;
    if (graphFindings.length === 0) return;
    if (tourStore.hasSeen(RELATIONSHIPS_INTRO_TOUR_ID)) return;
    if (tourStore.getSnapshot().activeTour) return;
    tourStore.startTour(RELATIONSHIPS_INTRO_TOUR_ID, RELATIONSHIPS_INTRO_STEPS);
  }, [graphFindings.length]);

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
        <div
          ref={FEATURE_GUIDED_UI ? toggleRef : undefined}
          className="inline-flex rounded-lg border p-0.5"
          role="group"
          aria-label="Relationships layout mode"
          style={{ borderColor: "#30363d" }}
        >
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
            clusterButtonRef={FEATURE_GUIDED_UI ? clusterButtonRef : undefined}
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

      {FEATURE_GUIDED_UI && showClusterStep && (
        <Coachmark
          id={STEP_CLUSTER_BY_STATUS}
          anchorRef={clusterButtonRef}
          placement="bottom-end"
          title="Group by quantum status"
          body="Pulls the graph into four clusters — Shor-broken, Grover-weakened, classically broken, quantum-safe — so the shape of the risk is visible at a glance."
          step={[1, 2]}
          nextLabel="Next →"
          skipLabel="Skip tour"
          onNext={() => tourStore.nextStep()}
          onSkip={() => {
            tourStore.markSeen(RELATIONSHIPS_INTRO_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}

      {FEATURE_GUIDED_UI && showToggleStep && (
        <Coachmark
          id={STEP_LAYOUT_TOGGLE}
          anchorRef={toggleRef}
          placement="bottom-end"
          title="Two ways to read it"
          body="Cluster shows how findings group. Tree shows the call hierarchy that makes them reachable."
          step={[2, 2]}
          nextLabel="Done"
          skipLabel=""
          onNext={() => {
            tourStore.markSeen(RELATIONSHIPS_INTRO_TOUR_ID);
            tourStore.endTour();
          }}
          onSkip={() => {
            tourStore.markSeen(RELATIONSHIPS_INTRO_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}
    </div>
  );
}
