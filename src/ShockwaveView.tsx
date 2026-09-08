import { useEffect, useMemo } from "react";
import { displayName, type BlastRadiusEntry, type DataChainType, type Finding, type QuantumStatus } from "./cbom/types";

const RING_GAP_PX = 100;
const CENTER_RADIUS_PX = 16;
const NODE_RADIUS_PX = 10;
const MAX_RINGS = 12; // safety cap against a pathological/cyclic call graph

const QUANTUM_STATUS_FILL: Record<QuantumStatus, string> = {
  "broken-by-shor": "var(--status-critical)",
  "weakened-by-grover": "var(--status-warning)",
  "quantum-safe": "var(--status-good)",
  "broken-classically": "var(--status-neutral-fg)",
  unknown: "var(--status-neutral-fg)",
  "algorithm-opaque-provider-managed": "var(--status-opaque)",
};

function quantumFill(status: QuantumStatus | undefined): string {
  return status !== undefined ? QUANTUM_STATUS_FILL[status] : "var(--status-neutral-fg)";
}

/** Same phrasing the task spec itself uses: "<name> buffer here declared
 * <N> bytes, <replacement> needs <M>" — built entirely from real,
 * already-computed BlastRadiusEntry fields (hash_patch/analyze/blast_radius.py),
 * never invented. `entry.key` is "<kind>.<name>.<line>"
 * (hash_patch/cbom/cbomToFindings.ts::parseBlastRadiusEntries). */
function blastRadiusReason(entry: BlastRadiusEntry): string {
  const parts = entry.key.split(".");
  const name = parts.length >= 2 ? parts[parts.length - 2] : entry.key;
  const replacement = entry.pqcReplacement ?? "its PQC replacement";
  if (entry.declaredBytes !== undefined && entry.pqcBytes !== undefined) {
    return `${name} buffer here declared ${entry.declaredBytes.toLocaleString()} bytes, ${replacement} needs ${entry.pqcBytes.toLocaleString()}`;
  }
  return `${name} — size data incomplete for this entry`;
}

function locatorLabel(finding: Finding): string {
  const ev = finding.evidence[0];
  if (ev === undefined || ev.locator === undefined) return "(unknown location)";
  return ev.line !== undefined ? `${ev.locator}:${ev.line}` : ev.locator;
}

export type EdgeKind = "call" | "ciphertext" | "key_material";

interface RingEntry {
  finding: Finding;
  /** id of the ring-closer-to-center node this one has a direct (one-hop)
   * edge to (call relation caller, ciphertext chain consumer, or key-material binder). */
  viaId: string;
  edgeKind: EdgeKind;
}

/** BFS outward from `center` via `callRelation.callers` and `dataChain.chainTargets` —
 * dependents radiate along edges, one ring per hop. Distinguishes cross-function callers,
 * ciphertext chaining consumers, and key-material binding consumers. */
function buildRings(findings: Finding[], centerId: string): RingEntry[][] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const center = byId.get(centerId);
  if (center === undefined) return [];

  const visited = new Set<string>([centerId]);
  const rings: RingEntry[][] = [];
  let frontier: Finding[] = [center];

  while (frontier.length > 0 && rings.length < MAX_RINGS) {
    const next: RingEntry[] = [];
    for (const f of frontier) {
      // 1. Cross-function callers
      for (const callerId of f.callRelation?.callers ?? []) {
        if (visited.has(callerId)) continue;
        const callerFinding = byId.get(callerId);
        if (callerFinding === undefined) continue;
        visited.add(callerId);
        next.push({ finding: callerFinding, viaId: f.id, edgeKind: "call" });
      }

      // 2. Same-function data chain dependents (targets that consume f's output or key)
      for (const targetId of f.dataChain?.chainTargets ?? []) {
        if (visited.has(targetId)) continue;
        const targetFinding = byId.get(targetId);
        if (targetFinding === undefined) continue;
        visited.add(targetId);

        let chainType: DataChainType | undefined = f.dataChain?.edges?.find(
          (e) => e.source === f.id && e.target === targetId
        )?.chainType;
        if (!chainType) {
          chainType = targetFinding.dataChain?.edges?.find(
            (e) => e.source === f.id && e.target === targetId
          )?.chainType;
        }
        if (!chainType) {
          chainType = f.dataChain?.chainType;
        }
        if (!chainType) {
          const isKeyGen =
            f.detectorId?.toLowerCase().includes("keygen") ||
            f.name.toLowerCase().includes("keygen") ||
            f.name.toLowerCase().includes("keygenerator");
          chainType = isKeyGen ? "key_material" : "ciphertext";
        }

        const edgeKind: EdgeKind = chainType === "key_material" ? "key_material" : "ciphertext";
        next.push({ finding: targetFinding, viaId: f.id, edgeKind });
      }
    }
    if (next.length === 0) break;
    rings.push(next);
    frontier = next.map((n) => n.finding);
  }
  return rings;
}

