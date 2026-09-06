import type { ExposureState } from "../cbom/types";

const EXPOSURE_LABEL: Record<ExposureState, string> = {
  external: "External",
  internal: "Internal",
  mixed: "Mixed",
  unknown: "Unknown",
};

export interface ExposureBadgeProps {
  exposure: ExposureState | undefined;
}

export function ExposureBadge({ exposure }: ExposureBadgeProps) {
  if (exposure === undefined) {
    return <span className="font-mono text-xs text-ink-muted">—</span>;
  }

  let badgeClasses = "";
  let dotFillClass = "";
  let dotBorderClass = "";

  switch (exposure) {
    case "external":
      badgeClasses = "bg-status-critical text-white border border-status-critical font-semibold";
      dotFillClass = "bg-white";
      break;
    case "internal":
      badgeClasses = "bg-status-good text-white border border-status-good font-semibold";
      dotFillClass = "bg-white";
      break;
    case "mixed":
      badgeClasses = "bg-status-warning text-status-warning-fg border border-status-warning font-semibold";
      dotFillClass = "bg-status-warning-fg";
      break;
    case "unknown":
    default:
      badgeClasses = "bg-transparent text-ink-muted border border-line font-normal";
      dotBorderClass = "border border-line bg-transparent";
      break;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-heading text-[10px] uppercase tracking-wider ${badgeClasses}`}
    >
      {exposure === "external" ? (
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className={`absolute inline-flex h-full w-full rounded-full ${dotFillClass} animate-signal-pulse`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotFillClass}`} />
        </span>
      ) : exposure === "internal" ? (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotFillClass}`} aria-hidden="true" />
      ) : exposure === "mixed" ? (
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span className={`absolute inline-flex h-full w-full rounded-full ${dotFillClass} animate-signal-pulse`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotFillClass}`} />
        </span>
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotBorderClass}`} aria-hidden="true" />
      )}
      {EXPOSURE_LABEL[exposure]}
    </span>
  );
}