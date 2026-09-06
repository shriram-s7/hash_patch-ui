import { useMemo, useState } from "react";
import type { Finding } from "./cbom/types";
import type { PlanScenario, PlanScheduleItem } from "./plan/types";
import { quantumStatusColor, useThemeColors } from "./useThemeColors";

const FLOAT_EPSILON = 1e-9;

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
  const colors = useThemeColors();
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
      <div className="rounded-sm border border-dashed border-line-strong bg-page p-3 text-xs text-ink-muted">
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

  return (
    <div className="rounded-sm border border-line bg-page p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Timeline scrubber — walk the plan day by day
        </div>
        <div className="font-mono text-xs text-ink-secondary">
          Day <span className="font-semibold text-ink tabular-nums">{currentDay.toFixed(2)}</span> of{" "}
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
        className="w-full accent-ink"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-sm border border-line bg-surface p-2">
          <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">
            Optimiser risk eliminated
          </div>
          <div className="font-heading text-xl font-bold tabular-nums text-ink">{optimizerPct.toFixed(2)}%</div>
        </div>
        <div className="rounded-sm border border-line bg-surface p-2">
          <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">
            Naive risk eliminated (same day)
          </div>
          <div className="font-heading text-xl font-bold tabular-nums text-ink-secondary">
            {naivePct !== undefined ? `${naivePct.toFixed(2)}%` : "—"}
          </div>
        </div>
        <div className="rounded-sm border border-line bg-surface p-2">
          <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">Findings fixed</div>
          <div className="font-heading text-xl font-bold tabular-nums text-ink">
            {fixedCount} / {totalCandidates}
          </div>
        </div>
        <div className="rounded-sm border border-line bg-surface p-2">
          <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">
            Divergence at this day
          </div>
          <div
            className={`font-heading text-xl font-bold tabular-nums ${
              naivePct !== undefined && optimizerPct - naivePct > 0.005
                ? "text-status-good"
                : naivePct !== undefined && naivePct - optimizerPct > 0.005
                ? "text-status-critical"
                : "text-ink-muted"
            }`}
          >
            {naivePct !== undefined ? `${(optimizerPct - naivePct >= 0 ? "+" : "") + (optimizerPct - naivePct).toFixed(2)}pp` : "—"}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-1.5 font-heading text-[10px] uppercase tracking-wider text-ink-muted">
          Progress — filled = fixed by day {currentDay.toFixed(2)}, outline = not yet fixed
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allCandidates.map((c, i) => {
            const correlated = correlateFinding(c, findings);
            const color = quantumStatusColor(colors, correlated?.quantumStatus);
            const isFixed = c.endDay <= currentDay + FLOAT_EPSILON;
            return (
              <span
                key={i}
                title={
                  c.unmigrated
                    ? `${c.name}: never fits in budget under this ordering`
                    : `${c.name}: fixed day ${c.startDay}–${c.endDay}`
                }
                style={{
                  backgroundColor: isFixed ? color : "transparent",
                  borderColor: color,
                }}
                className="h-3 w-3 shrink-0 rounded-full border-2 transition-colors"
                aria-hidden="true"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
