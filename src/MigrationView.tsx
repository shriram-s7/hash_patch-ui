import { useRef, useState, useEffect } from "react";
import type { Finding } from "./cbom/types";
import type { ParsedPlan } from "./plan/types";
import { parsePlanDocument } from "./plan/parsePlan";
import { OptimizerBar } from "./OptimizerBar";
import { BlastRadiusMode } from "./BlastRadiusMode";

interface MigrationViewProps {
  findings: Finding[];
  selectedId: string | undefined;
  onSelectId: (id: string) => void;
  plan: ParsedPlan | undefined;
  isDemoPlan?: boolean;
  isOptimizing?: boolean;
  planError: string | undefined;
  onPlanLoaded: (plan: ParsedPlan) => void;
  onLoadDemoPlan?: () => void;
  onRecalculatePlan?: (budgetDays: number) => void;
  scannedFiles?: string[];
}

export function MigrationView({
  findings,
  selectedId,
  onSelectId,
  plan,
  isDemoPlan,
  isOptimizing,
  planError,
  onPlanLoaded,
  onRecalculatePlan,
  scannedFiles,
}: MigrationViewProps) {
  const planFileInputRef = useRef<HTMLInputElement>(null);
  const [budgetInput, setBudgetInput] = useState<number>(plan?.budgetDays ?? 5.0);

  useEffect(() => {
    if (plan?.budgetDays !== undefined) {
      setBudgetInput(plan.budgetDays);
    }
  }, [plan?.budgetDays]);

  const defaultScenario = plan?.scenarios.reduce<ParsedPlan["scenarios"][number] | undefined>(
    (best, s) =>
      best === undefined || (s.probabilityWeight ?? 0) > (best.probabilityWeight ?? 0) ? s : best,
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
    <div className="h-full space-y-6 overflow-y-auto p-4 sm:p-6">
      {/* Section 1: Optimizer & Migration Plan */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Migration Sequencing (Pillar 5)
            </h2>
            <p className="mt-1 font-sans text-sm text-ink-muted leading-relaxed max-w-2xl">
              You have a limited number of engineer-days. Hash Patch shows which findings to fix first to
              eliminate the most risk, and what is left over if you run out of budget. Drag the timeline
              scrubber below to see how much risk is eliminated at any point along the plan, compared to a
              naive "fix the scariest thing first" ordering.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onRecalculatePlan && (
              <div className="flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1 text-xs">
                <span className="font-heading font-medium uppercase tracking-wider text-ink-muted">
                  Budget:
                </span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(Math.max(0.5, parseFloat(e.target.value) || 0.5))}
                  className="w-14 rounded border border-line bg-page px-1.5 py-0.5 text-center font-mono font-semibold text-ink"
                  aria-label="Migration budget in days"
                />
                <span className="text-ink-secondary">days</span>
                <button
                  type="button"
                  disabled={isOptimizing}
                  onClick={() => onRecalculatePlan(budgetInput)}
                  className="ml-1 rounded bg-ink px-2 py-0.5 font-heading text-[11px] font-semibold uppercase tracking-wider text-page hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {isOptimizing ? "Optimizing..." : "Recalculate"}
                </button>
              </div>
            )}

            <input
              ref={planFileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleCustomPlanUpload}
            />
            <button
              type="button"
              onClick={() => planFileInputRef.current?.click()}
              className="rounded-sm border border-line bg-surface px-3 py-1.5 font-heading text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors"
            >
              Upload demo
            </button>
          </div>
        </div>

        {isDemoPlan && (
          <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-heading font-bold uppercase tracking-wider text-amber-400">DEMO / SAMPLE DATA:</span>{" "}
              <span className="font-sans">
                Displaying reference plan fixture (<code className="font-mono text-amber-200">demo_plan.json</code>), not active scan results.
              </span>
            </div>
            {onRecalculatePlan && (
              <button
                type="button"
                onClick={() => onRecalculatePlan(budgetInput)}
                className="rounded border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 font-heading text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
              >
                Switch to Active Scan Plan
              </button>
            )}
          </div>
        )}

        {planError && (
          <div className="rounded-sm border border-status-critical/40 bg-status-critical/10 p-3 text-xs text-status-critical space-y-1">
            <span className="font-heading font-semibold">Plan Error: </span>
            <span className="font-sans">{planError}</span>
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
          <div className="rounded-sm border border-line bg-surface p-6 space-y-3">
            <div>
              <p className="font-heading text-base font-medium text-ink">No migration plan calculated for this scan</p>
              <p className="font-sans text-sm text-ink-muted leading-relaxed">
                Click below to calculate the optimal risk-density timeline for this scan's findings, or upload a custom plan.
              </p>
            </div>
            {onRecalculatePlan && (
              <button
                type="button"
                disabled={isOptimizing}
                onClick={() => onRecalculatePlan(budgetInput)}
                className="rounded-sm bg-ink px-4 py-2 font-heading text-xs font-semibold uppercase tracking-wider text-page hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isOptimizing ? "Calculating Plan..." : "Calculate Migration Plan"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Section 2: PQC Size Constraints */}
      <div className="space-y-4 pt-2">
        <div className="border-b border-line pb-3">
          <h2 className="font-heading text-[20px] font-medium text-ink tracking-tight">
            PQC Size Constraints (Pillar 3)
          </h2>
          <p className="mt-1 font-sans text-sm text-ink-muted leading-relaxed">
            Detect fixed-size memory buffers and database columns that may be too small for larger post-quantum cryptographic outputs.
          </p>
        </div>

        <div className="h-[460px] min-h-[380px]">
          <BlastRadiusMode
            findings={findings}
            selectedId={selectedId}
            onSelect={onSelectId}
            scannedFiles={scannedFiles}
          />
        </div>
      </div>
    </div>
  );
}
