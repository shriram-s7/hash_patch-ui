import { useCountUp } from "./useCountUp";

export function MetricCard({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: number;
  /** Condensed form used by Graph/Code modes so the 4 metrics stay visible
   * without competing for space with the primary canvas/code view. */
  compact?: boolean;
}) {
  const displayed = useCountUp(value);

  if (compact) {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-line bg-surface px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">{label}</span>
        <span className="font-mono text-sm font-semibold text-ink tabular-nums">{displayed}</span>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-line bg-surface p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold text-ink tabular-nums">{displayed}</div>
    </div>
  );
}
