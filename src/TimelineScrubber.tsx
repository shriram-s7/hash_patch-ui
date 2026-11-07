import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "./cbom/types";
import type { PlanScenario, PlanScheduleItem } from "./plan/types";
import { getNodeColor } from "./graphColors";
import { FEATURE_GUIDED_UI } from "./tour/flags";
import { Coachmark } from "./tour/Coachmark";
import { tourStore } from "./tour/store";
import { useReducedMotion } from "./tour/useReducedMotion";

const FLOAT_EPSILON = 1e-9;
const MIGRATION_SCRUBBER_TOUR_ID = "migration.scrubber";

function getCurvePoint(curve: { day: number; risk: number }[], day: number) {
  if (curve.length === 0) return { day: 0, risk: 0 };
  if (day <= curve[0].day) return curve[0];
  if (day >= curve[curve.length - 1].day) return curve[curve.length - 1];
  for (let i = 0; i < curve.length - 1; i++) {
    const p0 = curve[i];
    const p1 = curve[i + 1];
    if (day >= p0.day && day <= p1.day) {
      const span = p1.day - p0.day;
      const t = span > 0 ? (day - p0.day) / span : 0;
      return { day, risk: p0.risk + t * (p1.risk - p0.risk) };
    }
  }
  return curve[curve.length - 1];
}

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
  const reducedMotion = useReducedMotion();

  const [scrubberDay, setScrubberDay] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

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

  const budget = curve[curve.length - 1]!.day;
  const currentDay = FEATURE_GUIDED_UI ? scrubberDay : (curve[Math.min(dayIndex, curve.length - 1)]?.day ?? 0);
  const clampedIndex = Math.min(dayIndex, curve.length - 1);
  const point = FEATURE_GUIDED_UI ? getCurvePoint(curve, currentDay) : curve[clampedIndex]!;

  const optimizerTotal = scenario.optimizerTotalRisk ?? curve[0]!.risk;
  const optimizerPct = optimizerTotal > 0 ? ((optimizerTotal - point.risk) / optimizerTotal) * 100 : 0;

  const naivePoint = naivePointAt(scenario, clampedIndex, currentDay);
  const naiveTotal = scenario.naiveTotalRisk ?? scenario.naiveRiskCurve[0]?.risk ?? optimizerTotal;
  const naivePct =
    naivePoint !== undefined && naiveTotal > 0 ? ((naiveTotal - naivePoint.risk) / naiveTotal) * 100 : undefined;

  const fixedCount = allCandidates.filter((c) => c.endDay <= currentDay + FLOAT_EPSILON).length;
  const totalCandidates = allCandidates.length;
  const divergence = naivePct !== undefined ? optimizerPct - naivePct : 0;

  // Sync scrubber metrics with tourStore so schedule table can link seamlessly
  useEffect(() => {
    if (!FEATURE_GUIDED_UI) return;
    tourStore.setScrubberSync({
      currentDay,
      totalDays: budget,
      fixedCount,
      totalCandidates,
      optimizerPct,
    });
    return () => {
      tourStore.setScrubberSync(null);
    };
  }, [currentDay, budget, fixedCount, totalCandidates, optimizerPct]);

  // One-time visual nudge on first entry
  const shouldNudge = FEATURE_GUIDED_UI && !tourStore.hasSeen(MIGRATION_SCRUBBER_TOUR_ID) && !reducedMotion;
  const [isNudging, setIsNudging] = useState(shouldNudge);
  const [showTip, setShowTip] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!FEATURE_GUIDED_UI || tourStore.hasSeen(MIGRATION_SCRUBBER_TOUR_ID)) return;
    if (!shouldNudge) {
      setShowTip(true);
      return;
    }
    const timer = setTimeout(() => {
      setIsNudging(false);
      setShowTip(true);
    }, 700);
    return () => clearTimeout(timer);
  }, [shouldNudge]);

  const updateFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const targetDay = frac * budget;
    const stepped = Math.round(targetDay * 10) / 10;
    setScrubberDay(Math.max(0, Math.min(budget, stepped)));
    if (showTip) {
      tourStore.markSeen(MIGRATION_SCRUBBER_TOUR_ID);
      tourStore.endTour();
      setShowTip(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    updateFromPointer(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsDragging(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === "ArrowLeft") {
      delta = e.shiftKey ? -0.5 : -0.1;
    } else if (e.key === "ArrowRight") {
      delta = e.shiftKey ? 0.5 : 0.1;
    } else if (e.key === "Home") {
      e.preventDefault();
      setScrubberDay(0);
      return;
    } else if (e.key === "End") {
      e.preventDefault();
      setScrubberDay(budget);
      return;
    }
    if (delta !== 0) {
      e.preventDefault();
      setScrubberDay((prev) => Math.max(0, Math.min(budget, Math.round((prev + delta) * 10) / 10)));
      if (showTip) {
        tourStore.markSeen(MIGRATION_SCRUBBER_TOUR_ID);
        tourStore.endTour();
        setShowTip(false);
      }
    }
  };

  const handlePct = budget > 0 ? (currentDay / budget) * 100 : 0;

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

      {!FEATURE_GUIDED_UI ? (
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
      ) : (
        <div className="relative pt-2 pb-7">
          <div
            ref={trackRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="relative h-2 w-full rounded-full bg-[#21262d] cursor-pointer py-1 select-none"
          >
            {/* Track background */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full bg-[#21262d]" />
            {/* Active filled track */}
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-2 rounded-l-full bg-[#3b82f6]"
              style={{ width: `${handlePct}%` }}
            />
            {/* Scrubber Knob Handle */}
            <div
              ref={handleRef}
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={budget}
              aria-valuenow={Number(currentDay.toFixed(1))}
              aria-valuetext={`Day ${currentDay.toFixed(1)} of ${budget.toFixed(2)}`}
              aria-label="Migration timeline scrubber"
              onKeyDown={handleKeyDown}
              className={`absolute top-1/2 w-6 h-7 rounded-md bg-[#3b82f6] border border-blue-400 shadow-md flex items-center justify-center select-none transition-shadow focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 focus:ring-offset-[#0d1117] ${
                isDragging ? "cursor-grabbing scale-105" : "cursor-grab hover:brightness-110"
              } ${isNudging ? "scrubber-nudge-knob" : ""}`}
              style={{
                left: `${handlePct}%`,
                transform: isNudging ? undefined : "translate(-50%, -50%)",
              }}
            >
              {/* Grip: three 1px vertical lines inside the knob */}
              <div className="flex items-center justify-center gap-[2px] h-3.5 pointer-events-none" aria-hidden="true">
                <span className="w-[1px] h-full bg-white/70 rounded-full" />
                <span className="w-[1px] h-full bg-white/70 rounded-full" />
                <span className="w-[1px] h-full bg-white/70 rounded-full" />
              </div>
            </div>
            {/* Label directly under the handle, following it */}
            <div
              className={`absolute top-full mt-2 -translate-x-1/2 whitespace-nowrap text-xs pointer-events-none transition-colors ${
                isDragging ? "text-white font-semibold" : "text-[#8b949e] font-medium"
              }`}
              style={{ left: `${handlePct}%` }}
            >
              Day {currentDay.toFixed(1)} of {budget.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {FEATURE_GUIDED_UI && showTip && !tourStore.hasSeen(MIGRATION_SCRUBBER_TOUR_ID) && (
        <Coachmark
          id={MIGRATION_SCRUBBER_TOUR_ID}
          anchorRef={handleRef}
          placement="top"
          title="Drag to walk the plan"
          body="Every day you move, watch how much risk the optimiser has eliminated versus fixing the scariest thing first."
          step={[1, 1]}
          nextLabel="Got it"
          skipLabel="Skip tip"
          onNext={() => {
            tourStore.markSeen(MIGRATION_SCRUBBER_TOUR_ID);
            tourStore.endTour();
            setShowTip(false);
          }}
          onSkip={() => {
            tourStore.markSeen(MIGRATION_SCRUBBER_TOUR_ID);
            tourStore.endTour();
            setShowTip(false);
          }}
        />
      )}

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