interface PositionedNode extends RingEntry {
  x: number;
  y: number;
  ring: number;
}

function layoutRings(
  rings: RingEntry[][],
  centerId: string,
): { positioned: PositionedNode[]; posById: Map<string, { x: number; y: number }> } {
  const posById = new Map<string, { x: number; y: number }>([[centerId, { x: 0, y: 0 }]]);
  const positioned: PositionedNode[] = [];
  rings.forEach((ring, ringIdx) => {
    const radius = (ringIdx + 1) * RING_GAP_PX;
    const n = ring.length;
    ring.forEach((entry, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      posById.set(entry.finding.id, { x, y });
      positioned.push({ ...entry, x, y, ring: ringIdx + 1 });
    });
  });
  return { positioned, posById };
}

export function ShockwaveView({
  findings,
  centerId,
  onClose,
}: {
  findings: Finding[];
  centerId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const center = findings.find((f) => f.id === centerId);
  const rings = useMemo(() => (center ? buildRings(findings, centerId) : []), [findings, centerId, center]);
  const { positioned, posById } = useMemo(() => layoutRings(rings, centerId), [rings, centerId]);

  if (center === undefined) return null;

  const maxRadius = (rings.length > 0 ? rings.length : 1) * RING_GAP_PX + 40;
  const findingById = new Map(findings.map((f) => [f.id, f]));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Blast-radius shockwave for ${center.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-sm border border-line-strong bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-line p-5 pb-4">
          <div>
            <div className="font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
              Blast-radius shockwave
            </div>
            <h2 className="mt-0.5 font-heading text-lg font-medium text-ink tracking-tight">{displayName(center)}</h2>
            <p className="mt-1 max-w-2xl font-sans text-xs leading-relaxed text-ink-muted">
              The changed algorithm sits at the center. Each ring is one more hop out — findings
              whose enclosing function calls into this one, or that consume this cipher&rsquo;s output or key material,
              reusing the same relationship data as the Asset Relationships graph.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-sm border border-line px-2.5 py-1 font-heading text-[10px] font-semibold uppercase tracking-wider text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 lg:flex-row">
          {/* Radial diagram */}
          <div className="relative flex shrink-0 items-center justify-center rounded-sm border border-line bg-page lg:w-[440px]">
            <svg
              viewBox={`${-maxRadius} ${-maxRadius} ${2 * maxRadius} ${2 * maxRadius}`}
              className="h-[380px] w-full lg:h-[440px]"
            >
              {/* Ring guide circles */}
              {rings.map((_, i) => (
                <circle
                  key={i}
                  cx={0}
                  cy={0}
                  r={(i + 1) * RING_GAP_PX}
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              ))}

              {/* Edges: node -> its via-node position */}
              {positioned.map((n) => {
                const from = posById.get(n.viaId) ?? { x: 0, y: 0 };
                const isCiphertext = n.edgeKind === "ciphertext";
                const isKeyMaterial = n.edgeKind === "key_material";
                return (
                  <line
                    key={`edge-${n.finding.id}`}
                    x1={from.x}
                    y1={from.y}
                    x2={n.x}
                    y2={n.y}
                    stroke={
                      isCiphertext
                        ? "var(--status-warning)"
                        : isKeyMaterial
                        ? "var(--ink-muted)"
                        : "var(--ink-secondary)"
                    }
                    strokeWidth={isKeyMaterial ? 1.5 : 2}
                    strokeDasharray={
                      isCiphertext
                        ? "4 3"
                        : isKeyMaterial
                        ? "2 3"
                        : undefined
                    }
                  />
                );
              })}

              {/* Center node */}
              <circle cx={0} cy={0} r={CENTER_RADIUS_PX} fill={quantumFill(center.quantumStatus)} stroke="var(--ink)" strokeWidth={2} />

              {/* Ring nodes */}
              {positioned.map((n) => (
                <g key={n.finding.id}>
                  <circle cx={n.x} cy={n.y} r={NODE_RADIUS_PX} fill={quantumFill(n.finding.quantumStatus)} stroke="var(--surface)" strokeWidth={1.5} />
                </g>
              ))}
            </svg>

            <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-1 rounded-sm border border-line bg-surface/90 px-2 py-1.5 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="h-0 w-3 border-t-2 border-ink-secondary" aria-hidden="true" />
                <span className="uppercase tracking-wide text-ink-secondary">Call dependent</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-0 w-3 border-t-2 border-dashed"
                  style={{ borderColor: "var(--status-warning)" }}
                  aria-hidden="true"
                />
                <span className="uppercase tracking-wide text-ink-secondary">Ciphertext chain</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className="h-0 w-3 border-t-[1.5px] border-dotted"
                  style={{ borderColor: "var(--ink-muted)" }}
                  aria-hidden="true"
                />
                <span className="uppercase tracking-wide text-ink-secondary">Key-material binding</span>
              </div>
            </div>
          </div>

          {/* Center's real blast-radius data + ring-by-ring list */}
          <div className="min-w-0 flex-1 space-y-4">
            <div className="rounded-sm border border-status-critical/40 bg-status-critical/5 p-3">
              <h3 className="mb-1.5 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                Epicenter — {locatorLabel(center)}
              </h3>
              <ul className="space-y-1 font-mono text-xs text-ink">
                {center.blastRadius.map((b, i) => (
                  <li key={i}>{blastRadiusReason(b)}</li>
                ))}
              </ul>
            </div>

            {rings.length === 0 ? (
              <div className="rounded-sm border border-dashed border-line-strong bg-page p-4">
                <p className="font-heading text-xs font-semibold uppercase tracking-wider text-ink">
                  No call-graph or data-chain dependents found
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                  This finding has no direct or transitive callers or data-flow consumers among the other findings in this scan, so
                  the shockwave is just this one node — an honest result, not a bug.
                </p>
              </div>
            ) : (
              rings.map((ring, ringIdx) => (
                <div key={ringIdx} className="rounded-sm border border-line bg-surface p-3">
                  <h3 className="mb-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                    Ring {ringIdx + 1} — {ringIdx === 0 ? "direct dependents" : `${ringIdx + 1} hops out`} (
                    {ring.length})
                  </h3>
                  <ul className="space-y-2">
                    {ring.map((n) => {
                      const via = n.viaId === centerId ? center : findingById.get(n.viaId);
                      return (
                        <li key={n.finding.id} className="rounded-sm border border-line bg-page p-2">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: quantumFill(n.finding.quantumStatus) }}
                              aria-hidden="true"
                            />
                            <span className="font-heading text-xs font-semibold text-ink">{displayName(n.finding)}</span>
                          </div>
                          <div className="mt-1 break-all font-mono text-[11px] text-ink-secondary">
                            {locatorLabel(n.finding)}
                          </div>
                          <div className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                            {n.edgeKind === "ciphertext" ? (
                              <>
                                {displayName(n.finding)} consumes ciphertext output directly from {via ? displayName(via) : "the epicenter"}{via !== center ? `, which chains back to ${displayName(center)}` : ""}.
                              </>
                            ) : n.edgeKind === "key_material" ? (
                              <>
                                {displayName(n.finding)} binds key material generated by {via ? displayName(via) : "the epicenter"}{via !== center ? `, which chains back to ${displayName(center)}` : ""}.
                              </>
                            ) : (
                              <>
                                {displayName(n.finding)}&rsquo;s enclosing function directly calls {via ? displayName(via) : "the previous ring's"}&rsquo;s
                                enclosing function{via !== center ? `, which chains back to ${displayName(center)}` : ""}.
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
