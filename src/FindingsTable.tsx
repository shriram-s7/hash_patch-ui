import type { Finding } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";

/** Sum of estimatedEffortDays across a finding's blast-radius entries, or
 * undefined if none carry that field (defensive: never show 0 for "no data"). */
function totalBlastRadiusDays(finding: Finding): number | undefined {
  const days = finding.blastRadius
    .map((b) => b.estimatedEffortDays)
    .filter((d): d is number => d !== undefined);
  return days.length > 0 ? days.reduce((a, b) => a + b, 0) : undefined;
}

// Row entrance is staggered on data load only; capped so a large result set
// (e.g. 41 findings) doesn't drag the animation out.
const MAX_STAGGER_MS = 300;
const STAGGER_STEP_MS = 12;

export function FindingsTable({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  selectedId: string | undefined;
  onSelect: (finding: Finding) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-sm border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wider text-ink-muted">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Quantum status</th>
            <th className="px-4 py-2 font-medium">Reachability</th>
            <th className="px-4 py-2 font-medium">Shelf-life (yrs)</th>
            <th className="px-4 py-2 font-medium">Blast radius (days)</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => {
            const blastDays = totalBlastRadiusDays(f);
            const selected = f.id === selectedId;
            return (
              <tr
                key={f.id}
                onClick={() => onSelect(f)}
                className={`animate-row-in cursor-pointer border-b border-line last:border-b-0 ${
                  selected ? "bg-accent/10" : "hover:bg-surface-2"
                }`}
                style={{ animationDelay: `${Math.min(i * STAGGER_STEP_MS, MAX_STAGGER_MS)}ms` }}
              >
                <td className="px-4 py-2 font-medium text-ink">{f.name}</td>
                <td className="px-4 py-2">
                  <QuantumStatusBadge status={f.quantumStatus} />
                </td>
                <td className="px-4 py-2">
                  <ReachabilityBadge reachability={f.reachability} />
                </td>
                <td className="px-4 py-2 font-mono text-ink-secondary tabular-nums">
                  {f.longestShelfLifeYears ?? "—"}
                </td>
                <td className="px-4 py-2 font-mono text-ink-secondary tabular-nums">{blastDays ?? "—"}</td>
              </tr>
            );
          })}
          {findings.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                No findings.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
