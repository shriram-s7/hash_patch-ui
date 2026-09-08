import { useEffect } from "react";
import type { Finding } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-status-critical text-white",
  high: "bg-status-critical text-white",
  medium: "bg-status-warning text-status-warning-fg",
  low: "bg-status-neutral-bg text-status-neutral-fg",
};

export interface IssuesDrawerItem {
  finding: Finding;
  line: number | undefined;
  excerpt: string;
}

/**
 * Slide-over drawer for "All Issues" in the Code view — same interaction
 * pattern as the app's other right-side detail panels (backdrop + fixed
 * panel, Escape/backdrop-click to close), stacked cards instead of a
 * horizontally-scrolling chip strip so 8+ findings all stay readable
 * without overflow.
 */
export function IssuesDrawer({
  items,
  selectedId,
  onSelect,
  onClose,
}: {
  items: IssuesDrawerItem[];
  selectedId: string | undefined;
  onSelect: (findingId: string) => void;
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
      aria-label="All issues in this file"
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={onClose}
    >
      {/* Distinct surface tone (surface-2, a step off the plain `surface`
          panels used elsewhere) + a left border weight accent — grayscale
          only, per the app's color rule, so this reads as a deliberate
          drawer rather than a re-skinned modal. */}
      <div
        className="animate-drawer-in flex h-full w-full max-w-[440px] flex-col overflow-hidden border-l-4 border-ink-secondary bg-surface-2 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-line p-4">
          <div>
            <div className="font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              All issues in this file
            </div>
            <h2 className="mt-0.5 font-heading text-lg font-medium text-ink tracking-tight">
              {items.length} finding{items.length === 1 ? "" : "s"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-sm border border-line px-2.5 py-1 font-heading text-[10px] font-semibold uppercase tracking-wider text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {items.map(({ finding, line, excerpt }, idx) => {
            const isSelected = finding.id === selectedId;
            const isReference = finding.findingType === "CRYPTO_REFERENCE";
            const severity = finding.blastRadius[0]?.severity;
            return (
              <button
                key={finding.id}
                type="button"
                onClick={() => onSelect(finding.id)}
                style={{ animationDelay: `${Math.min(idx * 20, 200)}ms` }}
                className={`animate-row-in block w-full rounded-sm border p-3 text-left transition-colors ${
                  isSelected
                    ? "border-ink-secondary bg-surface shadow-sm"
                    : "border-line bg-surface/60 hover:border-line-strong hover:bg-surface"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">
                    #{idx + 1} {finding.name}
                  </span>
                  {line !== undefined && (
                    <span className="rounded-sm border border-line bg-page px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">
                      Line {line}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {/* A CRYPTO_REFERENCE has no real-world exploitability —
                      it never carries a quantum-status/reachability/blast-
                      radius severity badge on the same scale as a genuine
                      operation; the "Reference" tag is its only indicator. */}
                  {isReference ? (
                    <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                      Reference
                    </span>
                  ) : (
                    <>
                      <QuantumStatusBadge status={finding.quantumStatus} />
                      <ReachabilityBadge
                        reachability={finding.reachability}
                        status={finding.quantumStatus}
                        mixed={finding.mixedReachability}
                      />
                      {severity !== undefined && (
                        <span
                          className={`rounded-sm px-1.5 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wide ${
                            SEVERITY_CLASS[severity] ?? "bg-status-neutral-bg text-status-neutral-fg"
                          }`}
                        >
                          {severity} severity
                        </span>
                      )}
                    </>
                  )}
                </div>

                {excerpt !== "" && (
                  <pre className="mt-2 overflow-x-auto rounded-sm border border-line/60 bg-page p-2 font-mono text-[11px] text-ink-secondary whitespace-pre">
                    {excerpt}
                  </pre>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
