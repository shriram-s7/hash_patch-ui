/**
 * Types for the raw CycloneDX 1.6 CBOM JSON shape Hash Patch emits, and the
 * typed `Finding` shape the rest of the app consumes. See cbomToFindings.ts
 * for the (only) place that reads `hash_patch:` / `hash-patch:` property strings.
 *
 * Confirmed against the real fixtures (public/fixtures/demo.cbom.json,
 * real_world.cbom.json) rather than assumed — see backend enums in
 * hash_patch/model/assets.py for the full value sets (a few, e.g.
 * "quantum-safe", don't appear in current fixture data but are valid).
 */

// --- Raw CycloneDX document shape (only the fields Hash Patch populates) ---

export interface RawCbomDocument {
  bomFormat?: string;
  specVersion?: string;
  serialNumber?: string;
  version?: number;
  metadata?: RawCbomMetadata;
  components?: RawCbomComponent[];
  dependencies?: unknown[];
}

export interface RawCbomMetadata {
  timestamp?: string;
  tools?: { components?: { name?: string; type?: string; version?: string }[] };
  /** Cross-layer contradiction findings (Pillar 4) live here, not on a component. */
  properties?: RawCbomProperty[];
}

export interface RawCbomProperty {
  name: string;
  value: string;
}

export interface RawCbomComponent {
  "bom-ref"?: string;
  type?: string;
  name?: string;
  cryptoProperties?: RawCryptoProperties;
  evidence?: { occurrences?: RawOccurrence[] };
  properties?: RawCbomProperty[];
}

export interface RawCryptoProperties {
  assetType?: string;
  oid?: string;
  algorithmProperties?: {
    primitive?: string;
    parameterSetIdentifier?: string;
    mode?: string;
    cryptoFunctions?: string[];
    nistQuantumSecurityLevel?: number;
  };
}

export interface RawOccurrence {
  location?: string;
  line?: number;
  offset?: number;
  /** JSON-encoded string: {"column": number|null, "snippet": string, "source_type": string} */
  additionalContext?: string;
}

// --- Enums (backend: hash_patch/model/assets.py) ---

export type QuantumStatus =
  | "broken-by-shor"
  | "weakened-by-grover"
  | "quantum-safe"
  | "broken-classically"
  | "unknown"
  /** Cloud KMS/HSM client-side operation (hash_patch/detect/cloud_kms/) —
   * provider-managed, deliberately NOT a quantum-risk verdict (a static
   * scanner can never observe which algorithm the provider runs server-side). */
  | "algorithm-opaque-provider-managed";

export type Reachability = "live-external" | "live-internal" | "inert" | "unknown";

export type ExposureState = "external" | "internal" | "mixed" | "unknown";
/** Phase 4 IaC correlation strength (correlation.py CorrelationStrength). */
export type CorrelationStrength =
  | "direct"
  | "strong"
  | "moderate"
  | "weak"
  | "none"
  | "unresolved";

// --- Typed, decoded sub-shapes ---

export interface EvidenceOccurrence {
  locator: string | undefined;
  line: number | undefined;
  offset: number | undefined;
  column: number | undefined;
  snippet: string | undefined;
  sourceType: string | undefined;
  reachability?: Reachability;
}

/** A losing candidate from the longest-shelf-life-wins tie-break
 * (hash_patch/analyze/shelf_life.py::_pick_winning_match), if the backend
 * ever exposes it on a ShelfLifeEntry — not present in the CBOM property
 * shape as of this writing (see docs/SHELF_LIFE.md), so callers must treat
 * this as optional and never assume it exists. */
export interface ShelfLifeAlsoMatched {
  category: string;
  shelfLifeYears: number | undefined;
}

export interface ShelfLifeEntry {
  category: string;
  shelfLifeYears: number | undefined;
  statutoryBasis: string | undefined;
  confidence: string | undefined;
  moscaNote: string | undefined;
  locator: string | undefined;
  /** The identifier that triggered this category match (e.g. the call
   * argument or enclosing-function name), if present in the data. */
  matchedIdentifier: string | undefined;
  /** The ontology name_pattern that matched matchedIdentifier, if present
   * in the data. */
  matchedPattern: string | undefined;
  /** Other categories that also matched the same call site but lost the
   * longest-shelf-life-wins tie-break, if present in the data. */
  alsoMatched: ShelfLifeAlsoMatched[] | undefined;
}

