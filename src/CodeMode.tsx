import type { Finding } from "./cbom/types";
import { MetricCard } from "./MetricCard";
import { CodeAnnotationView } from "./CodeAnnotationView";

const STATUS_DOT_CLASS: Record<string, string> = {
  "broken-by-shor": "bg-status-critical",
  "weakened-by-grover": "bg-status-warning",
  "quantum-safe": "bg-status-good",
  "broken-classically": "bg-status-neutral-fg",
  unknown: "bg-status-neutral-fg",
};

export function CodeMode({
  findings,
  metrics,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  metrics: { totalAssets: number; brokenByShor: number; contradictions: number; longestShelfLife: number };
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const selected = findings.find((f) => f.id === selectedId) ?? findings[0];

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <MetricCard compact label="Total assets" value={metrics.totalAssets} />
        <MetricCard compact label="Broken by Shor" value={metrics.brokenByShor} />
        <MetricCard compact label="Contradictions" value={metrics.contradictions} />
        <MetricCard compact label="Longest shelf-life (yrs)" value={metrics.longestShelfLife} />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="w-[280px] shrink-0 overflow-y-auto rounded-sm border border-line bg-surface">
          {findings.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onSelect(f.id)}
              className={`flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-b-0 ${
                f.id === selected?.id ? "bg-surface-2 font-semibold" : "hover:bg-surface-2/60 font-normal"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  STATUS_DOT_CLASS[f.quantumStatus ?? "unknown"] ?? "bg-status-neutral-fg"
                }`}
                aria-hidden="true"
              />
              <span className="truncate text-sm text-ink">{f.name}</span>
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <CodeAnnotationView finding={selected} />
          ) : (
            <div className="rounded-sm border border-line bg-surface p-4 text-sm text-ink-muted">
              No findings loaded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
