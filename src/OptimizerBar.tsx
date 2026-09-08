import { useState } from "react";
import type { Finding } from "./cbom/types";
import type { PlanScenario } from "./plan/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { TimelineScrubber } from "./TimelineScrubber";

const EXCLUDED_CANDIDATES_EXPLANATION =
  "Migration scheduling only covers findings broken outright by Shor's algorithm (RSA, ECDSA, " +
  "Ed25519, DH, ...) -- the actual PQC-migration problem this pillar schedules. Most commonly " +
  "excluded: Grover-weakened symmetric primitives and hashes (AES, SHA-256, ...), whose standard " +
  "mitigation is a key-size doubling within the SAME algorithm family (e.g. AES-128 -> AES-256), " +
  "not a migration to a different PQC algorithm -- no blast-radius-style replacement-size model " +
  "applies to them here. Also excluded: already broken-classically findings (an ordinary " +
  "security fix, unrelated to a PQC timeline) and non-operation findings (string references, " +
  "certificates).";

/** Click-to-open explanation box for the excluded-candidates count — a
 * small dismissible panel (not a native title tooltip, which doesn't work
 * on touch and can't be captured/tested reliably) and not a full-screen
 * modal either, since this is a single short paragraph anchored to the
 * text that triggered it. */
function ExcludedCandidatesInfo({ excludedCount }: { excludedCount: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-ink-muted underline decoration-dotted decoration-1 underline-offset-2 hover:text-ink-secondary transition-colors"
      >
        (<span className="font-semibold tabular-nums">{excludedCount}</span> finding
        {excludedCount === 1 ? "" : "s"} not a migration candidate — why?)
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Why some findings are not migration candidates"
          className="absolute left-0 top-full z-20 mt-2 w-80 rounded-sm border border-line-strong bg-surface p-3 shadow-xl"
        >
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <h3 className="font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Why not a migration candidate?
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wider text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
            >
              Close
            </button>
          </div>
          <p className="font-sans text-[11px] leading-relaxed text-ink-secondary normal-case tracking-normal">
            {EXCLUDED_CANDIDATES_EXPLANATION}
          </p>
        </div>
      )}
    </div>
  );
}

export function OptimizerBar({
  scenario,
  budgetDays,
  candidateCount,
  excludedCount,
  findings,
  isDemoPlan,
}: {
  scenario: PlanScenario;
  budgetDays: number | undefined;
  candidateCount?: number;
  excludedCount?: number;
  findings?: Finding[];
  isDemoPlan?: boolean;
}) {
  const totalDays =
    budgetDays ?? Math.max(1, ...scenario.schedule.map((item) => item.endDay));

  return (
    <div className="rounded-sm border border-line bg-surface p-4 space-y-4">
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Migration schedule — {scenario.name}
            {scenario.estimatedYear !== undefined ? ` (~${scenario.estimatedYear})` : ""}
          </div>
          {isDemoPlan && (
            <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/40 uppercase tracking-wide">
              DEMO / SAMPLE DATA
            </span>
          )}
        </div>
        {scenario.headline !== undefined && (
          <p className="mb-3 font-sans text-sm font-semibold text-ink leading-relaxed">{scenario.headline}</p>
        )}
        <div className="flex h-8 w-full overflow-hidden rounded-sm border border-line bg-page">
          {scenario.schedule.map((item, i) => {
            const widthPct = totalDays > 0 ? ((item.endDay - item.startDay) / totalDays) * 100 : 0;
            return (
              <div
                key={i}
                title={`${item.name}: day ${item.startDay}–${item.endDay}${
                  item.riskScore !== undefined ? ` (risk score ${item.riskScore})` : ""
                }`}
                style={{ width: `${widthPct}%` }}
                className="border-r border-page bg-line-strong hover:bg-ink transition-colors last:border-r-0"
              />
            );
          })}
        </div>
        <div className="mt-2 font-heading text-xs text-ink-muted flex flex-wrap items-center gap-3">
          <div>
            <span className="font-semibold text-ink tabular-nums">{scenario.schedule.length}</span> asset{scenario.schedule.length === 1 ? "" : "s"} scheduled over{" "}
            <span className="font-semibold text-ink tabular-nums">{totalDays}</span> day{totalDays === 1 ? "" : "s"}
          </div>
          {candidateCount !== undefined && (
            <div className="text-ink-secondary">
              (<span className="font-semibold tabular-nums text-ink">{candidateCount}</span> candidate{candidateCount === 1 ? "" : "s"} evaluated)
            </div>
          )}
          {excludedCount !== undefined && excludedCount > 0 && (
            <ExcludedCandidatesInfo excludedCount={excludedCount} />
          )}
          {scenario.unmigratedFindingIds.length > 0 && (
            <div className="text-amber-500/90 dark:text-amber-400">
              (<span className="font-semibold tabular-nums">{scenario.unmigratedFindingIds.length}</span> deferred due to budget limit)
            </div>
          )}
        </div>
      </div>

      <TimelineScrubber scenario={scenario} findings={findings} />

      {/* Migration Schedule List Table */}
      {scenario.schedule.length > 0 && (
        <div className="space-y-2 pt-1 border-t border-line">
          <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Scheduled Migration Tasks
          </div>
          <div className="overflow-x-auto rounded-sm border border-line bg-page">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-2/40">
                  <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted text-right w-8">
                    #
                  </th>
                  <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                    Asset
                  </th>
                  <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                    Quantum Status
                  </th>
                  <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                    Reachability
                  </th>
                  <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted text-right">
                    Day Window
                  </th>
                  <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted text-right">
                    Effort
                  </th>
                </tr>
              </thead>
              <tbody>
                {scenario.schedule.map((item, i) => {
                  const correlated = findings?.find(
                    (f) =>
                      f.id === item.findingId ||
                      f.name.toLowerCase() === item.name.toLowerCase() ||
                      item.name.toLowerCase().includes(f.name.toLowerCase())
                  );
                  const isInert = correlated?.reachability === "inert";

                  return (
                    <tr
                      key={i}
                      className={`border-b border-line last:border-b-0 ${
                        isInert ? "opacity-60 hover:opacity-100 transition-opacity" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-heading text-xs text-ink-muted text-right tabular-nums">
                        {i + 1}
                      </td>
                      <td className="px-3 py-2 font-heading text-xs font-semibold text-ink">
                        {item.name}
                      </td>
                      <td className="px-3 py-2">
                        {correlated?.quantumStatus ? (
                          <QuantumStatusBadge status={correlated.quantumStatus} />
                        ) : (
                          <span className="font-mono text-xs text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {correlated ? (
                          <ReachabilityBadge
                            reachability={correlated.reachability}
                            status={correlated.quantumStatus}
                          />
                        ) : (
                          <span className="font-mono text-xs text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink-secondary text-right tabular-nums">
                        {item.startDay}–{item.endDay}
                      </td>
                      <td className="px-3 py-2 font-heading text-xs font-semibold text-ink-secondary text-right tabular-nums">
                        {item.costDays !== undefined ? `${item.costDays}d` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
