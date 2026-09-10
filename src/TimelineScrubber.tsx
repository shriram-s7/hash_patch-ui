import { useMemo, useState } from "react";
import type { Finding } from "./cbom/types";
import type { PlanScenario, PlanScheduleItem } from "./plan/types";
import { getNodeColor } from "./graphColors";

const FLOAT_EPSILON = 1e-9;

/** Plain-language walk-through of where the plan stands at the scrubbed
 * day — built entirely from figures already computed for the stat tiles
 * (never invented), just phrased as a sentence. */
function getNarrative(
  day: number,
  optimiserPct: number,
  findingsFixed: number,
  total: number,
  divergence: number,
  budget: number
): string {
  if (day === 0) return "At the start of the migration plan, no risk has been eliminated yet.";
  if (day >= budget) {
    return `Migration complete. All ${findingsFixed} of ${total} scheduled findings addressed. Optimizer outperformed naive ordering by ${divergence.toFixed(2)}pp over the full plan.`;
  }
  return `By day ${day.toFixed(1)}, the optimizer has fixed ${findingsFixed} of ${total} findings, eliminating ${optimiserPct.toFixed(1)}% of total risk — outperforming naive ordering by ${divergence.toFixed(2)}pp.`;
}

function correlateFinding(item: { findingId: string | undefined; name: string }, findings: Finding[] | undefined) {
  return findings?.find(
    (f) =>
      f.id === item.findingId ||
      f.name.toLowerCase() === item.name.toLowerCase() ||
      item.name.toLowerCase().includes(f.name.toLowerCase())
  );
}

/** Nearest naive-curve point to a given day, by index first (both curves are
 * sampled at the same 21 evenly-spaced days per docs/OPTIMISER.md), falling
 * back to nearest-by-day-value if the two curves ever have different
 * lengths (e.g. a hand-edited/uploaded plan). */
function naivePointAt(scenario: PlanScenario, index: number, day: number) {
  const byIndex = scenario.naiveRiskCurve[index];
  if (byIndex !== undefined) return byIndex;
  let best = scenario.naiveRiskCurve[0];
  for (const p of scenario.naiveRiskCurve) {
    if (best === undefined || Math.abs(p.day - day) < Math.abs(best.day - day)) best = p;
  }
  return best;
}

