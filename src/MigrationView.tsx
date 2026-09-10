import { useRef, useState, useEffect } from "react";
import type { Finding } from "./cbom/types";
import type { ParsedPlan } from "./plan/types";
import type { NavItem } from "./AppShell";
import { parsePlanDocument } from "./plan/parsePlan";
import { OptimizerBar } from "./OptimizerBar";

interface MigrationViewProps {
  findings: Finding[];
  plan: ParsedPlan | undefined;
  isDemoPlan?: boolean;
  isOptimizing?: boolean;
  planError: string | undefined;
  onPlanLoaded: (plan: ParsedPlan) => void;
  onLoadDemoPlan?: () => void;
  onRecalculatePlan?: (budgetDays: number) => void;
  onNavigate?: (nav: NavItem) => void;
}

export function MigrationView({
  findings,
  plan,
  isDemoPlan,
  isOptimizing,
  planError,
  onPlanLoaded,
  onRecalculatePlan,
  onNavigate,
}: MigrationViewProps) {
  const planFileInputRef = useRef<HTMLInputElement>(null);
  const [budgetInput, setBudgetInput] = useState<number>(plan?.budgetDays ?? 5.0);

  useEffect(() => {
    if (plan?.budgetDays !== undefined) {
      setBudgetInput(plan.budgetDays);
    }
  }, [plan?.budgetDays]);

  const defaultScenario = plan?.scenarios.reduce<ParsedPlan["scenarios"][number] | undefined>(
    (best, s) => (best === undefined || (s.probabilityWeight ?? 0) > (best.probabilityWeight ?? 0) ? s : best),
    undefined,
  );

  const handleCustomPlanUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    file
      .text()
      .then((text) => {
        const raw = JSON.parse(text) as unknown;
        onPlanLoaded(parsePlanDocument(raw));
      })
      .catch(() => {
        // Handled through parent planError
      });
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#0d1117" }}>
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Migration Sequencing <span className="font-normal" style={{ color: "#8b949e" }}>(Pillar 5)</span>
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: "#8b949e" }}>
              You have a limited number of engineer-days. Hash Patch shows which findings to fix first to
              eliminate the most risk, and what is left over if you run out of budget. Drag the timeline
              scrubber below to see how much risk is eliminated at any point along the plan, compared to a
              naive "fix the scariest thing first" ordering.
            </p>
            <button
              type="button"
              onClick={() => onNavigate?.("BlastRadius")}
              className="mt-2 text-xs font-medium"
              style={{ color: "#3b82f6" }}
            >
              View Blast Radius →
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onRecalculatePlan && (
              <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs" style={{ borderColor: "#30363d", background: "#161b22" }}>
                <span className="font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>Budget:</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                  className="w-14 rounded-md border px-1.5 py-0.5 text-center font-mono font-semibold text-white"
                  style={{ borderColor: "#30363d", background: "#0d1117" }}
                  aria-label="Migration budget in days"
                />
                <span style={{ color: "#c9d1d9" }}>days</span>
                <button
                  type="button"
                  disabled={isOptimizing}
                  onClick={() => onRecalculatePlan(budgetInput)}
                  className="ml-1 rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: "#3b82f6" }}
                >
                  {isOptimizing ? "Optimizing…" : "Recalculate"}
                </button>
              </div>
            )}

            <input ref={planFileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleCustomPlanUpload} />
            <button
              type="button"
              onClick={() => planFileInputRef.current?.click()}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-white/5"
              style={{ borderColor: "#30363d" }}
            >
              Upload demo
            </button>
          </div>
        </div>

        {isDemoPlan && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}>
            <div>
              <span className="font-bold uppercase tracking-wide">Demo / sample data:</span>{" "}
              <span style={{ color: "#fbbf24" }}>
                Displaying reference plan fixture (<code className="font-mono">demo_plan.json</code>), not active scan results.
              </span>
            </div>
            {onRecalculatePlan && (
              <button
                type="button"
                onClick={() => onRecalculatePlan(budgetInput)}
                className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-white/5"
                style={{ borderColor: "rgba(245,158,11,0.4)" }}
              >
                Switch to Active Scan Plan
              </button>
            )}
          </div>
        )}

        {planError && (
          <div className="space-y-1 rounded-xl border p-3 text-xs" style={{ borderColor: "rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.08)", color: "#ef4444" }}>
            <span className="font-semibold">Plan Error: </span>
            <span>{planError}</span>
          </div>
        )}

        {defaultScenario ? (
          <OptimizerBar
            scenario={defaultScenario}
            budgetDays={plan?.budgetDays}
            candidateCount={plan?.candidateCount}
            excludedCount={plan?.excludedCount}
            findings={findings}
            isDemoPlan={isDemoPlan}
          />
        ) : (
          <div className="space-y-3 rounded-xl border p-6" style={{ borderColor: "#21262d", background: "#161b22" }}>
            <div>
              <p className="text-base font-medium text-white">No migration plan calculated for this scan</p>
              <p className="text-sm leading-relaxed" style={{ color: "#8b949e" }}>
                Click below to calculate the optimal risk-density timeline for this scan's findings, or upload a custom plan.
              </p>
            </div>
            {onRecalculatePlan && (
              <button
                type="button"
                disabled={isOptimizing}
                onClick={() => onRecalculatePlan(budgetInput)}
                className="rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#3b82f6" }}
              >
                {isOptimizing ? "Calculating Plan…" : "Calculate Migration Plan"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
