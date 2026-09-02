import type { PlanScenario } from "./plan/types";

export function OptimizerBar({
  scenario,
  budgetDays,
}: {
  scenario: PlanScenario;
  budgetDays: number | undefined;
}) {
  const totalDays =
    budgetDays ?? Math.max(1, ...scenario.schedule.map((item) => item.endDay));

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
        Migration schedule — {scenario.name}
        {scenario.estimatedYear !== undefined ? ` (~${scenario.estimatedYear})` : ""}
      </div>
      {scenario.headline !== undefined && (
        <p className="mb-3 text-sm font-semibold text-ink">{scenario.headline}</p>
      )}
      <div className="flex h-8 w-full overflow-hidden rounded-md border border-line bg-page">
        {scenario.schedule.map((item, i) => {
          const widthPct = totalDays > 0 ? ((item.endDay - item.startDay) / totalDays) * 100 : 0;
          return (
            <div
              key={i}
              title={`${item.name}: day ${item.startDay}–${item.endDay}${
                item.riskScore !== undefined ? ` (risk score ${item.riskScore})` : ""
              }`}
              style={{ width: `${widthPct}%` }}
              className="border-r border-page bg-accent last:border-r-0"
            />
          );
        })}
      </div>
      <div className="mt-1 text-xs text-ink-muted">
        {scenario.schedule.length} asset{scenario.schedule.length === 1 ? "" : "s"} scheduled over{" "}
        {totalDays} day{totalDays === 1 ? "" : "s"}
      </div>
    </div>
  );
}
