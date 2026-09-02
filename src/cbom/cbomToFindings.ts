/**
 * The ONLY place in the app that touches raw `pratyaksha:`-namespaced
 * property-name strings. Everything downstream (metric cards, the findings
 * table, the detail panel) consumes the typed `Finding[]` / `ParsedCbom`
 * shape from ./types — never a raw property object.
 *
 * Defensive by construction: a missing or malformed field produces
 * `undefined` for that piece of a finding's data, never a thrown error.
 * The only thing that can still throw is the raw JSON.parse of the
 * uploaded/fetched file itself, which the caller is expected to catch.
 */
import type {
  BlastRadiusEntry,
  ContradictionEntry,
  EvidenceOccurrence,
  Finding,
  ParsedCbom,
  QuantumStatus,
  RawCbomComponent,
  RawCbomDocument,
  RawCbomProperty,
  RawOccurrence,
  Reachability,
  ShelfLifeEntry,
} from "./types";

const QUANTUM_STATUS_VALUES = new Set<QuantumStatus>([
  "broken-by-shor",
  "weakened-by-grover",
  "quantum-safe",
  "broken-classically",
  "unknown",
]);

const REACHABILITY_VALUES = new Set<Reachability>([
  "live-external",
  "live-internal",
  "inert",
  "unknown",
]);

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

/** `pratyaksha:property.shelfLife.<category>` -> ShelfLifeEntry. */
function parseShelfLifeEntries(props: Map<string, string>): ShelfLifeEntry[] {
  const prefix = "pratyaksha:property.shelfLife.";
  const entries: ShelfLifeEntry[] = [];
  for (const [name, rawValue] of props) {
    if (!name.startsWith(prefix)) continue;
    const category = name.slice(prefix.length);
    const v = safeJsonParse(rawValue);
    entries.push({
      category,
      shelfLifeYears: v ? asNumber(v.shelfLifeYears) : undefined,
      statutoryBasis: v ? asString(v.statutoryBasis) : undefined,
      confidence: v ? asString(v.confidence) : undefined,
      moscaNote: v ? asString(v.moscaNote) : undefined,
      locator: v ? asString(v.locator) : undefined,
    });
  }
  return entries;
}

/** `pratyaksha:property.blastRadius.<kind>.<name>.<line>` -> BlastRadiusEntry. */
function parseBlastRadiusEntries(props: Map<string, string>): BlastRadiusEntry[] {
  const prefix = "pratyaksha:property.blastRadius.";
  const entries: BlastRadiusEntry[] = [];
  for (const [name, rawValue] of props) {
    if (!name.startsWith(prefix)) continue;
    const key = name.slice(prefix.length);
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
    quantumStatus: asQuantumStatus(props.get("pratyaksha:quantumStatus")),
    reachability: asReachability(props.get("pratyaksha:reachability")),
    confidence: props.get("pratyaksha:confidence"),
    detectorId: props.get("pratyaksha:detectorId"),
    detectorVersion: props.get("pratyaksha:detectorVersion"),
    evidence: (component.evidence?.occurrences ?? []).map(parseOccurrence),
    shelfLife,
    longestShelfLifeYears,
    blastRadius: parseBlastRadiusEntries(props),
  };
}

/** `pratyaksha:contradiction.<id>` on metadata.properties -> ContradictionEntry. */
function parseContradictions(metadataProperties: RawCbomProperty[] | undefined): ContradictionEntry[] {
  const prefix = "pratyaksha:contradiction.";
  const out: ContradictionEntry[] = [];
  for (const p of metadataProperties ?? []) {
    if (typeof p?.name !== "string" || !p.name.startsWith(prefix)) continue;
    const v = safeJsonParse(p.value);
    out.push({
      id: v ? (asString(v.id) ?? p.name.slice(prefix.length)) : p.name.slice(prefix.length),
      severity: v ? asString(v.severity) : undefined,
      description: v ? asString(v.description) : undefined,
    });
  }
  return out;
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
  };
}
