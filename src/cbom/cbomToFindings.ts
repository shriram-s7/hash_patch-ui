/**
 * The place in the app that touches raw CBOM property-name strings
 * (`hash_patch:` and `hash-patch:`). Everything downstream
 * consumes the typed `Finding[]` / `ParsedCbom` shape from ./types — never a raw property object.
 *
 * Defensive by construction: a missing or malformed field produces
 * `undefined` for that piece of a finding's data, never a thrown error.
 * The only thing that can still throw is the raw JSON.parse of the
 * uploaded/fetched file itself, which the caller is expected to catch.
 */
import type {
  BinaryCryptoInfo,
  BlastRadiusEntry,
  CallRelation,
  CertificateInfo,
  CloudKeyInfo,
  ContainerProvenance,
  ContradictionEntry,
  CorrelationStrength,
  EvidenceOccurrence,
  ExposureState,
  Finding,
  ParsedCbom,
  QuantumStatus,
  RawCbomComponent,
  RawCbomDocument,
  RawCbomProperty,
  RawOccurrence,
  Reachability,
  ShelfLifeAlsoMatched,
  ShelfLifeEntry,
} from "./types";

const QUANTUM_STATUS_VALUES = new Set<QuantumStatus>([
  "broken-by-shor",
  "weakened-by-grover",
  "quantum-safe",
  "broken-classically",
  "unknown",
  "algorithm-opaque-provider-managed",
]);

const REACHABILITY_VALUES = new Set<Reachability>([
  "live-external",
  "live-internal",
  "inert",
  "unknown",
]);

const EXPOSURE_STATE_VALUES = new Set<ExposureState>([
  "external",
  "internal",
  "mixed",
  "unknown",
]);

const CORRELATION_STRENGTH_VALUES = new Set<CorrelationStrength>([
  "direct",
  "strong",
  "moderate",
  "weak",
  "none",
  "unresolved",
]);

function asCorrelationStrength(value: string | undefined): CorrelationStrength | undefined {
  return value !== undefined && CORRELATION_STRENGTH_VALUES.has(value as CorrelationStrength)
    ? (value as CorrelationStrength)
    : undefined;
}

function asExposureState(value: string | undefined): ExposureState | undefined {
  return value !== undefined && EXPOSURE_STATE_VALUES.has(value as ExposureState)
    ? (value as ExposureState)
    : undefined;
}

function asQuantumStatus(value: string | undefined): QuantumStatus | undefined {
  return value !== undefined && QUANTUM_STATUS_VALUES.has(value as QuantumStatus)
    ? (value as QuantumStatus)
    : undefined;
}

function asReachability(value: string | undefined): Reachability | undefined {
  return value !== undefined && REACHABILITY_VALUES.has(value as Reachability)
    ? (value as Reachability)
    : undefined;
}

