import type { Reachability } from "../cbom/types";

const LABEL: Record<Reachability, string> = {
  "live-external": "Live · external",
  "live-internal": "Live · internal",
  inert: "Inert",
  unknown: "Unknown",
};

// live-* is confirmed-reachable, so it gets a solid fill (loud) with a
// solid dot. inert is confirmed-dead, so it gets a quiet gray outline with
// a hollow dot. unknown means "we couldn't determine this — treat as
// potentially live," which is a meaningfully different claim than
// "confirmed dead," so it MUST NOT look like inert: same outline
// treatment, different hue (teal vs gray).
const CLASSES: Record<Reachability, string> = {
  "live-external": "bg-reach-external text-white border border-transparent",
  "live-internal": "bg-reach-internal text-white border border-transparent",
  inert: "bg-transparent text-reach-inert border border-reach-inert",
  unknown: "bg-transparent text-reach-unknown border border-reach-unknown",
};

const DOT_CLASSES: Record<Reachability, string> = {
  "live-external": "bg-white",
  "live-internal": "bg-white",
  inert: "border border-reach-inert bg-transparent",
  unknown: "border border-reach-unknown bg-transparent",
};

export function ReachabilityBadge({ reachability }: { reachability: Reachability | undefined }) {
  if (reachability === undefined) {
    return <span className="font-mono text-sm text-ink-muted">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${CLASSES[reachability]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[reachability]}`} aria-hidden="true" />
      {LABEL[reachability]}
    </span>
  );
}
