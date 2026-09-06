import { useState } from "react";
import { displayName, type Finding, type ShelfLifeEntry } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { ShelfLifeModal } from "./ShelfLifeModal";

function Field({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined) return null;
  return (
    <div>
      <div className="font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="break-words font-mono text-xs text-ink mt-0.5">{value}</div>
    </div>
  );
}

export function DetailPanel({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const [openShelfLifeEntry, setOpenShelfLifeEntry] = useState<ShelfLifeEntry | undefined>(undefined);

  return (
    <div className="rounded-sm border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2 border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-[20px] font-medium text-ink tracking-tight">{displayName(finding)}</h2>
            {finding.findingType === "CRYPTO_REFERENCE" && (
              <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                Reference
              </span>
            )}
            {(finding.findingType === "CERTIFICATE" || finding.findingType === "CERTIFICATE_UNPARSEABLE") && (
              <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                Certificate
              </span>
            )}
            {finding.findingType === "CLOUD_KEY_OPERATION" && (
              <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-status-opaque text-white border border-line">
                Cloud KMS
              </span>
            )}
            {finding.findingType === "COMPILED_CRYPTO_ARTEFACT" && (
              <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                Compiled Binary
              </span>
            )}
          </div>
          <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed">
            {finding.findingType === "CRYPTO_REFERENCE"
              ? "A string literal matching this algorithm's name — never observed as an argument to a crypto API call in the scanned source. Not a live operation."
              : finding.findingType === "CERTIFICATE"
                ? "A parsed certificate file — not executable code, so it has no reachability status."
                : finding.findingType === "CERTIFICATE_UNPARSEABLE"
                  ? "A certificate/PKCS12 file was found but could not be parsed."
                  : finding.findingType === "CLOUD_KEY_OPERATION"
                    ? "A cloud-managed key usage call (AWS KMS, GCP Cloud KMS, or Azure Key Vault). This proves client-side API usage only — it does not verify what the provider does with the call server-side."
                    : finding.findingType === "COMPILED_CRYPTO_ARTEFACT"
                      ? (finding.binaryCrypto?.honestFraming ?? "Static binary evidence — runtime execution is not verified.")
                      : "Cryptographic asset specification and verified source call locations."}
          </p>
          <div className="mt-2 flex gap-2">
            <QuantumStatusBadge status={finding.quantumStatus} />
            {finding.findingType !== "CERTIFICATE" && finding.findingType !== "CERTIFICATE_UNPARSEABLE" && (
              <ReachabilityBadge reachability={finding.reachability} status={finding.quantumStatus} />
            )}
            {finding.exposureState !== undefined && <ExposureBadge exposure={finding.exposureState} />}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-sm border border-line px-2.5 py-1 font-heading text-[10px] font-semibold uppercase tracking-wider text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
        >
          Close
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Asset type" value={finding.assetType} />
        <Field label="Primitive" value={finding.primitive} />
        <Field label="Parameter set" value={finding.parameterSetIdentifier} />
        <Field label="Mode" value={finding.mode} />
        <Field label="OID" value={finding.oid} />
        <Field label="Confidence" value={finding.confidence} />
        <Field label="Detector" value={finding.detectorId} />
        <Field label="Detector version" value={finding.detectorVersion} />
      </div>

      {finding.exposureState !== undefined && (
        <div className="mb-4 border-t border-line pt-3">
          <h3 className="mb-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Deployment Topology Exposure
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label="Correlation" value={finding.correlationStrength} />
            <Field label="Namespace" value={finding.namespace} />
            <Field label="Workload" value={finding.workload} />
            <Field label="Service" value={finding.service} />
            <Field label="Ingress" value={finding.ingress} />
            <Field label="Terraform" value={finding.tfResources} />
          </div>
          {finding.evidenceChain !== undefined && (
            <Field label="Evidence chain" value={finding.evidenceChain} />
          )}
          <p className="font-sans text-[11px] text-ink-muted leading-relaxed mt-2">
            Deterministically classified from statically parsed IaC — never an LLM verdict.
          </p>
        </div>
      )}

      {finding.certificate !== undefined && (
        <div className="mb-4">
          <h3 className="mb-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Certificate
          </h3>
          {finding.findingType === "CERTIFICATE_UNPARSEABLE" ? (
            <div className="rounded-sm border border-status-warning/60 bg-status-warning/10 p-2 text-xs text-ink">
              {finding.certificate.error ?? "Could not be parsed."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <Field label="Subject" value={finding.certificate.subject} />
              <Field label="Issuer" value={finding.certificate.issuer} />
              <Field label="Signature algorithm" value={finding.certificate.signatureAlgorithm} />
              <Field
                label="Self-signed"
                value={finding.certificate.selfSigned === undefined ? undefined : finding.certificate.selfSigned ? "Yes" : "No"}
              />
              <Field label="Not before" value={finding.certificate.notBefore} />
              <Field
                label="Not after"
                value={
                  finding.certificate.notAfter === undefined
                    ? undefined
                    : `${finding.certificate.notAfter}${finding.certificate.expired ? " (expired)" : finding.certificate.expiringSoon ? ` (expiring within ${finding.certificate.expiryWindowDays}d)` : ""}`
                }
              />
              {finding.certificate.chainDepth !== undefined && finding.certificate.chainDepth > 1 && (
                <Field
                  label="Chain position"
                  value={`${(finding.certificate.chainPosition ?? 0) + 1} of ${finding.certificate.chainDepth}`}
                />
              )}
            </div>
          )}
        </div>
      )}

      {finding.cloudKey !== undefined && (
        <div className="mb-4">
          <h3 className="mb-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Cloud key operation
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Field label="Provider" value={finding.cloudKey.provider} />
            <Field label="SDK" value={finding.cloudKey.sdk} />
            <Field label="Operation" value={finding.cloudKey.operation} />
            <Field label="Verification scope" value={finding.cloudKey.verificationScope} />
          </div>
          <div className="mt-2 rounded-sm border border-status-opaque/40 bg-status-opaque/10 p-2 font-sans text-xs text-ink leading-relaxed">
            Client-side call only — the scanned code invokes a cloud key-management client
            whose algorithm is managed by the provider. This scanner observes the call site,
            never the provider's server-side configuration, so it reports "Algorithm opaque"
            instead of asserting (or ruling out) a specific quantum-risk verdict. Validate the
            key's algorithm and rotation policy against the provider's console/IaC.
          </div>
        </div>
      )}

      {finding.binaryCrypto !== undefined && (
        <div className="mb-4">
          <h3 className="mb-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Compiled Binary Cryptography Evidence
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Field label="Binary format" value={finding.binaryCrypto.binaryFormat} />
            <Field label="Architecture" value={finding.binaryCrypto.architecture} />
            <Field label="Evidence type" value={finding.binaryCrypto.evidenceType} />
            <Field label="Observed value" value={finding.binaryCrypto.observedValue} />
            <Field label="Library" value={finding.binaryCrypto.library} />
            <Field label="Algorithm" value={finding.binaryCrypto.algorithm} />
            <Field label="Operation" value={finding.binaryCrypto.operation} />
            <Field label="Verification scope" value={finding.binaryCrypto.verificationScope} />
          </div>
          <div className="mt-2 rounded-sm border border-indigo-700/40 bg-indigo-950/20 p-2 font-sans text-xs text-ink leading-relaxed">
            <div className="font-semibold text-indigo-300 mb-1">
              Static binary evidence — runtime execution is not verified.
            </div>
            <div className="text-ink-secondary text-xs">
              {finding.binaryCrypto.honestFraming ??
                "Static binary analysis observes this cryptographic artifact, but does not independently establish runtime execution or production reachability."}
            </div>
          </div>
        </div>
      )}

      {finding.container !== undefined && (
        <div className="mb-4">
          <h3 className="mb-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Container Image Provenance
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Field label="Container image" value={finding.container.containerImage} />
            <Field label="Path in image" value={finding.container.pathInsideContainer} />
            <Field
              label="Layer digest"
              value={
                finding.container.layerDigest
                  ? `${finding.container.layerDigest.slice(0, 19)}...`
                  : undefined
              }
            />
            <Field
              label="Image digest"
              value={
                finding.container.imageDigest
                  ? `${finding.container.imageDigest.slice(0, 19)}...`
                  : undefined
              }
            />
            <Field
              label="Filesystem presence"
              value={finding.container.effectiveFs ? "Effective final image" : "Intermediate layer"}
            />
            <Field label="Verification scope" value={finding.container.verificationScope ?? "container_static_observation"} />
          </div>
          <div className="mt-2 rounded-sm border border-teal-700/40 bg-teal-950/20 p-2 font-sans text-xs text-ink leading-relaxed">
            <div className="font-semibold text-teal-300 mb-1">
              Static container inspection — runtime execution is not verified.
            </div>
            <div className="text-ink-secondary text-xs">
              {finding.container.honestFraming ??
                "Static inspection of container image; runtime execution is not verified."}
            </div>
          </div>
        </div>
      )}

      {finding.exposureState !== undefined && (
        <div className="mb-4">
          <h3 className="mb-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Deployment Topology Exposure (Phase 4)
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Field label="Exposure State" value={finding.exposureState} />
            <Field label="Correlation Strength" value={finding.correlationStrength} />
            <Field label="Workload" value={finding.workload} />
            <Field label="Service" value={finding.service} />
            <Field label="Ingress" value={finding.ingress} />
            <Field label="Namespace" value={finding.namespace} />
            <Field label="Terraform Resources" value={finding.tfResources} />
          </div>
          {finding.evidenceChain && (
            <div className="mt-2 rounded-sm border border-line bg-page p-2 font-sans text-xs text-ink leading-relaxed">
              <div className="font-semibold text-ink mb-1">Evidence Chain:</div>
              <div className="text-ink-secondary text-xs">{finding.evidenceChain}</div>
            </div>
          )}
          <div className="mt-2 rounded-sm border border-status-warning/40 bg-status-warning/10 p-2 font-sans text-xs text-ink leading-relaxed">
            <div className="font-semibold text-status-warning-fg mb-1">
              Deployment exposure classification is derived from statically parsed IaC relationships.
            </div>
            <div className="text-ink-secondary text-xs">
              It does not prove runtime or public internet reachability unless explicit evidence supports that conclusion.
            </div>
          </div>
        </div>
      )}

      {finding.evidence.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Evidence Call Sites ({finding.evidence.length})
          </h3>
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
                    <button
                      type="button"
                      onClick={() => setOpenShelfLifeEntry(s)}
                      className="ml-1 rounded-sm font-mono underline decoration-dotted underline-offset-2 hover:text-accent hover:decoration-solid transition-colors"
                      aria-label={`Show shelf-life calculation for ${s.category}`}
                    >
                      — {s.shelfLifeYears} yrs
                    </button>
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

      {openShelfLifeEntry !== undefined && (
        <ShelfLifeModal
          assetName={finding.name}
          entry={openShelfLifeEntry}
          onClose={() => setOpenShelfLifeEntry(undefined)}
        />
      )}
    </div>
  );
}
