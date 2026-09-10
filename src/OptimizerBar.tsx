import { useState } from "react";
import type { Finding } from "./cbom/types";
import type { PlanScenario } from "./plan/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { TimelineScrubber } from "./TimelineScrubber";
import { ExplainerBox } from "./components/ExplainerBox";

function Code({ children }: { children: string }) {
  return <code className="rounded bg-[#161b22] px-1 text-xs font-mono text-[#e6edf3]">{children}</code>;
}

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
        className="underline decoration-dotted decoration-1 underline-offset-2 transition-colors hover:text-white"
        style={{ color: "#3b82f6" }}
      >
        (<span className="font-semibold tabular-nums">{excludedCount}</span> finding
        {excludedCount === 1 ? "" : "s"} not a migration candidate — why?)
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2">
          <ExplainerBox title="Why not a migration candidate?" type="info" onClose={() => setOpen(false)}>
            Migration scheduling only covers findings broken outright by Shor's algorithm (
            <Code>RSA</Code>, <Code>ECDSA</Code>, <Code>Ed25519</Code>, <Code>DH</Code>, ...) — the actual
            PQC-migration problem this pillar schedules. Most commonly excluded:{" "}
            <strong className="text-[#f0f6fc]">Grover-weakened</strong> symmetric primitives and hashes (
            <Code>AES</Code>, <Code>SHA-256</Code>, ...), whose standard mitigation is a key-size doubling
            within the SAME algorithm family (e.g. <Code>AES-128</Code> → <Code>AES-256</Code>), not a
            migration to a different PQC algorithm — no blast-radius-style replacement-size model applies to
            them here. Also excluded: already <strong className="text-[#f0f6fc]">broken-classically</strong>{" "}
            findings (an ordinary security fix, unrelated to a PQC timeline) and non-operation findings
            (string references, certificates).
          </ExplainerBox>
        </div>
      )}
    </div>
  );
}

/** Click-to-open explanation box for findings deferred past the budget —
 * same anchored-popover pattern as ExcludedCandidatesInfo above, restyled
 * to the info-box palette (bg-[#0d1a2e]/border-[#21262d]) since this one
 * lists real data (which assets, not just a count) rather than one static
 * paragraph. */
function DeferredFindingsInfo({ unmigratedIds, findings }: { unmigratedIds: string[]; findings?: Finding[] }) {
  const [open, setOpen] = useState(false);
  const names = unmigratedIds.map((id) => findings?.find((f) => f.id === id)?.name ?? id);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="underline decoration-dotted decoration-1 underline-offset-2 transition-colors hover:text-white"
        style={{ color: "#f59e0b" }}
      >
        (<span className="font-semibold tabular-nums">{unmigratedIds.length}</span> deferred due to budget limit)
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2">
          <ExplainerBox title="Deferred by budget limit" type="warning" onClose={() => setOpen(false)}>
            <p className="mb-2">
              These are real migration candidates that did not fit within the available budget under this
              ordering — they would be scheduled next if the budget were extended.
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] text-[#f0f6fc]">
              {names.map((name, i) => (
                <li key={i}>• {name}</li>
              ))}
            </ul>
          </ExplainerBox>
        </div>
      )}
    </div>
  );
}

