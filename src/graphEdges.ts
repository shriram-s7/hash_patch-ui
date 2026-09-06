import type { Finding } from "./cbom/types";

export interface GraphEdge {
  source: string;
  target: string;
}

/**
 * Real call-graph edges (hash_patch/analyze/call_relations.py): a finding's
 * enclosing function has a direct caller/callee relationship with another
 * finding's enclosing function. Deduped by unordered pair so a callee edge
 * and its mirrored caller edge don't render twice, and filtered to ids
 * actually present as nodes (defensive against a stale property referencing
 * an asset id no longer in this document).
 *
 * The SAME edge data both Cluster mode and Tree mode render — this is the
 * single place that computes it, so the two layouts can never drift into
 * two different notions of "related."
 */
export function buildCallGraphEdges(findings: Finding[]): GraphEdge[] {
  const nodeIds = new Set(findings.map((f) => f.id));
  const seenPairs = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const f of findings) {
    const callees = f.callRelation?.callees ?? [];
    for (const targetId of callees) {
      if (!nodeIds.has(targetId)) continue;
      const pairKey = [f.id, targetId].sort().join("|");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      edges.push({ source: f.id, target: targetId });
    }
  }
  return edges;
}