export interface CallRelation {
  /** Asset ids of other findings whose enclosing function directly calls
   * this finding's enclosing function (one hop, not transitive). */
  callers: string[];
  /** Asset ids of other findings whose enclosing function is directly
   * called by this finding's enclosing function (one hop, not transitive). */
  callees: string[];
}

export type DataChainType = "ciphertext" | "key_material";

export interface DataChainEdge {
  source: string;
  target: string;
  chainType: DataChainType;
}

/** Same-function data-flow chain edges (hash_patch/analyze/data_chain.py,
 * Java only) — an explicitly DIFFERENT relationship type from CallRelation:
 * "this finding's output literally feeds that finding's input within one
 * method", not "this function calls that function". Kept as its own field
 * (never merged into CallRelation) so the two stay distinguishable in the
 * Relationships view. */
export interface DataChain {
  /** Asset ids whose output this finding directly consumes (one hop). */
  chainSources: string[];
  /** Asset ids that directly consume this finding's output (one hop). */
  chainTargets: string[];
  /** Explicit typed edges involving this asset (source or target). */
  edges?: DataChainEdge[];
  /** Uniform chain type if all edges for this finding share the same type. */
  chainType?: DataChainType;
}

/** Certificate-specific fields (hash_patch/detect/certificates.py) — only
 * present on a finding whose findingType is "CERTIFICATE" or
 * "CERTIFICATE_UNPARSEABLE". A certificate file isn't executable code, so
 * it never has reachability, blast-radius, or DPDP-inferred shelf-life —
 * its own notAfter date feeds shelfLife instead, tagged evidenceSource
 * "certificate_expiry" (see the shelfLife array's own confidence/locator
 * fields for that entry). */
export interface CertificateInfo {
  subject: string | undefined;
  issuer: string | undefined;
  signatureAlgorithm: string | undefined;
  notBefore: string | undefined;
  notAfter: string | undefined;
  selfSigned: boolean | undefined;
  expired: boolean | undefined;
  expiringSoon: boolean | undefined;
  expiryWindowDays: number | undefined;
  chainPosition: number | undefined;
  chainDepth: number | undefined;
  fingerprintSha256: string | undefined;
  /** Only present when findingType is "CERTIFICATE_UNPARSEABLE" — e.g. a
   * password-protected .p12 with no password supplied, or corrupt data. */
  error: string | undefined;
}

/** Cloud-key specifics (hash_patch/detect/cloud_kms/) — present on every
 * finding whose findingType is "CLOUD_KEY_OPERATION". The operation is the
 * verbatim method name from the call site (encrypt/decrypt/createKey/...),
 * and verificationScope is ALWAYS "client_call_only": this finding proves
 * the scanned code CALLS a cloud key-management client, never what the
 * provider does with that call server-side — the honest framing must stay
 * visible next to the finding, not buried in the CBOM property bag. */
export interface CloudKeyInfo {
  provider: string | undefined;
  sdk: string | undefined;
  operation: string | undefined;
  verificationScope: string | undefined;
}

/** Compiled binary crypto specifics (hash_patch/detect/binary/) — present on
 * every finding whose findingType is "COMPILED_CRYPTO_ARTEFACT".
 * Static binary observation: never proves runtime execution. */
export interface BinaryCryptoInfo {
  binaryFormat: string | undefined;
  architecture: string | undefined;
  evidenceType: "symbol" | "linked_library" | "algorithm_string" | "certificate" | string | undefined;
  observedValue: string | undefined;
  library: string | undefined;
  operation: string | undefined;
  algorithm: string | undefined;
  verificationScope: string | undefined;
  honestFraming: string | undefined;
}

/** Container image cryptographic provenance (Phase 3) — present on any finding
 * observed within a container image layer. Static inspection only: never proves
 * runtime execution or deployment reachability. */
export interface ContainerProvenance {
  containerImage: string | undefined;
  imageDigest: string | undefined;
  layerDigest: string | undefined;
  pathInsideContainer: string | undefined;
  effectiveFs: boolean | undefined;
  verificationScope: string | undefined;
  honestFraming: string | undefined;
}

