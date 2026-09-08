import type { Finding, QuantumStatus, Reachability } from "./cbom/types";

/**
 * Priority Scoring Model for Cryptographic Risk
 *
 * Quantifies combined risk by multiplying Algorithmic Vulnerability (quantumStatus)
 * by Exploitability / Reachability (reachability).
 *
 * 1. Quantum Impact / Algorithmic Vulnerability (quantumStatus):
 *    - broken-by-shor: 1000 (catastrophic asymmetric compromise via Shor's algorithm: RSA, ECDSA, DH)
 *    - broken-classically: 700 (actively broken today by classical cryptanalysis: MD5, SHA1, DES, RC4)
 *    - weakened-by-grover: 400 (symmetric key & hash search space halved by Grover's algorithm: AES-128)
 *    - quantum-safe: 100 (NIST PQC standardized algorithms: ML-DSA, ML-KEM, SLH-DSA)
 *    - unknown / undefined: 50 (indeterminate baseline)
 *    - algorithm-opaque-provider-managed: 1 (cloud KMS/HSM client call — NOT a
 *      quantum verdict, sits below the minimum real operation score so it can
 *      never be mistaken for (or outrank) a genuine quantum risk)
 *
 * 2. Exploitability / Reachability (reachability):
 *    - live-external: 4.0 (reachable from untrusted network / public interface)
 *    - live-internal: 3.0 (reachable within application runtime execution flow)
 *    - unknown: 2.0 (indeterminate reachability; conservative assumption of potential exposure)
 *    - inert: 1.0 (unreachable code path, dead routine, or isolated test vector)
 *
 * Score Formula:
 *   PriorityScore = StatusWeight(quantumStatus) * ReachabilityMultiplier(reachability)
 *
 * Range:
 *   - Maximum: 4000 (broken-by-shor + live-external)
 *   - Minimum: 50 (unknown status + inert)
 *
 * Subtree Aggregation:
 *   AggregatePriority(subtree) = max(PriorityScore(finding) for finding in subtree)
 *   A single live-external RSA finding (4000) always outranks a folder with ten inert MD5 mentions (700).
 */

export const QUANTUM_STATUS_WEIGHTS: Record<QuantumStatus | "unknown", number> = {
  "broken-by-shor": 1000,
  "broken-classically": 700,
  "weakened-by-grover": 400,
  "quantum-safe": 100,
  "unknown": 50,
  // Cloud KMS/HSM client call (algorithm-opaque-provider-managed): weight 1
  // so the max score is 1*1 = 1, below the minimum REAL operation finding
  // (unknown x inert = 5). This is not a quantum verdict and must never
  // outrank or tie-score with a genuine quantum risk on the 0-4000 scale —
  // only with the CRYPTO_REFERENCE sentinel (0) that sorts below it.
  "algorithm-opaque-provider-managed": 1,
};

/**
 * Updated Reachability Multipliers:
 * - live-external: 1.0 (full weight; actively exposed attack surface)
 * - live-internal: 0.6 (reduced weight; reachable inside application execution flow)
 * - unknown: 0.4 (indeterminate exposure; kept meaningfully above inert per fail-safe principle)
 * - inert: 0.1 (unreachable / dead code; deprioritized but never hidden)
 */
export const REACHABILITY_MULTIPLIERS: Record<Reachability | "unknown", number> = {
  "live-external": 1.0,
  "live-internal": 0.6,
  "unknown": 0.4,
  "inert": 0.1,
};

/**
 * A CRYPTO_REFERENCE finding (a string literal that merely looks like an
 * algorithm name, never passed as an argument to any crypto API call) has no
 * real-world exploitability — there is no live call for an attacker to reach.
 * It must never carry a score on the same 0-4000 scale as a genuine
 * operation, and must never be able to outrank or tie-score with one. This
 * sentinel sits below every possible operation score (minimum 5: unknown
 * status x inert) so it always sorts last.
 */
export const REFERENCE_PRIORITY_SCORE = 0;

/**
 * Computes the explicit numerical priority score for an individual crypto finding.
 * Formula: Math.round(QUANTUM_STATUS_WEIGHTS[status] * REACHABILITY_MULTIPLIERS[reachability])
 *
 * CRYPTO_REFERENCE findings are excluded from this scale entirely — see
 * REFERENCE_PRIORITY_SCORE.
 */
export function computePriorityScore(finding: Finding): number {
  if (finding.findingType === "CRYPTO_REFERENCE") {
    return REFERENCE_PRIORITY_SCORE;
  }
  const statusKey = finding.quantumStatus ?? "unknown";
  const reachKey = finding.reachability ?? "unknown";
  const statusWeight = QUANTUM_STATUS_WEIGHTS[statusKey] ?? 50;
  const reachMultiplier = REACHABILITY_MULTIPLIERS[reachKey] ?? 0.4;
  return Math.round(statusWeight * reachMultiplier);
}

/**
 * Single consolidated comparator for sorting findings by risk priority across all views:
 * 1. Priority score descending (primary)
 * 2. Quantum status weight descending (tiebreak)
 * 3. Reachability multiplier descending (tiebreak)
 * 4. Finding name / locator alphabetical (stable tiebreak)
 */
export function compareFindingsPriority(a: Finding, b: Finding): number {
  const scoreA = computePriorityScore(a);
  const scoreB = computePriorityScore(b);
  if (scoreB !== scoreA) {
    return scoreB - scoreA;
  }
  const statusWeightA = QUANTUM_STATUS_WEIGHTS[a.quantumStatus ?? "unknown"] ?? 50;
  const statusWeightB = QUANTUM_STATUS_WEIGHTS[b.quantumStatus ?? "unknown"] ?? 50;
  if (statusWeightB !== statusWeightA) {
    return statusWeightB - statusWeightA;
  }
  const reachMultA = REACHABILITY_MULTIPLIERS[a.reachability ?? "unknown"] ?? 0.4;
  const reachMultB = REACHABILITY_MULTIPLIERS[b.reachability ?? "unknown"] ?? 0.4;
  if (reachMultB !== reachMultA) {
    return reachMultB - reachMultA;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Computes the aggregate priority score for a group or subtree of findings.
 * Governed by the worst-case (maximum) priority finding contained within.
 */
export function computeAggregatePriority(findings: Finding[]): number {
  if (findings.length === 0) return 0;
  let maxScore = 0;
  for (const f of findings) {
    const score = computePriorityScore(f);
    if (score > maxScore) {
      maxScore = score;
    }
  }
  return maxScore;
}

/**
 * For a finding (especially one with mixed reachability), returns the individual
 * evidence site that earned the highest reachability multiplier governing its priority.
 */
export function highestPriorityEvidenceSite(finding: Finding) {
  if (!finding.evidence || finding.evidence.length === 0) return undefined;
  let bestEv = finding.evidence[0];
  let bestMult = -1;
  for (const ev of finding.evidence) {
    const reach = ev.reachability ?? finding.reachability ?? "unknown";
    const mult = REACHABILITY_MULTIPLIERS[reach] ?? 0.4;
    if (mult > bestMult) {
      bestMult = mult;
      bestEv = ev;
    }
  }
  return bestEv;
}
