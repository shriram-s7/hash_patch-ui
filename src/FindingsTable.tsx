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
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-surface text-xs uppercase tracking-wide text-ink-muted">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Quantum status</th>
            <th className="px-4 py-2 font-medium">Reachability</th>
            <th className="px-4 py-2 font-medium">Shelf-life (yrs)</th>
            <th className="px-4 py-2 font-medium">Blast radius (days)</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => {
            const blastDays = totalBlastRadiusDays(f);
            const selected = f.id === selectedId;
            return (
              <tr
                key={f.id}
                onClick={() => onSelect(f)}
                className={`cursor-pointer border-b border-line last:border-b-0 ${
                  selected ? "bg-accent/10" : "hover:bg-surface"
                }`}
              >
                <td className="px-4 py-2 font-medium text-ink">{f.name}</td>
                <td className="px-4 py-2">
                  <QuantumStatusBadge status={f.quantumStatus} />
                </td>
                <td className="px-4 py-2">
                  <ReachabilityBadge reachability={f.reachability} />
                </td>
                <td className="px-4 py-2 text-ink-secondary">
                  {f.longestShelfLifeYears ?? "—"}
                </td>
                <td className="px-4 py-2 text-ink-secondary">{blastDays ?? "—"}</td>
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
