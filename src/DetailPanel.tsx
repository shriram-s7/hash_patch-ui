import type { Finding } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";

function Field({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="break-words font-mono text-sm text-ink">{value}</div>
    </div>
  );
}

export function DetailPanel({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  return (
    <div className="rounded-sm border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">{finding.name}</h2>
          <div className="mt-1 flex gap-2">
            <QuantumStatusBadge status={finding.quantumStatus} />
            <ReachabilityBadge reachability={finding.reachability} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-sm border border-line px-2 py-1 text-[11px] uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Asset type" value={finding.assetType} />
        <Field label="Primitive" value={finding.primitive} />
        <Field label="Parameter set" value={finding.parameterSetIdentifier} />
        <Field label="Mode" value={finding.mode} />
        <Field label="OID" value={finding.oid} />
        <Field label="Confidence" value={finding.confidence} />
        <Field label="Detector" value={finding.detectorId} />
        <Field label="Detector version" value={finding.detectorVersion} />
      </div>

      {finding.evidence.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Evidence</h3>
          <div className="space-y-2">
            {finding.evidence.map((e, i) => (
              <div key={i} className="rounded-sm border border-line bg-page p-2">
                <div className="break-all font-mono text-xs text-ink-secondary">
                  {e.locator ?? "(unknown file)"}
                  {e.line !== undefined ? `:${e.line}` : ""}
                  {e.column !== undefined ? `:${e.column}` : ""}
                </div>
                {e.snippet !== undefined && (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-ink">
                    {e.snippet}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {finding.shelfLife.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">Shelf-life</h3>
          <div className="space-y-2">
            {finding.shelfLife.map((s, i) => (
              <div key={i} className="rounded-sm border border-line bg-page p-2 text-sm">
                <div className="font-medium text-ink">
                  {s.category}
                  {s.shelfLifeYears !== undefined ? (
                    <span className="font-mono"> — {s.shelfLifeYears} yrs</span>
                  ) : (
                    ""
                  )}
                </div>
                {s.moscaNote !== undefined && (
                  <div className="mt-1 text-xs text-ink-secondary">{s.moscaNote}</div>
                )}
                {s.statutoryBasis !== undefined && (
                  <div className="mt-1 text-xs text-ink-muted">{s.statutoryBasis}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {finding.blastRadius.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Blast radius
          </h3>
          <div className="space-y-2">
            {finding.blastRadius.map((b, i) => (
              <div key={i} className="rounded-sm border border-line bg-page p-2 text-sm">
                <div className="font-mono font-medium text-ink">{b.key}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-xs text-ink-secondary">
                  {b.severity !== undefined && <span>Severity: {b.severity}</span>}
                  {b.estimatedEffortDays !== undefined && (
                    <span>Effort: {b.estimatedEffortDays} days</span>
                  )}
                  {b.pqcReplacement !== undefined && <span>PQC replacement: {b.pqcReplacement}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
