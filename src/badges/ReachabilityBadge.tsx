import type { Reachability } from "../cbom/types";

const LABEL: Record<Reachability, string> = {
  "live-external": "Live · external",
  "live-internal": "Live · internal",
  inert: "Inert",
  unknown: "Unknown",
};

// live-* is confirmed-reachable, so it gets a solid fill (loud). inert is
// confirmed-dead, so it gets a quiet gray outline. unknown means "we
// couldn't determine this — treat as potentially live," which is a
// meaningfully different claim than "confirmed dead," so it MUST NOT look
// like inert: same outline treatment, different hue (teal vs gray).
const CLASSES: Record<Reachability, string> = {
  "live-external": "bg-reach-external text-white border border-transparent",
  "live-internal": "bg-reach-internal text-white border border-transparent",
  inert: "bg-transparent text-reach-inert border border-reach-inert",
  unknown: "bg-transparent text-reach-unknown border border-reach-unknown",
};

export function ReachabilityBadge({ reachability }: { reachability: Reachability | undefined }) {
  if (reachability === undefined) {
    return <span className="text-sm text-ink-muted">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSES[reachability]}`}
    >
      {LABEL[reachability]}
    </span>
  );
}