export interface BlastRadiusEntry {
  /** kind.name.line, parsed from the property name suffix */
  key: string;
  declaredBytes: number | undefined;
  classicalBytes: number | undefined;
  pqcBytes: number | undefined;
  overflowBytes: number | undefined;
  pqcReplacement: string | undefined;
  severity: string | undefined;
  estimatedEffortDays: number | undefined;
  locator: string | undefined;
}

/** The single typed shape every component in the app consumes. Never touch
 * a raw `hash_patch:` property-name string outside cbomToFindings.ts. */
export interface Finding {
  id: string;
  name: string;
  assetType: string | undefined;
  primitive: string | undefined;
  parameterSetIdentifier: string | undefined;
  mode: string | undefined;
  oid: string | undefined;
  quantumStatus: QuantumStatus | undefined;
  reachability: Reachability | undefined;
  mixedReachability?: boolean;
  confidence: string | undefined;
  detectorId: string | undefined;
  detectorVersion: string | undefined;
  evidence: EvidenceOccurrence[];
  shelfLife: ShelfLifeEntry[];
  /** Longest shelf-life among this finding's entries, for sorting/display. */
  longestShelfLifeYears: number | undefined;
  blastRadius: BlastRadiusEntry[];
  findingType?: "OPERATION" | "CRYPTO_REFERENCE" | "CERTIFICATE" | "CERTIFICATE_UNPARSEABLE" | "CLOUD_KEY_OPERATION" | "COMPILED_CRYPTO_ARTEFACT";
  /** Only present when findingType is "CERTIFICATE" or
   * "CERTIFICATE_UNPARSEABLE" — see CertificateInfo. */
  certificate: CertificateInfo | undefined;
  /** Only present when findingType is "CLOUD_KEY_OPERATION" — see CloudKeyInfo. */
  cloudKey: CloudKeyInfo | undefined;
  /** Only present when findingType is "COMPILED_CRYPTO_ARTEFACT" — see BinaryCryptoInfo. */
  binaryCrypto: BinaryCryptoInfo | undefined;
  /** Present when finding originates from a container image layer (Phase 3). */
  container?: ContainerProvenance;
  /** Direct call-graph edges to other findings (hash_patch/analyze/call_relations.py).
   * `undefined` when this finding has no `hash_patch:property.callRelation` at
   * all (Go/C evidence, or genuinely no direct caller/callee finding). */
  callRelation: CallRelation | undefined;
  /** Same-function data-flow chain edges (hash_patch/analyze/data_chain.py,
   * Java only). `undefined` when this finding has no
   * `hash_patch:property.dataChain` at all. */
  dataChain: DataChain | undefined;
  /** Phase 4: IaC Deployment Topology Exposure */
  exposureState: ExposureState | undefined;
  correlationStrength: CorrelationStrength | undefined;
  workload: string | undefined;
  service: string | undefined;
  ingress: string | undefined;
  namespace: string | undefined;
  tfResources: string | undefined;
  evidenceChain: string | undefined;
}

/**
 * Display label for a finding: the canonical algorithm name, with its cipher
 * mode appended when present (e.g. "AES" + mode "gcm" -> "AES-GCM"). The
 * backend's `name` field alone can't distinguish two genuinely different
 * assets that share a canonical algorithm but differ in mode — e.g. Java's
 * Cipher.getInstance("AES/GCM/NoPadding") vs Cipher.getInstance("AES/CBC/PKCS5Padding")
 * are two distinct crypto-asset components (different bom-refs), both named
 * "AES" — so every UI surface that shows a finding's name for a human to
 * read should use this instead of `finding.name` directly.
 *
 * Never use this for equality/lookup against other data (e.g. matching a
 * finding to an optimizer migration-plan entry by name) — those compare
 * against the backend's raw canonical `name`, not this display label.
 */
export function displayName(finding: Pick<Finding, "name" | "mode">): string {
  if (!finding.mode) return finding.name;
  return `${finding.name}-${finding.mode.toUpperCase()}`;
}

export interface ContradictionEntry {
  id: string;
  severity: string | undefined;
  description: string | undefined;
}

export interface ParsedCbom {
  serialNumber: string | undefined;
  timestamp: string | undefined;
  findings: Finding[];
  contradictions: ContradictionEntry[];
  scannedFiles?: string[];
  callGraphEdges?: { caller: string; callee: string }[];
}
