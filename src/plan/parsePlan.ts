import type {
  ParsedPlan,
  PlanScenario,
  PlanScheduleItem,
  RawPlanDocument,
  RawPlanScenario,
  RawPlanScheduleItem,
  RawPlanVariant,
} from "./types";

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseScheduleItem(item: RawPlanScheduleItem, index: number): PlanScheduleItem {
  return {
    findingId: item.finding_id,
    name: item.name ?? `finding-${index}`,
    startDay: item.start_day ?? 0,
    endDay: item.end_day ?? item.start_day ?? 0,
    costDays: item.cost_days,
    riskScore: item.scenario_risk_score,
  };
}

function parseVariant(variant: RawPlanVariant | undefined): {
  riskEliminatedPct: number | undefined;
  schedule: PlanScheduleItem[];
} {
  return {
    riskEliminatedPct: variant ? asNumber(variant.risk_eliminated_pct) : undefined,
    schedule: (variant?.schedule ?? []).map(parseScheduleItem),
  };
}

function parseScenario(raw: RawPlanScenario, index: number): PlanScenario {
  const optimizer = parseVariant(raw.optimizer_plan);
  const naive = parseVariant(raw.naive_plan);
  return {
    name: raw.scenario_name ?? `scenario-${index}`,
    estimatedYear: raw.estimated_year,
    probabilityWeight: raw.probability_weight,
    headline: raw.headline_message,
    optimizerRiskEliminatedPct: optimizer.riskEliminatedPct,
    naiveRiskEliminatedPct: naive.riskEliminatedPct,
    schedule: optimizer.schedule,
  };
}

/**
 * Parse a raw demo_plan.json object (already JSON.parse'd) into typed data.
 * Throws only if `raw` isn't a plausible plan document shape at all.
 */
export function parsePlanDocument(raw: unknown): ParsedPlan {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Not a valid plan document: expected a JSON object.");
  }
  const doc = raw as RawPlanDocument;
  if (doc.scenarios !== undefined && !Array.isArray(doc.scenarios)) {
    throw new Error("Not a valid plan document: 'scenarios' is not an array.");
  }
  return {
    budgetDays: asNumber(doc.budget_days),
    scenarios: (doc.scenarios ?? []).map(parseScenario),
  };
}
