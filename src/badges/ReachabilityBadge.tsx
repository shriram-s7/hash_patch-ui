import type { QuantumStatus, Reachability } from "../cbom/types";

const LABEL: Record<Reachability, string> = {
  "live-external": "Live · entry-reachable",
  "live-internal": "Live · internal-call",
  inert: "Inert",
  unknown: "Unknown",
};

export interface ReachabilityBadgeProps {
  reachability: Reachability | undefined;
  status?: QuantumStatus;
  mixed?: boolean;
}

export function ReachabilityBadge({ reachability, status, mixed }: ReachabilityBadgeProps) {
  if (mixed) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40 font-semibold"
        title="Asset merges both live and dead/unreachable call sites"
      >
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 animate-signal-pulse" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
        </span>
        Mixed · see evidence
      </span>
    );
  }

  if (reachability === undefined) {
    return <span className="font-mono text-xs text-ink-muted">—</span>;
  }

  // Determine badge styling based on risk color (from quantum status) and reachability
  let badgeClasses = "";
  let dotFillClass = "";
  let dotBorderClass = "";

  const resolvedStatus = status ?? "broken-classically";

  if (resolvedStatus === "broken-by-shor") {
    // Risk color: status-critical (red)
    switch (reachability) {
      case "live-external":
        badgeClasses = "bg-status-critical text-white border border-status-critical font-semibold";
        dotFillClass = "bg-white";
        break;
      case "live-internal":
        badgeClasses = "bg-status-critical text-white border border-status-critical font-semibold";
        dotFillClass = "bg-white";
        break;
      case "unknown":
        badgeClasses = "bg-transparent text-status-critical border border-status-critical font-normal";
        dotBorderClass = "border border-status-critical bg-transparent";
        break;
      case "inert":
        badgeClasses = "bg-transparent text-status-critical/80 border border-status-critical/60 font-normal";
        dotBorderClass = "border border-status-critical/60 bg-transparent";
        break;
    }
  } else if (resolvedStatus === "weakened-by-grover") {
    // Risk color: status-warning (amber)
    switch (reachability) {
      case "live-external":
        badgeClasses = "bg-status-warning text-status-warning-fg border border-status-warning font-semibold";
        dotFillClass = "bg-status-warning-fg";
        break;
      case "live-internal":
        badgeClasses = "bg-status-warning text-status-warning-fg border border-status-warning font-semibold";
        dotFillClass = "bg-status-warning-fg";
        break;
      case "unknown":
        badgeClasses = "bg-transparent text-status-warning border border-status-warning font-normal";
        dotBorderClass = "border border-status-warning bg-transparent";
        break;
      case "inert":
        badgeClasses = "bg-transparent text-status-warning/80 border border-status-warning/60 font-normal";
        dotBorderClass = "border border-status-warning/60 bg-transparent";
        break;
    }
  } else if (resolvedStatus === "quantum-safe") {
    // Risk color: status-good (green)
    switch (reachability) {
      case "live-external":
        badgeClasses = "bg-status-good text-white border border-status-good font-semibold";
        dotFillClass = "bg-white";
        break;
      case "live-internal":
        badgeClasses = "bg-status-good text-white border border-status-good font-semibold";
        dotFillClass = "bg-white";
        break;
      case "unknown":
        badgeClasses = "bg-transparent text-status-good border border-status-good font-normal";
        dotBorderClass = "border border-status-good bg-transparent";
        break;
      case "inert":
        badgeClasses = "bg-transparent text-status-good/80 border border-status-good/60 font-normal";
        dotBorderClass = "border border-status-good/60 bg-transparent";
        break;
    }
  } else {
    // Risk color: status-neutral-fg (slate/gray)
    switch (reachability) {
      case "live-external":
        badgeClasses = "bg-status-neutral-fg text-surface border border-status-neutral-fg font-semibold";
        dotFillClass = "bg-surface";
        break;
      case "live-internal":
        badgeClasses = "bg-status-neutral-fg text-surface border border-status-neutral-fg font-semibold";
        dotFillClass = "bg-surface";
        break;
      case "unknown":
        badgeClasses = "bg-transparent text-status-neutral-fg border border-status-neutral-fg font-normal";
        dotBorderClass = "border border-status-neutral-fg bg-transparent";
        break;
      case "inert":
        badgeClasses = "bg-transparent text-status-neutral-fg/70 border border-status-neutral-fg/50 font-normal";
        dotBorderClass = "border border-status-neutral-fg/50 bg-transparent";
        break;
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider ${badgeClasses}`}
    >
      {reachability === "live-external" ? (
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className={`absolute inline-flex h-full w-full rounded-full ${dotFillClass} animate-signal-pulse`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotFillClass}`} />
        </span>
      ) : reachability === "live-internal" ? (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotFillClass}`} aria-hidden="true" />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotBorderClass}`} aria-hidden="true" />
      )}
      {LABEL[reachability]}
    </span>
  );
}
