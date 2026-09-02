import type { QuantumStatus } from "../cbom/types";

const LABEL: Record<QuantumStatus, string> = {
  "broken-by-shor": "Broken by Shor",
  "weakened-by-grover": "Weakened by Grover",
  "quantum-safe": "Quantum-safe",
  "broken-classically": "Broken classically",
  unknown: "Unknown",
};

// Factual, not decorative: broken-by-shor is a real quantum break (critical/
// red); weakened-by-grover is a real but much weaker warning (amber, never
// red — NIST does not expect symmetric crypto to need replacement for
// Grover alone); broken-classically is explicitly NOT a quantum issue, so
// it gets the same neutral gray as "unknown" rather than any red/amber that
// would misrepresent it as quantum-relevant.
const CLASSES: Record<QuantumStatus, string> = {
  "broken-by-shor": "bg-status-critical text-white",
  "weakened-by-grover": "bg-status-warning text-ink",
  "quantum-safe": "bg-status-good text-white",
  "broken-classically": "bg-status-neutral-bg text-status-neutral-fg",
  unknown: "bg-status-neutral-bg text-status-neutral-fg",
};

export function QuantumStatusBadge({ status }: { status: QuantumStatus | undefined }) {
  if (status === undefined) {
    return <span className="text-sm text-ink-muted">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSES[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