const SCHEDULE_BAR_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4"];

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
  const totalDays = budgetDays ?? Math.max(1, ...scenario.schedule.map((item) => item.endDay));

  return (
    <div className="space-y-5">
      {/* Migration schedule */}
      <div className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
            Migration schedule — {scenario.name}
            {scenario.estimatedYear !== undefined ? ` (~${scenario.estimatedYear})` : ""}
          </div>
          {isDemoPlan && (
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ background: "rgba(245,158,11,0.15)", borderColor: "rgba(245,158,11,0.4)", color: "#f59e0b" }}
            >
              Demo / sample data
            </span>
          )}
        </div>
        {scenario.headline !== undefined && (
          <p className="mb-3 text-sm font-semibold leading-relaxed text-white">{scenario.headline}</p>
        )}
        <div className="flex h-8 w-full overflow-hidden rounded-lg border" style={{ borderColor: "#21262d", background: "#0d1117" }}>
          {scenario.schedule.map((item, i) => {
            const widthPct = totalDays > 0 ? ((item.endDay - item.startDay) / totalDays) * 100 : 0;
            return (
              <div
                key={i}
                title={`${item.name}: day ${item.startDay}–${item.endDay}${
                  item.riskScore !== undefined ? ` (risk score ${item.riskScore})` : ""
                }`}
                style={{ width: `${widthPct}%`, background: SCHEDULE_BAR_COLORS[i % SCHEDULE_BAR_COLORS.length] }}
                className="border-r opacity-90 transition-opacity last:border-r-0 hover:opacity-100"
              />
            );
          })}
        </div>

        {/* Day tick marks under the bar, evenly spaced across the budget. */}
        <div className="relative mt-1">
          <div className="flex justify-between text-xs" style={{ color: "#8b949e" }}>
            {Array.from({ length: Math.ceil(Math.max(totalDays, 1)) + 1 }, (_, i) => (
              <span key={i} className="text-center" style={{ width: `${100 / Math.max(totalDays, 1)}%` }}>
                Day {i}
              </span>
            ))}
          </div>
        </div>

        {/* Legend — which color is which scheduled asset. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "#8b949e" }}>
          {scenario.schedule.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: SCHEDULE_BAR_COLORS[i % SCHEDULE_BAR_COLORS.length] }}
                aria-hidden="true"
              />
              <span className="max-w-[140px] truncate">{item.name}</span>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs" style={{ color: "#8b949e" }}>
          <div>
            <span className="font-semibold text-white tabular-nums">{scenario.schedule.length}</span> asset
            {scenario.schedule.length === 1 ? "" : "s"} scheduled over{" "}
            <span className="font-semibold text-white tabular-nums">{totalDays}</span> day{totalDays === 1 ? "" : "s"}
          </div>
          {candidateCount !== undefined && (
            <div>
              (<span className="font-semibold tabular-nums text-white">{candidateCount}</span> candidate
              {candidateCount === 1 ? "" : "s"} evaluated)
            </div>
          )}
          {excludedCount !== undefined && excludedCount > 0 && <ExcludedCandidatesInfo excludedCount={excludedCount} />}
          {scenario.unmigratedFindingIds.length > 0 && (
            <DeferredFindingsInfo unmigratedIds={scenario.unmigratedFindingIds} findings={findings} />
          )}
        </div>
      </div>

      {/* Timeline scrubber */}
      <div className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
        <TimelineScrubber scenario={scenario} findings={findings} />
      </div>

      {/* Scheduled migration tasks */}
      {scenario.schedule.length > 0 && (
        <div className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
            Scheduled migration tasks
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <thead>
                <tr>
                  {["#", "Asset", "Quantum Status", "Reachability", "Priority Score", "Day Window", "Effort"].map((h, i) => (
                    <th
                      key={h}
                      className={`border-b pb-2 pr-3 font-medium uppercase tracking-wide ${i === 0 || i >= 4 ? "text-right" : "text-left"}`}
                      style={{ borderColor: "#21262d", color: "#6e7681", fontSize: 10 }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenario.schedule.map((item, i) => {
                  const correlated = findings?.find(
                    (f) =>
                      f.id === item.findingId ||
                      f.name.toLowerCase() === item.name.toLowerCase() ||
                      item.name.toLowerCase().includes(f.name.toLowerCase()),
                  );
                  const isInert = correlated?.reachability === "inert";

                  return (
                    <tr
                      key={i}
                      className="border-b transition-opacity last:border-b-0"
                      style={{ borderColor: "#21262d", opacity: isInert ? 0.6 : 1 }}
                    >
                      <td className="py-2.5 pr-3 text-right tabular-nums" style={{ color: "#8b949e" }}>
                        {i + 1}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold text-white">{item.name}</td>
                      <td className="py-2.5 pr-3">
                        {correlated?.quantumStatus ? (
                          <QuantumStatusBadge status={correlated.quantumStatus} />
                        ) : (
                          <span style={{ color: "#6e7681" }}>—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {correlated ? (
                          <ReachabilityBadge reachability={correlated.reachability} status={correlated.quantumStatus} />
                        ) : (
                          <span style={{ color: "#6e7681" }}>—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums" style={{ color: "#c9d1d9" }}>
                        {item.riskScore !== undefined ? item.riskScore.toFixed(1) : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums" style={{ color: "#c9d1d9" }}>
                        {item.startDay}–{item.endDay}
                      </td>
                      <td className="py-2.5 text-right font-semibold tabular-nums text-white">
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
