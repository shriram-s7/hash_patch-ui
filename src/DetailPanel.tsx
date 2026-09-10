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
      <dt className="text-[10px] font-medium uppercase tracking-wide mb-0.5" style={{ color: "#8b949e" }}>{label}</dt>
      <dd className="break-words font-mono text-xs mt-0.5" style={{ color: "#f0f6fc" }}>{value}</dd>
    </div>
  );
}

/** Warning box: bg-[#1a1200] / border-l-4 border-[#f59e0b] / text-[#fbbf24]. */
function WarningBox({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-[#1a1200] border-l-4 border-[#f59e0b] text-[#fbbf24]">
      <div className="text-xs font-semibold leading-relaxed">{title}</div>
      {children !== undefined && <div className="mt-1 text-xs leading-relaxed">{children}</div>}
    </div>
  );
}

/** Info box: bg-[#0d1a2e] / border-l-4 border-[#3b82f6] / text-[#94b4d4]. */
function InfoBox({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-[#0d1a2e] border-l-4 border-[#3b82f6] text-[#94b4d4]">
      <div className="text-xs font-semibold leading-relaxed">{title}</div>
      {children !== undefined && <div className="mt-1 text-xs leading-relaxed">{children}</div>}
    </div>
  );
}

/** Critical/error box: bg-[#1a0808] / border-l-4 border-[#ef4444] / text-[#fca5a5]. */
function CriticalBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-[#1a0808] border-l-4 border-[#ef4444] text-[#fca5a5] text-xs leading-relaxed">
      {children}
    </div>
  );
}

export function DetailPanel({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const [openShelfLifeEntry, setOpenShelfLifeEntry] = useState<ShelfLifeEntry | undefined>(undefined);

  return (
    <div
      className="flex h-full min-h-0 flex-col animate-drawer-in"
      style={{ background: "#161b22", borderLeft: "3px solid #21262d" }}
    >
      {/* Fixed header — never scrolls */}
      <div className="flex items-start justify-between gap-2 p-4 border-b flex-shrink-0" style={{ borderColor: "#21262d" }}>
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-lg" style={{ color: "#f0f6fc" }}>{displayName(finding)}</h2>
          {finding.findingType === "CRYPTO_REFERENCE" && (
            <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm border" style={{ background: "#21262d", color: "#8b949e", borderColor: "#30363d" }}>
              Reference
            </span>
          )}
          {(finding.findingType === "CERTIFICATE" || finding.findingType === "CERTIFICATE_UNPARSEABLE") && (
            <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm border" style={{ background: "#21262d", color: "#8b949e", borderColor: "#30363d" }}>
              Certificate
            </span>
          )}
          {finding.findingType === "CLOUD_KEY_OPERATION" && (
            <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm border" style={{ background: "#7a56d6", color: "#ffffff", borderColor: "#30363d" }}>
              Cloud KMS
            </span>
          )}
          {finding.findingType === "COMPILED_CRYPTO_ARTEFACT" && (
            <span className="whitespace-nowrap font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm border" style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", borderColor: "rgba(99,102,241,0.4)" }}>
              Compiled Binary
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0"
          style={{ background: "#161b22", color: "#8b949e" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#21262d"; e.currentTarget.style.color = "#f0f6fc"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#161b22"; e.currentTarget.style.color = "#8b949e"; }}
        >
          ✕
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin", scrollbarColor: "#21262d #0d1117" }}>
        <div>
          <p className="text-xs leading-relaxed" style={{ color: "#8b949e" }}>
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
          <div className="mt-2 flex flex-wrap gap-2">
            <QuantumStatusBadge status={finding.quantumStatus} />
            {finding.findingType !== "CERTIFICATE" && finding.findingType !== "CERTIFICATE_UNPARSEABLE" && (
              <ReachabilityBadge
                reachability={finding.reachability}
                status={finding.quantumStatus}
                mixed={finding.mixedReachability}
              />
            )}
            {finding.exposureState !== undefined && <ExposureBadge exposure={finding.exposureState} />}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Asset type" value={finding.assetType} />
          <Field label="Primitive" value={finding.primitive} />
          <Field label="Parameter set" value={finding.parameterSetIdentifier} />
          <Field label="Mode" value={finding.mode} />
          <Field label="OID" value={finding.oid} />
          <Field label="Confidence" value={finding.confidence} />
          <Field label="Detector" value={finding.detectorId} />
          <Field label="Detector version" value={finding.detectorVersion} />
        </dl>

        {finding.exposureState !== undefined && (
          <div className="border-t pt-3" style={{ borderColor: "#21262d" }}>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
              Deployment Topology Exposure
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Correlation" value={finding.correlationStrength} />
              <Field label="Namespace" value={finding.namespace} />
              <Field label="Workload" value={finding.workload} />
              <Field label="Service" value={finding.service} />
              <Field label="Ingress" value={finding.ingress} />
              <Field label="Terraform" value={finding.tfResources} />
            </dl>
            {finding.evidenceChain !== undefined && (
              <dl className="mt-2">
                <Field label="Evidence chain" value={finding.evidenceChain} />
              </dl>
            )}
            <p className="text-[11px] leading-relaxed mt-2" style={{ color: "#8b949e" }}>
              Deterministically classified from statically parsed IaC — never an LLM verdict.
            </p>
          </div>
        )}

        {finding.certificate !== undefined && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
              Certificate
            </h3>
            {finding.findingType === "CERTIFICATE_UNPARSEABLE" ? (
              <CriticalBox>{finding.certificate.error ?? "Could not be parsed."}</CriticalBox>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
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
              </dl>
            )}
          </div>
        )}

        {finding.cloudKey !== undefined && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
              Cloud key operation
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Provider" value={finding.cloudKey.provider} />
              <Field label="SDK" value={finding.cloudKey.sdk} />
              <Field label="Operation" value={finding.cloudKey.operation} />
              <Field label="Verification scope" value={finding.cloudKey.verificationScope} />
            </dl>
            <div className="mt-2">
              <InfoBox title="Client-side call only">
                The scanned code invokes a cloud key-management client whose algorithm is managed by the
                provider. This scanner observes the call site, never the provider's server-side configuration,
                so it reports "Algorithm opaque" instead of asserting (or ruling out) a specific quantum-risk
                verdict. Validate the key's algorithm and rotation policy against the provider's console/IaC.
              </InfoBox>
            </div>
          </div>
        )}

        {finding.binaryCrypto !== undefined && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
              Compiled Binary Cryptography Evidence
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Binary format" value={finding.binaryCrypto.binaryFormat} />
              <Field label="Architecture" value={finding.binaryCrypto.architecture} />
              <Field label="Evidence type" value={finding.binaryCrypto.evidenceType} />
              <Field label="Observed value" value={finding.binaryCrypto.observedValue} />
              <Field label="Library" value={finding.binaryCrypto.library} />
              <Field label="Algorithm" value={finding.binaryCrypto.algorithm} />
              <Field label="Operation" value={finding.binaryCrypto.operation} />
              <Field label="Verification scope" value={finding.binaryCrypto.verificationScope} />
            </dl>
            <div className="mt-2">
              <InfoBox title="Static binary evidence — runtime execution is not verified.">
                {finding.binaryCrypto.honestFraming ??
                  "Static binary analysis observes this cryptographic artifact, but does not independently establish runtime execution or production reachability."}
              </InfoBox>
            </div>
          </div>
        )}

        {finding.container !== undefined && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
              Container Image Provenance
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
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
            </dl>
            <div className="mt-2">
              <InfoBox title="Static container inspection — runtime execution is not verified.">
                {finding.container.honestFraming ??
                  "Static inspection of container image; runtime execution is not verified."}
              </InfoBox>
            </div>
          </div>
        )}

        {finding.exposureState !== undefined && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
              Deployment Topology Exposure (Phase 4)
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Exposure State" value={finding.exposureState} />
              <Field label="Correlation Strength" value={finding.correlationStrength} />
              <Field label="Workload" value={finding.workload} />
              <Field label="Service" value={finding.service} />
              <Field label="Ingress" value={finding.ingress} />
              <Field label="Namespace" value={finding.namespace} />
              <Field label="Terraform Resources" value={finding.tfResources} />
            </dl>
            {finding.evidenceChain && (
              <div className="mt-2 rounded-lg border p-2 text-xs leading-relaxed" style={{ borderColor: "#21262d", background: "#0d1117" }}>
                <div className="font-semibold mb-1" style={{ color: "#f0f6fc" }}>Evidence Chain:</div>
                <div style={{ color: "#c9d1d9" }}>{finding.evidenceChain}</div>
              </div>
            )}
            <div className="mt-2">
              <WarningBox title="Deployment exposure classification is derived from statically parsed IaC relationships.">
                It does not prove runtime or public internet reachability unless explicit evidence supports that conclusion.
              </WarningBox>
            </div>
          </div>
        )}

        {finding.evidence.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
                Evidence Call Sites ({finding.evidence.length})
              </h3>
              {finding.mixedReachability && (
                <span className="whitespace-nowrap text-[10px] uppercase tracking-wide font-semibold" style={{ color: "#fbbf24" }}>
                  Mixed Reachability
                </span>
              )}
            </div>
            {finding.mixedReachability && (
              <div className="mb-3">
                <WarningBox title="Notice:">
                  This algorithm merges multiple call sites with different reachability tiers. Dead or uncalled
                  code sites are isolated below, while the asset-level priority reflects the active entry point(s).
                </WarningBox>
              </div>
            )}
            <div className="space-y-2">
              {finding.evidence.map((e, i) => (
                <div key={i} className="rounded-lg border p-2" style={{ borderColor: "#21262d", background: "#0d1117" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="break-all font-mono text-xs" style={{ color: "#c9d1d9", wordBreak: "break-all" }}>
                      {e.locator ?? "(unknown file)"}
                      {e.line !== undefined ? `:${e.line}` : ""}
                      {e.column !== undefined ? `:${e.column}` : ""}
                    </div>
                    {e.reachability && (
                      <ReachabilityBadge reachability={e.reachability} status={finding.quantumStatus} />
                    )}
                  </div>
                  {e.snippet !== undefined && (
                    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs" style={{ color: "#f0f6fc" }}>
                      {e.snippet}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {finding.shelfLife.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>Shelf-life</h3>
            <div className="space-y-2">
              {finding.shelfLife.map((s, i) => (
                <div key={i} className="rounded-lg border p-2 text-sm" style={{ borderColor: "#21262d", background: "#0d1117" }}>
                  <div className="font-medium" style={{ color: "#f0f6fc" }}>
                    {s.category}
                    {s.shelfLifeYears !== undefined ? (
                      <button
                        type="button"
                        onClick={() => setOpenShelfLifeEntry(s)}
                        className="ml-1 rounded-sm font-mono underline decoration-dotted underline-offset-2 transition-colors"
                        style={{ color: "#3b82f6" }}
                        aria-label={`Show shelf-life calculation for ${s.category}`}
                      >
                        — {s.shelfLifeYears} yrs
                      </button>
                    ) : (
                      ""
                    )}
                  </div>
                  {s.moscaNote !== undefined && (
                    <div className="mt-1 text-xs" style={{ color: "#c9d1d9" }}>{s.moscaNote}</div>
                  )}
                  {s.statutoryBasis !== undefined && (
                    <div className="mt-1 text-xs" style={{ color: "#8b949e" }}>{s.statutoryBasis}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {finding.blastRadius.length > 0 && (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
              Blast radius
            </h3>
            <div className="space-y-2">
              {finding.blastRadius.map((b, i) => (
                <div key={i} className="rounded-lg border p-2 text-sm" style={{ borderColor: "#21262d", background: "#0d1117" }}>
                  <div className="font-mono font-medium" style={{ color: "#f0f6fc" }}>{b.key}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 font-mono text-xs" style={{ color: "#c9d1d9" }}>
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
