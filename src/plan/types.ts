/**
 * Types for the raw demo_plan.json shape (optimizer output) and the typed
 * shape OptimizerBar consumes. Confirmed against the real fixture
 * (public/fixtures/demo_plan.json) rather than assumed.
 */

export interface RawPlanScheduleItem {
  finding_id?: string;
  name?: string;
  scenario_risk_score?: number;
  start_day?: number;
  end_day?: number;
  cost_days?: number;
}

export interface RawPlanRiskPoint {
  day: number;
  residual_risk: number;
}

export interface RawPlanVariant {
  eliminated_risk?: number;
  risk_eliminated_pct?: number;
  ordering?: string;
  schedule?: RawPlanScheduleItem[];
  total_risk?: number;
  residual_risk_curve?: RawPlanRiskPoint[];
  unmigrated_finding_ids?: string[];
}

export interface RawPlanScenario {
  scenario_name?: string;
  estimated_year?: number;
  probability_weight?: number;
  headline_message?: string;
  naive_plan?: RawPlanVariant;
  optimizer_plan?: RawPlanVariant;
}

export interface RawPlanDocument {
  budget_days?: number;
  candidate_count?: number;
  excluded_count?: number;
  scenarios?: RawPlanScenario[];
}

// --- Typed shapes ---

export interface PlanScheduleItem {
  findingId: string | undefined;
  name: string;
  startDay: number;
  endDay: number;
  costDays: number | undefined;
  riskScore: number | undefined;
}

export interface RiskCurvePoint {
  day: number;
  risk: number;
}

export interface PlanScenario {
  name: string;
  estimatedYear: number | undefined;
  probabilityWeight: number | undefined;
  headline: string | undefined;
  optimizerRiskEliminatedPct: number | undefined;
  naiveRiskEliminatedPct: number | undefined;
  /** Total risk across every migration candidate in this scenario (before
   * anything is fixed) — read directly from the optimizer response's own
   * `total_risk` field, the same figure `residual_risk_curve[0].residual_risk`
   * should equal at day 0. Used to turn a residual-risk-curve sample into a
   * "% eliminated so far" figure without recomputing anything. */
  optimizerTotalRisk: number | undefined;
  naiveTotalRisk: number | undefined;
  schedule: PlanScheduleItem[];
  /** Candidate finding ids that never fit into the budget under this
   * ordering — permanently "not yet fixed" for the whole timeline. */
  unmigratedFindingIds: string[];
  optimizerRiskCurve: RiskCurvePoint[];
  naiveRiskCurve: RiskCurvePoint[];
}

export interface ParsedPlan {
  budgetDays: number | undefined;
  candidateCount?: number;
  excludedCount?: number;
  scenarios: PlanScenario[];
}