export function TimelineScrubber({
  scenario,
  findings,
}: {
  scenario: PlanScenario;
  findings?: Finding[];
}) {
  const curve = scenario.optimizerRiskCurve;
  const [dayIndex, setDayIndex] = useState(0);

  // Every dot on the row: scheduled findings (which get fixed at their own
  // end_day) plus unmigrated findings (which never do, for the whole
  // timeline) -- so the row always represents every real migration
  // candidate, not just the ones that happened to fit.
  const allCandidates = useMemo(() => {
    const scheduled = [...scenario.schedule].sort((a, b) => a.endDay - b.endDay);
    const unmigrated: (PlanScheduleItem & { unmigrated: true })[] = scenario.unmigratedFindingIds.map(
      (id) => ({
        findingId: id,
        name: findings?.find((f) => f.id === id)?.name ?? id,
        startDay: Number.POSITIVE_INFINITY,
        endDay: Number.POSITIVE_INFINITY,
        costDays: undefined,
        riskScore: undefined,
        unmigrated: true as const,
      })
    );
    return [...scheduled.map((s) => ({ ...s, unmigrated: false as const })), ...unmigrated];
  }, [scenario.schedule, scenario.unmigratedFindingIds, findings]);

  if (curve.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-4 text-xs" style={{ borderColor: "#30363d", color: "#8b949e" }}>
        This plan has no residual-risk-curve data to walk (older/hand-built plan JSON).
      </div>
    );
  }

  const clampedIndex = Math.min(dayIndex, curve.length - 1);
  const point = curve[clampedIndex]!;
  const currentDay = point.day;

  const optimizerTotal = scenario.optimizerTotalRisk ?? curve[0]!.risk;
  const optimizerPct = optimizerTotal > 0 ? ((optimizerTotal - point.risk) / optimizerTotal) * 100 : 0;

  const naivePoint = naivePointAt(scenario, clampedIndex, currentDay);
  const naiveTotal = scenario.naiveTotalRisk ?? scenario.naiveRiskCurve[0]?.risk ?? optimizerTotal;
  const naivePct =
    naivePoint !== undefined && naiveTotal > 0 ? ((naiveTotal - naivePoint.risk) / naiveTotal) * 100 : undefined;

  const fixedCount = allCandidates.filter((c) => c.endDay <= currentDay + FLOAT_EPSILON).length;
  const totalCandidates = allCandidates.length;
  const budget = curve[curve.length - 1]!.day;
  const divergence = naivePct !== undefined ? optimizerPct - naivePct : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
          Timeline scrubber — walk the plan day by day
        </div>
        <div className="text-xs" style={{ color: "#8b949e" }}>
          Day <span className="font-semibold text-white tabular-nums">{currentDay.toFixed(2)}</span> of{" "}
          <span className="tabular-nums">{curve[curve.length - 1]!.day.toFixed(2)}</span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={curve.length - 1}
        step={1}
        value={clampedIndex}
        onChange={(e) => setDayIndex(Number(e.target.value))}
        aria-label="Scrub migration timeline by day"
        className="w-full accent-blue-500"
      />

      <p className="text-sm italic" style={{ color: "#94b4d4" }}>
        {getNarrative(currentDay, optimizerPct, fixedCount, totalCandidates, divergence, budget)}
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border p-3" style={{ background: "#0d1117", borderColor: "#21262d" }}>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b949e" }}>
            Optimiser risk eliminated
          </div>
          <div className="text-xl font-bold tabular-nums text-white">{optimizerPct.toFixed(2)}%</div>
        </div>
        <div className="rounded-xl border p-3" style={{ background: "#0d1117", borderColor: "#21262d" }}>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b949e" }}>
            Naive risk eliminated (same day)
          </div>
          <div className="text-xl font-bold tabular-nums" style={{ color: "#c9d1d9" }}>
            {naivePct !== undefined ? `${naivePct.toFixed(2)}%` : "—"}
          </div>
        </div>
        <div className="rounded-xl border p-3" style={{ background: "#0d1117", borderColor: "#21262d" }}>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b949e" }}>Findings fixed</div>
          <div className="text-xl font-bold tabular-nums text-white">
            {fixedCount} / {totalCandidates}
          </div>
        </div>
        <div className="rounded-xl border p-3" style={{ background: "#0d1117", borderColor: "#21262d" }}>
          <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b949e" }}>
            Divergence at this day
          </div>
          <div
            className="text-xl font-bold tabular-nums"
            style={{
              color:
                naivePct !== undefined && optimizerPct - naivePct > 0.005
                  ? "#22c55e"
                  : naivePct !== undefined && naivePct - optimizerPct > 0.005
                    ? "#ef4444"
                    : "#8b949e",
            }}
          >
            {naivePct !== undefined ? `${(optimizerPct - naivePct >= 0 ? "+" : "") + (optimizerPct - naivePct).toFixed(2)}pp` : "—"}
          </div>
        </div>
      </div>

      <div className="rounded-lg p-3" style={{ background: "#0d1a2e", borderLeft: "4px solid #3b82f6" }}>
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-sm" style={{ color: "#3b82f6" }}>ℹ</span>
          <div>
            <p className="mb-1 text-xs font-bold" style={{ color: "#f0f6fc" }}>What is Divergence?</p>
            <p className="text-xs" style={{ color: "#94b4d4" }}>
              Divergence shows how many more percentage points of risk the Hash Patch optimizer has eliminated
              compared to a naive strategy (fixing highest-priority findings first, no sequencing).{" "}
              <span className="font-medium" style={{ color: "#22c55e" }}>Positive = optimizer is ahead.</span>{" "}
              Zero = tied. As you drag the timeline, watch this grow.
            </p>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wide" style={{ color: "#8b949e" }}>
          Progress — filled = fixed by day {currentDay.toFixed(2)}, outline = not yet fixed
        </div>
        <div className="flex flex-wrap gap-3">
          {allCandidates.map((c, i) => {
            const correlated = correlateFinding(c, findings);
            const color = getNodeColor(correlated?.quantumStatus);
            const isFixed = c.endDay <= currentDay + FLOAT_EPSILON;
            return (
              <div
                key={i}
                className="flex flex-col items-center gap-1"
                title={
                  c.unmigrated
                    ? `${c.name}: never fits in budget under this ordering`
                    : `${c.name}: fixed day ${c.startDay}–${c.endDay}`
                }
              >
                <div
                  className="h-4 w-4 shrink-0 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: isFixed ? color : "transparent",
                    borderColor: color,
                  }}
                  aria-hidden="true"
                />
                <span className="text-[9px]" style={{ color: "#8b949e" }}>{c.name.slice(0, 4)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
