/**
 * Types for the raw CycloneDX 1.6 CBOM JSON shape PRATYAKSHA emits, and the
 * typed `Finding` shape the rest of the app consumes. See cbomToFindings.ts
 * for the (only) place that reads `pratyaksha:`-namespaced property strings.
 *
 * Confirmed against the real fixtures (public/fixtures/demo.cbom.json,
 * real_world.cbom.json) rather than assumed — see backend enums in
 * pratyaksha/model/assets.py for the full value sets (a few, e.g.
 * "quantum-safe", don't appear in current fixture data but are valid).
 */

// --- Raw CycloneDX document shape (only the fields PRATYAKSHA populates) ---

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

// --- Enums (backend: pratyaksha/model/assets.py) ---

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

export interface ShelfLifeEntry {
  category: string;
  shelfLifeYears: number | undefined;
  statutoryBasis: string | undefined;
  confidence: string | undefined;
  moscaNote: string | undefined;
  locator: string | undefined;
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
 * a raw `pratyaksha:` property-name string outside cbomToFindings.ts. */
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
}
