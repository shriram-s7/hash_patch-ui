import type { QuantumStatus } from "../cbom/types";

const LABEL: Record<QuantumStatus, string> = {
  "broken-by-shor": "Broken by Shor",
  "weakened-by-grover": "Weakened by Grover",
  "quantum-safe": "Quantum-safe",
  "broken-classically": "Broken classically",
  unknown: "Unknown",
  "algorithm-opaque-provider-managed": "Algorithm opaque",
};

// Factual, not decorative: broken-by-shor is a real quantum break (critical/
// red); weakened-by-grover is a real but much weaker warning (amber, never
// red — NIST does not expect symmetric crypto to need replacement for
// Grover alone); broken-classically is explicitly NOT a quantum issue, so
// it gets the same neutral gray as "unknown" rather than any red/amber that
// would misrepresent it as quantum-relevant. algorithm-opaque-provider-
// managed (a cloud KMS/HSM client call) is DELIBERATELY not on this
// red/amber/green verdict scale at all — violet, a hue the quantum scale
// never uses, because it is not a quantum verdict, just a visibility
// statement: "the provider manages the algorithm; we cannot see it from
// here".
const CLASSES: Record<QuantumStatus, string> = {
  "broken-by-shor": "bg-status-critical-fill text-status-critical-fg",
  "weakened-by-grover": "bg-status-warning-fill text-status-warning-fg",
  "quantum-safe": "bg-status-good-fill text-status-good-fg",
  "broken-classically": "bg-status-neutral-bg text-status-neutral-fg",
  unknown: "bg-status-neutral-bg text-status-neutral-fg",
  "algorithm-opaque-provider-managed": "bg-status-opaque-fill text-status-opaque-fg",
};

const DOT_CLASSES: Record<QuantumStatus, string> = {
  "broken-by-shor": "bg-status-critical-fg",
  "weakened-by-grover": "bg-status-warning-fg",
  "quantum-safe": "bg-status-good-fg",
  "broken-classically": "bg-status-neutral-fg",
  unknown: "bg-status-neutral-fg",
  "algorithm-opaque-provider-managed": "bg-status-opaque-fg",
};

export function QuantumStatusBadge({ status }: { status: QuantumStatus | undefined }) {
  if (status === undefined) {
    return <span className="font-mono text-sm text-ink-muted">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${CLASSES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[status]}`} aria-hidden="true" />
      {LABEL[status]}
    </span>
  );
}