function safeJsonParse(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function propertyMap(properties: RawCbomProperty[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of properties ?? []) {
    if (typeof p?.name === "string" && typeof p?.value === "string") {
      map.set(p.name, p.value);
    }
  }
  return map;
}

function getProp(props: Map<string, string>, suffix: string): string | undefined {
  return (
    props.get(`hash_patch:${suffix}`) ??
    props.get(`hash-patch:${suffix}`)
  );
}

function parseOccurrence(occ: RawOccurrence): EvidenceOccurrence {
  const ctx = safeJsonParse(occ.additionalContext);
  return {
    locator: occ.location,
    line: occ.line,
    offset: occ.offset,
    column: ctx ? asNumber(ctx.column) : undefined,
    snippet: ctx ? asString(ctx.snippet) : undefined,
    sourceType: ctx ? asString(ctx.source_type) : undefined,
  };
}

const SHELF_LIFE_PREFIXES = [
  "hash_patch:property.shelfLife.",
  "hash-patch:property.shelfLife.",
];

/** Parses an optional `alsoMatched` array from a shelf-life property value,
 * if the backend ever includes one (not present as of this writing — see
 * ShelfLifeAlsoMatched's own doc comment in ./types). Malformed or missing
 * entries are dropped defensively rather than thrown. */
function parseAlsoMatched(value: unknown): ShelfLifeAlsoMatched[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((item): ShelfLifeAlsoMatched | undefined => {
      if (item === null || typeof item !== "object") return undefined;
      const rec = item as Record<string, unknown>;
      const category = asString(rec.category);
      if (category === undefined) return undefined;
      return { category, shelfLifeYears: asNumber(rec.shelfLifeYears) };
    })
    .filter((v): v is ShelfLifeAlsoMatched => v !== undefined);
  return parsed.length > 0 ? parsed : undefined;
}

/** `hash_patch:property.shelfLife.<category>` -> ShelfLifeEntry. */
function parseShelfLifeEntries(props: Map<string, string>): ShelfLifeEntry[] {
  const entries: ShelfLifeEntry[] = [];
  for (const [name, rawValue] of props) {
    let category: string | null = null;
    for (const prefix of SHELF_LIFE_PREFIXES) {
      if (name.startsWith(prefix)) {
        category = name.slice(prefix.length);
        break;
      }
    }
    if (!category) continue;
    const v = safeJsonParse(rawValue);
    entries.push({
      category,
      shelfLifeYears: v ? asNumber(v.shelfLifeYears) : undefined,
      statutoryBasis: v ? asString(v.statutoryBasis) : undefined,
      confidence: v ? asString(v.confidence) : undefined,
      moscaNote: v ? asString(v.moscaNote) : undefined,
      locator: v ? asString(v.locator) : undefined,
      matchedIdentifier: v ? asString(v.matchedIdentifier) : undefined,
      matchedPattern: v ? asString(v.matchedPattern) : undefined,
      alsoMatched: v ? parseAlsoMatched(v.alsoMatched) : undefined,
    });
  }
  return entries;
}

const BLAST_RADIUS_PREFIXES = [
  "hash_patch:property.blastRadius.",
  "hash-patch:property.blastRadius.",
];

/** `hash_patch:property.blastRadius.<kind>.<name>.<line>` -> BlastRadiusEntry. */
function parseBlastRadiusEntries(props: Map<string, string>): BlastRadiusEntry[] {
  const entries: BlastRadiusEntry[] = [];
  for (const [name, rawValue] of props) {
    let key: string | null = null;
    for (const prefix of BLAST_RADIUS_PREFIXES) {
      if (name.startsWith(prefix)) {
        key = name.slice(prefix.length);
        break;
      }
    }
    if (!key) continue;
    const v = safeJsonParse(rawValue);
    entries.push({
      key,
      declaredBytes: v ? asNumber(v.declaredBytes) : undefined,
      classicalBytes: v ? asNumber(v.classicalBytes) : undefined,
      pqcBytes: v ? asNumber(v.pqcBytes) : undefined,
      overflowBytes: v ? asNumber(v.overflowBytes) : undefined,
      pqcReplacement: v ? asString(v.pqcReplacement) : undefined,
      severity: v ? asString(v.severity) : undefined,
      estimatedEffortDays: v ? asNumber(v.estimatedEffortDays) : undefined,
      locator: v ? asString(v.locator) : undefined,
    });
  }
  return entries;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** `hash_patch:property.callRelation` -> CallRelation (hash_patch/analyze/call_relations.py). */
function parseCallRelation(props: Map<string, string>): CallRelation | undefined {
  const raw = getProp(props, "property.callRelation");
  const v = safeJsonParse(raw);
  if (!v) return undefined;
  return { callers: asStringArray(v.callers), callees: asStringArray(v.callees) };
}

function asBool(value: unknown): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** Unlike blastRadius/shelfLife (JSON-encoded property values, where a
 * number stays a number through JSON.parse), certificate.* properties are
 * flat strings (see hash_patch/detect/certificates.py) -- "2048", "0" --
 * so they need string->number parsing, not asNumber's typeof check. */
function asNumberFromPropString(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `hash_patch:property.certificate.<field>` -> CertificateInfo
 * (hash_patch/detect/certificates.py). Only present when findingType is
 * "CERTIFICATE" or "CERTIFICATE_UNPARSEABLE" — every other finding has no
 * "certificate.*" properties at all, so this returns undefined for them. */
function parseCertificateInfo(props: Map<string, string>): CertificateInfo | undefined {
  const get = (field: string) => getProp(props, `property.certificate.${field}`);
  if (!Array.from(props.keys()).some((k) => k.includes(":property.certificate."))) {
    return undefined;
  }
  return {
    subject: get("subject"),
    issuer: get("issuer"),
    signatureAlgorithm: get("signatureAlgorithm"),
    notBefore: get("notBefore"),
    notAfter: get("notAfter"),
    selfSigned: asBool(get("selfSigned")),
    expired: asBool(get("expired")),
    expiringSoon: asBool(get("expiringSoon")),
    expiryWindowDays: asNumberFromPropString(get("expiryWindowDays")),
    chainPosition: asNumberFromPropString(get("chainPosition")),
    chainDepth: asNumberFromPropString(get("chainDepth")),
    fingerprintSha256: get("fingerprintSha256"),
    error: get("error"),
  };
}

/** `hash_patch:property.cloudKey.<field>` -> CloudKeyInfo
 * (hash_patch/detect/cloud_kms/). Only present when findingType is
 * "CLOUD_KEY_OPERATION" — every other finding has no "cloudKey.*"
 * properties at all, so this returns undefined for them. */
function parseCloudKeyInfo(props: Map<string, string>): CloudKeyInfo | undefined {
  const get = (field: string) => getProp(props, `property.cloudKey.${field}`);
  if (!Array.from(props.keys()).some((k) => k.includes(":property.cloudKey."))) {
    return undefined;
  }
  return {
    provider: get("provider"),
    sdk: get("sdk"),
    operation: get("operation"),
    verificationScope: get("verificationScope"),
  };
}

/** `hash_patch:property.<field>` -> BinaryCryptoInfo (hash_patch/detect/binary/).
 * Only present when findingType is "COMPILED_CRYPTO_ARTEFACT". */
function parseBinaryCryptoInfo(props: Map<string, string>): BinaryCryptoInfo | undefined {
  const get = (field: string) => getProp(props, `property.${field}`);
  if (!get("binaryFormat") && !get("evidenceType")) {
    return undefined;
  }
  return {
    binaryFormat: get("binaryFormat"),
    architecture: get("architecture"),
    evidenceType: get("evidenceType"),
    observedValue: get("observedValue"),
    library: get("library"),
    operation: get("operation"),
    algorithm: get("algorithm"),
    verificationScope: get("verificationScope"),
    honestFraming: get("honestFraming"),
  };
}

/** `hash_patch:property.<field>` -> ContainerProvenance (Phase 3).
 * Present when finding originates from a container image layer. */
function parseContainerProvenance(props: Map<string, string>): ContainerProvenance | undefined {
  const get = (field: string) => getProp(props, `property.${field}`);
  const containerImage = get("containerImage");
  const pathInsideContainer = get("pathInsideContainer");
  if (!containerImage && !pathInsideContainer) {
    return undefined;
  }
  return {
    containerImage,
    imageDigest: get("imageDigest"),
    layerDigest: get("layerDigest"),
    pathInsideContainer,
    effectiveFs: asBool(get("effectiveFs")) ?? true,
    verificationScope: get("verificationScope"),
    honestFraming: get("honestFraming"),
  };
}

function componentToFinding(component: RawCbomComponent, index: number): Finding {
  const props = propertyMap(component.properties);
  const shelfLife = parseShelfLifeEntries(props);
  const longestShelfLifeYears = shelfLife.reduce<number | undefined>((longest, entry) => {
    if (entry.shelfLifeYears === undefined) return longest;
    return longest === undefined || entry.shelfLifeYears > longest ? entry.shelfLifeYears : longest;
  }, undefined);

  return {
    id: component["bom-ref"] ?? `finding-${index}`,
    name: component.name ?? "(unnamed)",
    assetType: component.cryptoProperties?.assetType,
    primitive: component.cryptoProperties?.algorithmProperties?.primitive,
    parameterSetIdentifier: component.cryptoProperties?.algorithmProperties?.parameterSetIdentifier,
    mode: component.cryptoProperties?.algorithmProperties?.mode,
    oid: component.cryptoProperties?.oid,
    quantumStatus: asQuantumStatus(getProp(props, "quantumStatus")),
    reachability: asReachability(getProp(props, "reachability")),
    confidence: getProp(props, "confidence"),
    detectorId: getProp(props, "detectorId"),
    detectorVersion: getProp(props, "detectorVersion"),
    evidence: (component.evidence?.occurrences ?? []).map(parseOccurrence),
    shelfLife,
    longestShelfLifeYears,
    blastRadius: parseBlastRadiusEntries(props),
    findingType:
      (getProp(props, "findingType") as
        | "OPERATION"
        | "CRYPTO_REFERENCE"
        | "CERTIFICATE"
        | "CERTIFICATE_UNPARSEABLE"
        | "CLOUD_KEY_OPERATION"
        | "COMPILED_CRYPTO_ARTEFACT"
        | undefined) ??
      (getProp(props, "property.finding_type") as
        | "OPERATION"
        | "CRYPTO_REFERENCE"
        | "CERTIFICATE"
        | "CERTIFICATE_UNPARSEABLE"
        | "CLOUD_KEY_OPERATION"
        | "COMPILED_CRYPTO_ARTEFACT"
        | undefined) ??
      "OPERATION",
    certificate: parseCertificateInfo(props),
    cloudKey: parseCloudKeyInfo(props),
    binaryCrypto: parseBinaryCryptoInfo(props),
    container: parseContainerProvenance(props),
    callRelation: parseCallRelation(props),
    exposureState: asExposureState(getProp(props, "exposureState")),
    correlationStrength: asCorrelationStrength(getProp(props, "correlationStrength")),
    workload: getProp(props, "workload"),
    service: getProp(props, "service"),
    ingress: getProp(props, "ingress"),
    namespace: getProp(props, "namespace"),
    tfResources: getProp(props, "tfResources"),
    evidenceChain: getProp(props, "evidenceChain"),
  };
}

const CONTRADICTION_PREFIXES = [
  "hash_patch:contradiction.",
  "hash-patch:contradiction.",
];

/** `hash_patch:contradiction.<id>` on metadata.properties -> ContradictionEntry. */
function parseContradictions(metadataProperties: RawCbomProperty[] | undefined): ContradictionEntry[] {
  const out: ContradictionEntry[] = [];
  for (const p of metadataProperties ?? []) {
    if (typeof p?.name !== "string") continue;
    let contraId: string | null = null;
    for (const prefix of CONTRADICTION_PREFIXES) {
      if (p.name.startsWith(prefix)) {
        contraId = p.name.slice(prefix.length);
        break;
      }
    }
    if (!contraId) continue;
    const v = safeJsonParse(p.value);
    out.push({
      id: v ? (asString(v.id) ?? contraId) : contraId,
      severity: v ? asString(v.severity) : undefined,
      description: v ? asString(v.description) : undefined,
    });
  }
  return out;
}

function parseScannedFiles(properties: RawCbomProperty[] | undefined): string[] | undefined {
  for (const p of properties ?? []) {
    if (p.name === "hash_patch:scanned_files" || p.name === "hash-patch:scanned_files") {
      try {
        const parsed = JSON.parse(p.value);
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {}
    }
  }
  return undefined;
}

/**
 * Parse a raw CBOM JSON object (already `JSON.parse`d by the caller) into
 * typed data. Throws only if `raw` isn't a plausible CBOM document shape at
 * all (not an object, or `components` isn't an array) — callers (fetch/file
 * upload) are expected to catch and surface that as "not a valid CBOM file."
 */
export function parseCbomDocument(raw: unknown): ParsedCbom {
  if (raw === null || typeof raw !== "object") {
    throw new Error("Not a valid CBOM document: expected a JSON object.");
  }
  const doc = raw as RawCbomDocument;
  if (doc.components !== undefined && !Array.isArray(doc.components)) {
    throw new Error("Not a valid CBOM document: 'components' is not an array.");
  }

  return {
    serialNumber: doc.serialNumber,
    timestamp: doc.metadata?.timestamp,
    findings: (doc.components ?? []).map(componentToFinding),
    contradictions: parseContradictions(doc.metadata?.properties),
    scannedFiles: parseScannedFiles(doc.metadata?.properties),
  };
}
