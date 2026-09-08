import type { DataChainType, Finding } from "./cbom/types";

export interface GraphEdge {
  source: string;
  target: string;
  chainType?: DataChainType;
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

/**
 * Same-function data-flow chain edges (hash_patch/analyze/data_chain.py,
 * Java only): finding B's argument expression literally carries finding A's
 * return value within one method body. This is a DIFFERENT relationship
 * type from buildCallGraphEdges — a call-graph edge means "function A calls
 * function B"; a data-chain edge means "A's output feeds B's input" and can
 * exist between two findings that share the very same enclosing function
 * (call_relations.py's blind spot). Kept as a structurally separate edge
 * list end-to-end (own CBOM property, own parsed field, own builder here)
 * so the two are never silently merged, and callers render them with a
 * visually distinct style.
 */
export function buildDataChainEdges(findings: Finding[]): GraphEdge[] {
  const nodeIds = new Set(findings.map((f) => f.id));
  const findingById = new Map(findings.map((f) => [f.id, f]));
  const seenPairs = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const f of findings) {
    const targets = f.dataChain?.chainTargets ?? [];
    for (const targetId of targets) {
      if (!nodeIds.has(targetId)) continue;
      const pairKey = `${f.id}|${targetId}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      let chainType: DataChainType | undefined = f.dataChain?.edges?.find(
        (e) => e.source === f.id && e.target === targetId
      )?.chainType;

      if (!chainType) {
        const targetFinding = findingById.get(targetId);
        chainType = targetFinding?.dataChain?.edges?.find(
          (e) => e.source === f.id && e.target === targetId
        )?.chainType;
      }

      if (!chainType) {
        chainType = f.dataChain?.chainType;
      }

      if (!chainType) {
        const isKeyGen =
          f.detectorId?.toLowerCase().includes("keygen") ||
          f.name.toLowerCase().includes("keygen") ||
          f.name.toLowerCase().includes("keygenerator");
        chainType = isKeyGen ? "key_material" : "ciphertext";
      }

      edges.push({ source: f.id, target: targetId, chainType });
    }
  }
  return edges;
}
