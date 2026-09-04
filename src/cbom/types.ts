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
  | "unknown";

export type Reachability = "live-external" | "live-internal" | "inert" | "unknown";

// --- Typed, decoded sub-shapes ---

export interface EvidenceOccurrence {
  locator: string | undefined;
  line: number | undefined;
  offset: number | undefined;
  column: number | undefined;
  snippet: string | undefined;
  sourceType: string | undefined;
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
  confidence: string | undefined;
  detectorId: string | undefined;
  detectorVersion: string | undefined;
  evidence: EvidenceOccurrence[];
  shelfLife: ShelfLifeEntry[];
  /** Longest shelf-life among this finding's entries, for sorting/display. */
  longestShelfLifeYears: number | undefined;
  blastRadius: BlastRadiusEntry[];
  findingType?: "OPERATION" | "CRYPTO_REFERENCE";
  /** Direct call-graph edges to other findings (hash_patch/analyze/call_relations.py).
   * `undefined` when this finding has no `hash_patch:property.callRelation` at
   * all (Go/C evidence, or genuinely no direct caller/callee finding). */
  callRelation: CallRelation | undefined;
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
}
