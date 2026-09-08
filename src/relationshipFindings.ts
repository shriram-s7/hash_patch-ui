import type { Finding } from "./cbom/types";

/**
 * A CRYPTO_REFERENCE (a string literal that merely looks like an algorithm
 * name, never passed to a crypto API call) or a CERTIFICATE/
 * CERTIFICATE_UNPARSEABLE finding (never "called" from code) has no
 * reachability and no call-graph membership -- the same rule FindingsTable.tsx
 * already applies to reachability filter buckets. Without this filter, these
 * findings show up in the Relationships graph as extra, permanently-isolated
 * nodes that render with no visual distinction from real operations and, since
 * several reuse the same algorithm names as real findings (e.g. a reference to
 * "SHA-1" alongside the real SHA-1 operation), look like duplicate findings in
 * the unconnected list.
 */
export function hasNoRelationships(f: Finding): boolean {
  return (
    f.findingType === "CRYPTO_REFERENCE" ||
    f.findingType === "CERTIFICATE" ||
    f.findingType === "CERTIFICATE_UNPARSEABLE"
  );
}

/** The finding set the Relationships graph (both Cluster and Tree mode) is
 * allowed to render nodes for -- see `hasNoRelationships`. */
export function relationshipFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !hasNoRelationships(f));
}
