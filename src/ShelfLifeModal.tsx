import { useEffect } from "react";
import type { ShelfLifeEntry } from "./cbom/types";

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
};

/** Solid fill for "high" (well-grounded category), dashed outline for
 * "medium" (catch-all / placeholder category) — mirrors the solid-vs-
 * dashed confidence convention used elsewhere in the app for measured vs.
 * estimated data, applied here to category-grounding confidence instead. */
function ConfidenceBadge({ confidence }: { confidence: string | undefined }) {
  if (confidence === undefined) return null;
  const isHigh = confidence === "high";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wider ${
        isHigh
          ? "border border-ink bg-surface-2 text-ink"
          : "border border-dashed border-line-strong text-ink-secondary"
      }`}
    >
      {CONFIDENCE_LABEL[confidence] ?? confidence}
    </span>
  );
}

export function ShelfLifeModal({
  assetName,
  entry,
  onClose,
}: {
  assetName: string;
  entry: ShelfLifeEntry;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Shelf-life calculation for ${assetName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-sm border border-line-strong bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2 border-b border-line pb-3">
          <div>
            <div className="font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Shelf-life calculation · {assetName}
            </div>
            <h2 className="mt-0.5 font-heading text-lg font-medium capitalize text-ink tracking-tight">
              {entry.category.replace(/_/g, " ")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-sm border border-line px-2.5 py-1 font-heading text-[10px] font-semibold uppercase tracking-wider text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
          >
            Close
          </button>
        </div>

        {/* Big, prominent years value */}
        <div className="mb-4 flex items-end gap-3">
          <div className="font-heading text-5xl font-bold tabular-nums text-ink leading-none">
            {entry.shelfLifeYears ?? "—"}
          </div>
          <div className="pb-1 font-heading text-xs uppercase tracking-wider text-ink-muted">
            years of required confidentiality
          </div>
          <div className="ml-auto pb-1">
            <ConfidenceBadge confidence={entry.confidence} />
          </div>
        </div>

        {/* Matched signal: identifier/pattern if present, locator always */}
        <div className="mb-4 rounded-sm border border-line bg-page p-3">
          <h3 className="mb-1.5 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
            Matched signal
          </h3>
          {entry.matchedIdentifier !== undefined && entry.matchedPattern !== undefined ? (
            <p className="font-mono text-xs text-ink">
              Identifier <span className="font-semibold">{entry.matchedIdentifier}</span> matched
              ontology pattern <span className="font-semibold">{entry.matchedPattern}</span>
            </p>
          ) : (
            <p className="font-mono text-xs text-ink-secondary">
              Category: <span className="font-semibold text-ink">{entry.category}</span>
              {entry.matchedIdentifier !== undefined && (
                <>
                  {" "}· identifier <span className="font-semibold text-ink">{entry.matchedIdentifier}</span>
                </>
              )}
            </p>
          )}
          {entry.locator !== undefined && (
            <p className="mt-1 break-all font-mono text-[11px] text-ink-muted">{entry.locator}</p>
          )}
        </div>

        {/* Tie-break: only rendered when the data actually carries losing candidates */}
        {entry.alsoMatched !== undefined && entry.alsoMatched.length > 0 && (
          <div className="mb-4 rounded-sm border border-line bg-page p-3">
            <h3 className="mb-1.5 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Longest-shelf-life-wins tie-break
            </h3>
            <ul className="space-y-0.5 font-mono text-xs text-ink-secondary">
              {entry.alsoMatched.map((m, i) => (
                <li key={i}>
                  Also matched: {m.category}
                  {m.shelfLifeYears !== undefined ? ` (${m.shelfLifeYears}yr)` : ""} —{" "}
                  {entry.category}'s longer shelf-life was used
                </li>
              ))}
            </ul>
          </div>
        )}

        {entry.statutoryBasis !== undefined && (
          <div className="mb-4">
            <h3 className="mb-1.5 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Statutory basis
            </h3>
            <p className="text-xs leading-relaxed text-ink">{entry.statutoryBasis}</p>
          </div>
        )}

        {entry.moscaNote !== undefined && (
          <div className="mb-4">
            <h3 className="mb-1.5 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Mosca's inequality note
            </h3>
            <p className="text-xs leading-relaxed text-ink-secondary">{entry.moscaNote}</p>
          </div>
        )}

        <div className="rounded-sm border border-dashed border-line-strong bg-page p-3">
          <h3 className="mb-1 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
            Honesty disclaimer
          </h3>
          <p className="text-[11px] leading-relaxed text-ink-muted">
            This figure is a reasonable-effort, conservative default from Hash Patch's demonstration
            ontology (<span className="font-mono">ontology/data_sensitivity.yaml</span>) — it is NOT
            derived from a legal database, NOT verified against the DPDP Act 2023 or any other statute,
            and NOT reviewed by counsel. A real deployment must replace these figures with
            organisation-specific, legally-reviewed numbers before using this to inform an actual
            migration-priority decision.
          </p>
        </div>
      </div>
    </div>
  );
}
