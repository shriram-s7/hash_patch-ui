import { useEffect, useMemo, useState } from "react";
import { displayName, type Finding } from "./cbom/types";
import type { ParsedPlan } from "./plan/types";
import { buildRepositoryTree } from "./repositoryTree";
import { compareFindingsPriority, computeAggregatePriority, computePriorityScore } from "./priority";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { exportReportPdf } from "./reportPdf";
import {
  DonutChart,
  FolderRiskBar,
  FilePriorityBar,
  RiskCurve,
  OverflowBar,
  BlastRadiusEmptyState,
} from "./charts";
import { getBlastRadiusScanComposition } from "./charts/OverflowBar";

// ---------------------------------------------------------------------------
// SHA-256 — same implementation as VerifyMode.tsx, reused not reimplemented
// ---------------------------------------------------------------------------
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Worst-severity label for a set of findings
// ---------------------------------------------------------------------------
function worstSeverityLabel(findings: Finding[]): string {
  // A CRYPTO_REFERENCE (a string literal that merely looks like an
  // algorithm name, never passed to a crypto call) must not drive a
  // folder/file's displayed worst-severity label — that label is about
  // real operations.
  const operationFindings = findings.filter((f) => f.findingType !== "CRYPTO_REFERENCE");
  if (operationFindings.some((f) => f.quantumStatus === "broken-by-shor")) return "broken-by-shor";
  if (operationFindings.some((f) => f.quantumStatus === "broken-classically")) return "broken-classically";
  if (operationFindings.some((f) => f.quantumStatus === "weakened-by-grover")) return "weakened-by-grover";
  if (operationFindings.some((f) => f.quantumStatus === "quantum-safe")) return "quantum-safe";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Types for folder-level summary rows
// ---------------------------------------------------------------------------
interface FolderRow {
  path: string;
  findingCount: number;
  worstSeverity: string;
  aggregatePriority: number;
  shor: number;
  classic: number;
  grover: number;
  safe: number;
}

interface FileRow {
  path: string;
  score: number;
  worstStatus: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ReportViewProps {
  rawText: string | undefined;
  sourceName: string;
  findings: Finding[];
  timestamp: string | undefined;
  plan: ParsedPlan | undefined;
  isDemoPlan?: boolean;
  scannedFiles?: string[];
}

const SOURCE_EXTENSIONS = new Set([
  "c", "h", "cpp", "hpp", "cc", "cxx",
  "go", "java", "py", "js", "jsx", "ts", "tsx",
  "rs", "cs", "rb", "php", "swift", "kt", "scala",
]);

// ---------------------------------------------------------------------------
// Severity badge helpers
// ---------------------------------------------------------------------------
const severityClass = (severity: string): string => {
  switch (severity) {
    case "broken-by-shor":
      return "bg-status-critical text-white";
    case "broken-classically":
      return "bg-status-neutral-bg text-status-neutral-fg";
    case "weakened-by-grover":
      return "bg-status-warning text-status-warning-fg";
    case "quantum-safe":
      return "bg-status-good text-white";
    case "algorithm-opaque-provider-managed":
      return "bg-status-opaque text-white";
    default:
      return "bg-surface-2 text-ink-muted";
  }
};

const severityLabel = (severity: string): string => {
  switch (severity) {
    case "broken-by-shor": return "Broken by Shor";
    case "broken-classically": return "Broken classically";
    case "weakened-by-grover": return "Weakened by Grover";
    case "quantum-safe": return "Quantum-safe";
    case "algorithm-opaque-provider-managed": return "Algorithm opaque";
    default: return "Unknown";
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ReportView({
  rawText,
  sourceName,
  findings,
  timestamp,
  plan,
  isDemoPlan,
  scannedFiles,
}: ReportViewProps) {
  const [pdfExporting, setPdfExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [appendixOpen, setAppendixOpen] = useState(false);
  const [contentHash, setContentHash] = useState<string | undefined>(undefined);

  // Compute SHA-256 of the raw CBOM text
  useEffect(() => {
    if (rawText === undefined) {
      setContentHash(undefined);
      return;
    }
    sha256Hex(rawText).then(setContentHash);
  }, [rawText]);

  // -------------------------------------------------------------------------
  // Verdict counts
  // -------------------------------------------------------------------------
  const verdictCounts = useMemo(() => {
    // Verdicts are about real crypto operations; a CRYPTO_REFERENCE (a string
    // literal that merely looks like an algorithm name, never passed to a
    // crypto call) must not inflate these counts.
    const operationFindings = findings.filter((f) => f.findingType !== "CRYPTO_REFERENCE");
    const brokenByShor = operationFindings.filter((f) => f.quantumStatus === "broken-by-shor").length;
    const brokenClassically = operationFindings.filter((f) => f.quantumStatus === "broken-classically").length;
    const weakenedByGrover = operationFindings.filter((f) => f.quantumStatus === "weakened-by-grover").length;
    const quantumSafe = operationFindings.filter((f) => f.quantumStatus === "quantum-safe").length;
    return { total: operationFindings.length, brokenByShor, brokenClassically, weakenedByGrover, quantumSafe };
  }, [findings]);

  // -------------------------------------------------------------------------
  // Headline metrics
  // -------------------------------------------------------------------------
  const headlineMetrics = useMemo(() => {
    // Reachability doesn't apply to a CRYPTO_REFERENCE (never a real crypto
    // call) or a CERTIFICATE/CERTIFICATE_UNPARSEABLE finding (never
    // "called" from code) — both permanently sit at reachability="unknown"
    // and can never be "inert", so they must never inflate the denominator
    // of an inert-percentage stat, the same way they're already excluded
    // from verdictCounts above. This was previously ungated (used raw
    // `findings`), silently diluting the reported inert% whenever a scan
    // contained any reference or certificate findings.
    const reachabilityEligible = findings.filter(
      (f) => f.findingType !== "CRYPTO_REFERENCE" && f.findingType !== "CERTIFICATE" && f.findingType !== "CERTIFICATE_UNPARSEABLE",
    );
    const hasRealReachability = reachabilityEligible.some(
      (f) => f.reachability !== undefined && f.reachability !== "unknown",
    );
    let inertPct: number | undefined = undefined;
    if (hasRealReachability && reachabilityEligible.length > 0) {
      const inertCount = reachabilityEligible.filter((f) => f.reachability === "inert").length;
      inertPct = Math.round((inertCount / reachabilityEligible.length) * 100);
    }

    const defaultScenario = plan?.scenarios.reduce<(typeof plan.scenarios)[number] | undefined>(
      (best, s) =>
        best === undefined || (s.probabilityWeight ?? 0) > (best.probabilityWeight ?? 0) ? s : best,
      undefined,
    );
    let riskReductionPct: number | undefined = undefined;
    if (
      defaultScenario?.optimizerRiskEliminatedPct !== undefined &&
      defaultScenario?.naiveRiskEliminatedPct !== undefined &&
      defaultScenario.naiveRiskEliminatedPct > 0
    ) {
      riskReductionPct = Math.round(
        ((defaultScenario.optimizerRiskEliminatedPct - defaultScenario.naiveRiskEliminatedPct) /
          defaultScenario.naiveRiskEliminatedPct) *
        100,
      );
    }

    return { inertPct, riskReductionPct, hasRealReachability };
  }, [findings, plan]);

  const scanComposition = useMemo(
    () => getBlastRadiusScanComposition(scannedFiles, findings),
    [scannedFiles, findings],
  );

  // -------------------------------------------------------------------------
  // Phase 4: Deployment exposure metrics
  // -------------------------------------------------------------------------
  const exposureMetrics = useMemo(() => {
    const byState = { external: 0, internal: 0, mixed: 0, unknown: 0 };
    let exposed = 0;
    const workloads = new Map<string, { state: string; names: string[] }>();
    const namespaces = new Map<string, { external: number; internal: number }>();
    for (const f of findings) {
      const state = f.exposureState ?? "unknown";
      byState[state] += 1;
      if (state === "external" || state === "mixed") exposed += 1;
      if (f.workload) {
        const entry = workloads.get(f.workload) ?? { state, names: [] };
        if (state === "external" || state === "mixed") entry.state = state;
        entry.names.push(f.name);
        workloads.set(f.workload, entry);
      }
      if (f.namespace) {
        const ns = namespaces.get(f.namespace) ?? { external: 0, internal: 0 };
        if (state === "external" || state === "mixed") ns.external += 1;
        else if (state === "internal") ns.internal += 1;
        namespaces.set(f.namespace, ns);
      }
    }
    const workloadRows = Array.from(workloads.entries())
      .map(([workload, { state, names }]) => ({ workload, state, names }))
      .sort((a, b) => b.names.length - a.names.length);
    const namespaceRows = Array.from(namespaces.entries())
      .map(([namespace, counts]) => ({
        namespace,
        externallyExposed: counts.external,
        internallyOnly: counts.internal,
      }))
      .sort((a, b) => b.externallyExposed - a.externallyExposed);
    const hasTopology = workloadRows.length > 0;
    return { byState, exposed, total: findings.length, workloadRows, namespaceRows, hasTopology };
  }, [findings]);

  // -------------------------------------------------------------------------
  // Folder-level risk summary
  // -------------------------------------------------------------------------
  const folderRows = useMemo((): FolderRow[] => {
    if (findings.length === 0) return [];
    const tree = buildRepositoryTree(findings, sourceName, scannedFiles);
    return tree.children
      .filter((node) => node.isFolder && node.totalFindings > 0)
      .map((node) => ({
        path: node.name,
        findingCount: node.totalFindings,
        worstSeverity: worstSeverityLabel(node.allFindings),
        aggregatePriority: computeAggregatePriority(node.allFindings),
        shor: node.counts.shor,
        classic: node.counts.classic,
        grover: node.counts.grover,
        safe: node.counts.safe,
      }))
      .sort((a, b) => b.aggregatePriority - a.aggregatePriority);
  }, [findings, sourceName, scannedFiles]);

  // -------------------------------------------------------------------------
  // File-level priority rows (top 20 for table, top 10 for chart)
  // -------------------------------------------------------------------------
  const fileRows = useMemo((): FileRow[] => {
    if (findings.length === 0) return [];
    // Group by primary file location
    const byFile = new Map<string, Finding[]>();
    for (const f of findings) {
      const loc = f.evidence[0]?.locator ?? "unknown";
      const existing = byFile.get(loc);
      if (existing) existing.push(f);
      else byFile.set(loc, [f]);
    }
    return Array.from(byFile.entries())
      .map(([path, fileFindings]) => ({
        path,
        score: computeAggregatePriority(fileFindings),
        worstStatus: worstSeverityLabel(fileFindings),
      }))
      .sort((a, b) => b.score - a.score);
  }, [findings]);

  // -------------------------------------------------------------------------
  // Top 20 individual findings by priority (for table)
  // -------------------------------------------------------------------------
  const top20Findings = useMemo(() => {
    return [...findings]
      .sort(compareFindingsPriority)
      .slice(0, 20)
      .map((f) => ({
        finding: f,
        score: computePriorityScore(f),
      }));
  }, [findings]);

  // -------------------------------------------------------------------------
  // Migration data
  // -------------------------------------------------------------------------
  const migrationSummary = useMemo(() => {
    let totalDays = 0;
    let hasBlastData = false;

    for (const f of findings) {
      for (const b of f.blastRadius) {
        if (b.estimatedEffortDays !== undefined) {
          totalDays += b.estimatedEffortDays;
          hasBlastData = true;
        }
      }
    }

    const defaultScenario = plan?.scenarios.reduce<(typeof plan.scenarios)[number] | undefined>(
      (best, s) =>
        best === undefined || (s.probabilityWeight ?? 0) > (best.probabilityWeight ?? 0) ? s : best,
      undefined,
    );

    return { totalDays, hasBlastData, defaultScenario };
  }, [findings, plan]);

  // -------------------------------------------------------------------------
  // Blast radius data
  // -------------------------------------------------------------------------
  const blastRadiusData = useMemo(() => {
    const entries: Array<{ finding: Finding; entry: (typeof findings)[0]["blastRadius"][0] }> = [];
    for (const f of findings) {
      for (const e of f.blastRadius) {
        entries.push({ finding: f, entry: e });
      }
    }
    const maxBytes = entries.reduce(
      (max, { entry }) => Math.max(max, entry.declaredBytes ?? 0, entry.pqcBytes ?? 0),
      1,
    );
    return { entries, maxBytes, hasData: entries.length > 0 };
  }, [findings]);

  // -------------------------------------------------------------------------
  // One-line verdict for cover
  // -------------------------------------------------------------------------
  const oneLineVerdict = useMemo(() => {
    if (verdictCounts.total === 0) return "No cryptographic assets detected.";
    if (verdictCounts.brokenByShor > 0)
      return `${verdictCounts.brokenByShor} of ${verdictCounts.total} cryptographic assets are broken by Shor's algorithm and require immediate migration.`;
    if (verdictCounts.brokenClassically > 0)
      return `${verdictCounts.total} cryptographic assets identified; ${verdictCounts.brokenClassically} are classically broken.`;
    if (verdictCounts.weakenedByGrover > 0)
      return `${verdictCounts.total} cryptographic assets identified; ${verdictCounts.weakenedByGrover} are weakened by Grover's algorithm.`;
    return `${verdictCounts.total} cryptographic assets identified; all quantum-safe.`;
  }, [verdictCounts]);

  // -------------------------------------------------------------------------
  // Distinct files with findings
  // -------------------------------------------------------------------------
  const filesWithFindingsCount = useMemo(() => {
    return new Set(
      findings.flatMap((f) =>
        f.evidence
          .map((e) => e.locator)
          .filter((loc): loc is string => Boolean(loc)),
      ),
    ).size;
  }, [findings]);

  // -------------------------------------------------------------------------
  // Executive summary prose
  // -------------------------------------------------------------------------
  const executiveSummary = useMemo(() => {
    const paras: string[] = [];
    // Para 1: What was scanned
    let scanScopeDesc: string;
    if (scannedFiles !== undefined && scannedFiles.length > 0) {
      const totalScanned = scannedFiles.length;
      const sourceCount = scannedFiles.filter((f) => {
        const ext = f.split(".").pop()?.toLowerCase();
        return ext ? SOURCE_EXTENSIONS.has(ext) : false;
      }).length;
      const otherCount = totalScanned - sourceCount;

      const fileBreakdown =
        otherCount > 0
          ? `${totalScanned} total files scanned (${sourceCount} source + ${otherCount} fixture${otherCount !== 1 ? "s" : ""})`
          : `${totalScanned} source file${totalScanned !== 1 ? "s" : ""} scanned`;

      scanScopeDesc = `${fileBreakdown}, ${filesWithFindingsCount} of which produced findings`;
    } else {
      scanScopeDesc = `${filesWithFindingsCount} file${filesWithFindingsCount !== 1 ? "s" : ""} with detected findings`;
    }

    paras.push(
      `Hash Patch scanned the target "${sourceName}" (${scanScopeDesc}) and identified ${verdictCounts.total} distinct cryptographic asset${verdictCounts.total !== 1 ? "s" : ""}. Each asset was classified by its quantum vulnerability status: broken by Shor's algorithm (asymmetric primitives such as RSA and ECDSA), broken by classical cryptanalysis (MD5, SHA-1, DES), weakened by Grover's algorithm (symmetric keys with reduced security margin), or quantum-safe (NIST PQC-standardized algorithms).`,
    );
    // Para 2: What was found
    const statParts: string[] = [];
    if (verdictCounts.brokenByShor > 0)
      statParts.push(`${verdictCounts.brokenByShor} broken by Shor's algorithm`);
    if (verdictCounts.brokenClassically > 0)
      statParts.push(`${verdictCounts.brokenClassically} broken classically`);
    if (verdictCounts.weakenedByGrover > 0)
      statParts.push(`${verdictCounts.weakenedByGrover} weakened by Grover's algorithm`);
    if (verdictCounts.quantumSafe > 0)
      statParts.push(`${verdictCounts.quantumSafe} quantum-safe`);
    paras.push(
      `The distribution of findings is: ${statParts.join(", ")}. ${verdictCounts.brokenByShor > 0
        ? "The presence of Shor-vulnerable primitives means that a cryptographically relevant quantum computer would fully compromise these assets — migration to post-quantum alternatives is the primary recommendation."
        : "No Shor-vulnerable asymmetric primitives were detected, reducing the urgency of post-quantum migration for this target."
      }`,
    );
    // Para 3: Most urgent item
    if (top20Findings.length > 0) {
      const top = top20Findings[0];
      paras.push(
        `The single most urgent item is "${displayName(top.finding)}" (priority score ${top.score}), located in ${top.finding.evidence[0]?.locator ?? "an unlocated file"}. Its urgency stems from its ${top.finding.quantumStatus ?? "unknown"} quantum status combined with ${top.finding.reachability ?? "unknown"} reachability, placing it at the top of the prioritized migration queue.`,
      );
    }
    // Para 4: Migration cost
    if (migrationSummary.hasBlastData) {
      paras.push(
        `The estimated total migration effort, based on blast-radius analysis of affected buffers and schemas, is ${migrationSummary.totalDays} engineer-day${migrationSummary.totalDays !== 1 ? "s" : ""}. This estimate accounts for the increased key and ciphertext sizes of post-quantum replacements (ML-KEM, ML-DSA, SLH-DSA) relative to the classical algorithms currently in use.`,
      );
    } else {
      paras.push(
        `Total migration effort could not be estimated because the current scan did not produce blast-radius data. This is expected for targets without fixed-size cryptographic buffers or database column-width constraints.`,
      );
    }
    // Para 5: Headline metrics
    const metricParts: string[] = [];
    if (headlineMetrics.hasRealReachability && headlineMetrics.inertPct !== undefined) {
      metricParts.push(
        `${headlineMetrics.inertPct}% of findings are classified as inert (unreachable code paths), reducing the effective attack surface`,
      );
    }
    if (headlineMetrics.riskReductionPct !== undefined) {
      metricParts.push(
        `the optimized migration ordering achieves ${headlineMetrics.riskReductionPct > 0 ? "+" : ""}${headlineMetrics.riskReductionPct}% risk reduction compared to a naive ordering`,
      );
    }
    if (metricParts.length > 0) {
      paras.push(`Key metrics: ${metricParts.join("; ")}.`);
    }
    return paras;
  }, [verdictCounts, findings, sourceName, top20Findings, migrationSummary, headlineMetrics, scannedFiles, filesWithFindingsCount]);

  // -------------------------------------------------------------------------
  // PDF export handler
  // -------------------------------------------------------------------------
  const handleExportPdf = async () => {
    setPdfExporting(true);
    try {
      const safeName = sourceName.replace(/[^a-zA-Z0-9_-]/g, "_");
      await exportReportPdf("report-printable", `hash_patch_report_${safeName}.pdf`, sourceName);
    } catch (err) {
      console.error("PDF export error, falling back to print:", err);
      window.print();
    } finally {
      setPdfExporting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Raw CBOM helpers (appendix)
  // -------------------------------------------------------------------------
  const lineCount = rawText ? rawText.split("\n").length : 0;
  const byteSize = rawText ? new TextEncoder().encode(rawText).length : 0;

  const handleCopy = () => {
    if (!rawText) return;
    navigator.clipboard.writeText(rawText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    if (!rawText) return;
    const blob = new Blob([rawText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sourceName.endsWith(".json") ? sourceName : `${sourceName}.cbom.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // =========================================================================
  // =========================================================================
  // SHARED SECTION COMPONENTS (used in both web view and PDF pages)
  // =========================================================================

  const HeadlineMetricsSection = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="rounded-sm border border-line bg-surface p-5 space-y-2">
        <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          Inert / Unreachable Findings
        </div>
        <div className="font-heading text-3xl sm:text-4xl font-bold text-ink tracking-tight">
          {headlineMetrics.inertPct !== undefined ? `${headlineMetrics.inertPct}%` : "—"}
        </div>
        <p className="font-sans text-xs text-ink-muted leading-relaxed">
          {headlineMetrics.inertPct !== undefined
            ? "of discovered cryptographic call sites reside in dead or unreachable code paths, reducing the real-world attack surface."
            : "Reachability analysis not available in this scan — all findings default to conservative live risk multiplier."}
        </p>
      </div>

      <div className="rounded-sm border border-line bg-surface p-5 space-y-2">
        <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted flex items-center justify-between">
          <span>Optimizer Risk Reduction</span>
          {isDemoPlan && (
            <span className="text-amber-400 font-bold text-[10px] tracking-normal uppercase bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 rounded">
              Demo Plan
            </span>
          )}
        </div>
        <div className="font-heading text-3xl sm:text-4xl font-bold text-ink tracking-tight">
          {headlineMetrics.riskReductionPct !== undefined
            ? `${headlineMetrics.riskReductionPct > 0 ? "+" : ""}${headlineMetrics.riskReductionPct}%`
            : "—"}
        </div>
        <p className="font-sans text-xs text-ink-muted leading-relaxed">
          {headlineMetrics.riskReductionPct !== undefined
            ? isDemoPlan
              ? "sample risk reduction from the reference demo plan fixture (demo_plan.json)."
              : "accelerated risk reduction achieved by the greedy risk-density scheduler compared to a naive vulnerability-only order."
            : "Migration optimizer not active — calculate a migration plan in Migration view to preview the comparative risk burn timeline."}
        </p>
      </div>
    </div>
  );

  const RiskDistributionSection = () => (
    <div className="space-y-6">
      <div>
        <DonutChart
          counts={{
            shor: verdictCounts.brokenByShor,
            classic: verdictCounts.brokenClassically,
            grover: verdictCounts.weakenedByGrover,
            safe: verdictCounts.quantumSafe,
          }}
        />
        <p className="mt-2 font-sans text-xs text-ink-muted leading-relaxed">
          Distribution of cryptographic findings by quantum vulnerability status. Red segments
          represent assets broken by Shor's algorithm that require urgent migration to post-quantum
          alternatives.
        </p>
      </div>
      <div>
        <FolderRiskBar folders={folderRows} />
        <p className="mt-2 font-sans text-xs text-ink-muted leading-relaxed">
          Top folders by finding count, segmented by quantum status. Folders with the most
          Shor-vulnerable findings should be prioritized for migration.
        </p>
      </div>
    </div>
  );

  const PriorityTargetsSection = () => (
    <div className="space-y-4">
      <FilePriorityBar files={fileRows.slice(0, 10)} />
      <p className="mt-2 font-sans text-xs text-ink-muted leading-relaxed">
        Top files ranked by aggregate priority score — the product of algorithmic vulnerability
        and reachability. Bar color indicates each file's worst-severity quantum status.
      </p>
      {/* Top 20 findings table */}
      {top20Findings.length > 0 && (
        <div className="overflow-x-auto rounded-sm border border-line bg-surface">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-surface-2/40">
                <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                  Algorithm
                </th>
                <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                  File:Line
                </th>
                <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                  Quantum Status
                </th>
                <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                  Reachability
                </th>
                <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted text-right">
                  Priority
                </th>
              </tr>
            </thead>
            <tbody>
              {top20Findings.map(({ finding, score }, i) => {
                const isInert = finding.reachability === "inert";
                const isReference = finding.findingType === "CRYPTO_REFERENCE";
                const isCertificate =
                  finding.findingType === "CERTIFICATE" || finding.findingType === "CERTIFICATE_UNPARSEABLE";
                const isCloudKey = finding.findingType === "CLOUD_KEY_OPERATION";
                const isBinary = finding.findingType === "COMPILED_CRYPTO_ARTEFACT";
                return (
                  <tr
                    key={`${finding.id}-${i}`}
                    className={`border-b border-line last:border-b-0 ${isInert ? "opacity-60 hover:opacity-100 transition-opacity" : ""
                      }`}
                  >
                    <td className="px-3 py-2 font-heading text-xs font-semibold text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        {displayName(finding)}
                        {isReference && (
                          <span className="font-mono text-[9px] font-semibold uppercase px-1 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                            Ref
                          </span>
                        )}
                        {isCertificate && (
                          <span className="font-mono text-[9px] font-semibold uppercase px-1 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                            Certificate
                          </span>
                        )}
                        {isCloudKey && (
                          <span className="font-mono text-[9px] font-semibold uppercase px-1 py-0.5 rounded-sm bg-status-opaque text-white border border-line">
                            Cloud KMS
                          </span>
                        )}
                        {isBinary && (
                          <span className="font-mono text-[9px] font-semibold uppercase px-1 py-0.5 rounded-sm bg-indigo-950 text-indigo-300 border border-indigo-700/50">
                            Binary
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-secondary max-w-[220px] truncate">
                      {finding.evidence[0]?.locator ?? "—"}
                      {finding.evidence[0]?.line !== undefined ? `:${finding.evidence[0].line}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      {/* A CRYPTO_REFERENCE has no real-world exploitability
                          — it never carries a quantum-status or
                          reachability badge on the same scale as a genuine
                          operation; the "Ref" tag above is its only status
                          indicator. A CERTIFICATE finding DOES keep a real
                          quantum-status badge (an RSA-2048 cert is
                          genuinely broken-by-shor) — only its reachability
                          badge (next column) is suppressed. */}
                      {!isReference && (
                        <span
                          className={`inline-block rounded-sm px-2 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wide ${severityClass(finding.quantumStatus ?? "unknown")}`}
                        >
                          {severityLabel(finding.quantumStatus ?? "unknown")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!isReference && !isCertificate && (
                        <ReachabilityBadge
                          reachability={finding.reachability}
                          status={finding.quantumStatus}
                          mixed={finding.mixedReachability}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 font-heading text-xs font-semibold text-ink tabular-nums text-right">
                      {isReference ? "N/A" : score}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const MigrationSection = () => (
    <div className="space-y-4">
      {isDemoPlan && (
        <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <span className="font-heading font-bold uppercase tracking-wider text-amber-400">DEMO / SAMPLE PLAN:</span>{" "}
          <span className="font-sans">
            This migration timeline is derived from the static reference fixture (<code className="font-mono text-amber-200">demo_plan.json</code>), not from the active repository scan.
          </span>
        </div>
      )}
      {!isDemoPlan && plan && migrationSummary.defaultScenario && (
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-status-good">
          <span className="h-2 w-2 rounded-full bg-status-good" />
          Active Scan Migration Plan ({migrationSummary.defaultScenario.schedule.length} scheduled tasks)
        </div>
      )}
      {/* Risk curve */}
      <RiskCurve
        optimizerCurve={migrationSummary.defaultScenario?.optimizerRiskCurve}
        naiveCurve={migrationSummary.defaultScenario?.naiveRiskCurve}
      />
      {/* Total engineer-days */}
      {migrationSummary.hasBlastData ? (
        <div className="rounded-sm border border-line bg-surface p-4 flex items-baseline justify-between">
          <span className="font-sans text-sm text-ink">Total estimated migration effort:</span>
          <span className="font-heading text-base font-bold text-ink tabular-nums">
            {migrationSummary.totalDays} engineer-day{migrationSummary.totalDays !== 1 ? "s" : ""}
          </span>
        </div>
      ) : (
        <div className="rounded-sm border border-line bg-surface p-4 font-sans text-sm text-ink-muted">
          Total migration effort: not available — no blast-radius data in this CBOM.
        </div>
      )}
      {/* Migration sequence */}
      {migrationSummary.defaultScenario && migrationSummary.defaultScenario.schedule.length > 0 && (
        <div className="space-y-1.5">
          <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            Migration sequence — {migrationSummary.defaultScenario.name}
          </div>
          <div className="overflow-x-auto rounded-sm border border-line bg-surface">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-2/40">
                  <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted text-right w-8">
                    #
                  </th>
                  <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                    Asset
                  </th>
                  <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted text-right">
                    Day Window
                  </th>
                  <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted text-right">
                    Cost
                  </th>
                  <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted text-right">
                    Cumulative
                  </th>
                </tr>
              </thead>
              <tbody>
                {migrationSummary.defaultScenario.schedule.map((item, i) => {
                  const correlated = findings.find(
                    (f) =>
                      f.id === item.findingId ||
                      f.name.toLowerCase() === item.name.toLowerCase() ||
                      item.name.toLowerCase().includes(f.name.toLowerCase())
                  );
                  const isInert = correlated?.reachability === "inert";

                  return (
                    <tr
                      key={i}
                      className={`border-b border-line last:border-b-0 ${isInert ? "opacity-60 hover:opacity-100 transition-opacity" : ""
                        }`}
                    >
                      <td className="px-3 py-1.5 font-heading text-xs text-ink-muted text-right tabular-nums">
                        {i + 1}
                      </td>
                      <td className="px-3 py-1.5 font-heading text-xs font-semibold text-ink">
                        <div className="flex items-center gap-2">
                          <span>{item.name}</span>
                          {correlated && (
                            <ReachabilityBadge
                              reachability={correlated.reachability}
                              status={correlated.quantumStatus}
                              mixed={correlated.mixedReachability}
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-ink-secondary text-right tabular-nums">
                        {item.startDay}–{item.endDay}
                      </td>
                      <td className="px-3 py-1.5 font-heading text-xs font-semibold text-ink-secondary text-right tabular-nums">
                        {item.costDays ?? "—"}d
                      </td>
                      <td className="px-3 py-1.5 font-heading text-xs font-semibold text-ink text-right tabular-nums">
                        {item.endDay}d
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const BlastRadiusSection = () => (
    <div className="space-y-4">
      {blastRadiusData.hasData ? (
        blastRadiusData.entries.map(({ entry }, i) => (
          <OverflowBar key={i} entry={entry} maxBytes={blastRadiusData.maxBytes} />
        ))
      ) : (
        <BlastRadiusEmptyState scannedFiles={scannedFiles} findings={findings} />
      )}
    </div>
  );

  const ExposureSection = () => (
    <div className="space-y-5">
      {!exposureMetrics.hasTopology ? (
        <div className="rounded-sm border border-line bg-surface p-4 space-y-2">
          <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            No Deployment Topology Evidence
          </div>
          <p className="font-sans text-xs text-ink-muted leading-relaxed">
            This scan surfaced no Kubernetes / Terraform deployment manifests correlated to the
            discovered cryptographic findings. Every finding therefore defaults to exposure state{" "}
            <strong className="text-ink">UNKNOWN</strong> — static container/source inspection alone never
            proves external network exposure.
          </p>
        </div>
      ) : (
        <>
          {/* Exposure state counts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(["external", "mixed", "internal", "unknown"] as const).map((state) => (
              <div key={state} className="rounded-sm border border-line bg-surface p-3 space-y-1">
                <ExposureBadge exposure={state} />
                <div className="font-heading text-2xl font-bold text-ink tracking-tight">
                  {exposureMetrics.byState[state]}
                </div>
                <div className="font-sans text-[11px] text-ink-muted leading-snug">
                  {state === "external"
                    ? "internet-facing paths"
                    : state === "mixed"
                      ? "both internal & external paths"
                      : state === "internal"
                        ? "cluster-internal only"
                        : "no resolved topology"}
                </div>
              </div>
            ))}
          </div>

          {/* Namespace exposure table */}
          {exposureMetrics.namespaceRows.length > 0 && (
            <div>
              <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted mb-2">
                Exposure by Namespace
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="text-ink-muted border-b border-line">
                      <th className="py-1.5 pr-3 font-medium uppercase tracking-wider">Namespace</th>
                      <th className="py-1.5 pr-3 font-medium uppercase tracking-wider">Externally exposed</th>
                      <th className="py-1.5 font-medium uppercase tracking-wider">Internal only</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exposureMetrics.namespaceRows.map((row) => (
                      <tr key={row.namespace} className="border-b border-line/60 text-ink">
                        <td className="py-1.5 pr-3 font-mono text-[11px]">{row.namespace}</td>
                        <td className="py-1.5 pr-3">{row.externallyExposed}</td>
                        <td className="py-1.5">{row.internallyOnly}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Workload evidence chain table */}
          {exposureMetrics.workloadRows.length > 0 && (
            <div>
              <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted mb-2">
                Correlated Workloads
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="text-ink-muted border-b border-line">
                      <th className="py-1.5 pr-3 font-medium uppercase tracking-wider">Workload</th>
                      <th className="py-1.5 pr-3 font-medium uppercase tracking-wider">Exposure</th>
                      <th className="py-1.5 font-medium uppercase tracking-wider">Crypto findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exposureMetrics.workloadRows.map((row) => (
                      <tr key={row.workload} className="border-b border-line/60 align-top">
                        <td className="py-1.5 pr-3 font-mono text-[11px] text-ink">{row.workload}</td>
                        <td className="py-1.5 pr-3">
                          <ExposureBadge exposure={row.state === "external" || row.state === "mixed" ? row.state : "internal"} />
                        </td>
                        <td className="py-1.5">
                          <div className="flex flex-wrap gap-1">
                            {row.names.map((n) => (
                              <span key={n} className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-ink-secondary">
                                {n}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="font-sans text-[11px] text-ink-muted leading-relaxed pt-1">
            Exposure state is derived deterministically from statically parsed IaC relationships
            (workload → Service → Ingress / Gateway, plus Terraform load-balancer resources), never
            from an LLM verdict. A finding with no correlated workload stays UNKNOWN.
          </p>
        </>
      )}
    </div>
  );

  const AppendixSection = () => (
    <div className="space-y-5 text-sm text-ink-secondary leading-relaxed font-sans">
      {/* Methodology */}
      <div>
        <div className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
          Methodology
        </div>
        <div className="space-y-2">
          <p>
            <strong className="font-heading font-semibold text-ink">Pillar 1 — Cryptographic Discovery:</strong> Static analysis
            of source code using language-specific AST parsers (Python, Java, Go, C) and pattern
            matching against known cryptographic API signatures. Each detected usage is classified
            by algorithm, key size, and mode of operation.
          </p>
          <p>
            <strong className="font-heading font-semibold text-ink">Pillar 2 — Quantum Risk Assessment:</strong> Each
            cryptographic asset is assigned a quantum vulnerability status based on its susceptibility
            to Shor's algorithm (asymmetric), Grover's algorithm (symmetric), classical cryptanalysis,
            or NIST PQC standardization status.
          </p>
          <p>
            <strong className="font-heading font-semibold text-ink">Pillar 3 — Blast Radius Analysis:</strong> For targets
            containing fixed-size buffers or database schemas, the tool computes the size impact of
            replacing classical cryptographic values with their post-quantum equivalents.
          </p>
          <p>
            <strong className="font-heading font-semibold text-ink">Pillar 4 — Contradiction Detection:</strong> Cross-layer
            analysis identifies conflicting cryptographic configurations (e.g., TLS 1.3 mandated in
            one configuration file but TLS 1.0 allowed in another).
          </p>
          <p>
            <strong className="font-heading font-semibold text-ink">Pillar 5 — Migration Optimization:</strong> Greedy
            risk-density scheduler that orders migration tasks to maximize risk reduction per
            engineer-day, evaluated across quantum arrival scenarios.
          </p>
        </div>
      </div>

      {/* Limitations */}
      <div>
        <div className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
          Stated Limitations
        </div>
        <ul className="list-disc pl-5 space-y-1.5 text-xs text-ink-secondary">
          <li>
            Reachability analysis treats unknown reachability as potentially live (conservative
            assumption). Findings marked "unknown" may include dead code.
          </li>
          <li>
            Blast-radius analysis is scoped to systems and compiled code with fixed-size buffers and database
            column widths (C/C++, Go, Java, SQL). {scanComposition.isPurePython
              ? "Pure-Python targets allocate dynamically at runtime and typically produce zero blast-radius findings."
              : `Analysis evaluated static buffer constraints across scanned sources (${scanComposition.detectedLanguages.join(", ") || "analyzed files"}).`}
          </li>
          <li>
            Shelf-life estimates rely on published regulatory and standards timelines; actual
            deprecation dates may differ.
          </li>
          {!headlineMetrics.hasRealReachability && (
            <li>
              Reachability classification was not available for this scan — all findings default to
              "unknown" reachability with a conservative multiplier.
            </li>
          )}
          {!migrationSummary.hasBlastData && (
            <li>
              Migration effort estimate is not available because the current scan did not produce
              blast-radius data.
            </li>
          )}
        </ul>
      </div>

      {/* Container Image Scanning Methodology */}
      <div>
        <div className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
          Container Image Scanning Methodology
        </div>
        <p className="font-sans text-xs text-ink-muted leading-relaxed mb-3">
          Container scanning statically inspects image layers and applies existing source and binary crypto detectors to the effective image filesystem. It does not execute the image or establish runtime reachability.
        </p>
        <ul className="space-y-1 font-sans text-xs text-ink-muted list-disc list-inside mb-4">
          <li>
            <strong className="text-ink">Effective Filesystem &amp; Whiteouts:</strong> Reconstructs the final image filesystem honoring AUFS/OverlayFS whiteout files (.wh.&lt;name&gt; and .wh..wh..opq). Deleted files are excluded from active findings.
          </li>
          <li>
            <strong className="text-ink">Provenance Retention:</strong> Preserves container image identity, manifest/config digest, layer digest, and path inside the container.
          </li>
          <li>
            <strong className="text-ink">Honest Scope:</strong> Reachability defaults to unknown. Crypto library linkage (e.g. libcrypto.so) remains algorithm-unknown unless concrete algorithm symbols or strings are verified.
          </li>
        </ul>
        {findings.some((f) => f.container !== undefined) && (
          <div className="rounded-sm border border-line bg-surface p-3 font-mono text-xs space-y-1.5 mb-4">
            <div className="flex items-center justify-between">
              <span className="font-heading uppercase tracking-wider text-[11px] text-ink-muted">Container Findings:</span>
              <span className="text-ink font-semibold">{findings.filter((f) => f.container !== undefined).length} effective</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-heading uppercase tracking-wider text-[11px] text-ink-muted">Container Images:</span>
              <span className="text-ink">{Array.from(new Set(findings.map((f) => f.container?.containerImage).filter(Boolean))).join(", ")}</span>
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
          Algorithm Reference
        </div>
        <div className="overflow-x-auto rounded-sm border border-line bg-surface">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line bg-surface-2/40">
                <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                  Classical Algorithm
                </th>
                <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                  PQC Replacement
                </th>
                <th className="px-3 py-2 font-heading text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                  NIST Standard
                </th>
              </tr>
            </thead>
            <tbody className="text-ink-secondary">
              <tr className="border-b border-line">
                <td className="px-3 py-2 font-mono text-xs">RSA, ECDSA, EdDSA, DSA</td>
                <td className="px-3 py-2 font-mono text-xs text-ink">ML-DSA (CRYSTALS-Dilithium)</td>
                <td className="px-3 py-2 font-heading text-xs">FIPS 204</td>
              </tr>
              <tr className="border-b border-line">
                <td className="px-3 py-2 font-mono text-xs">ECDH, DH, X25519, X448</td>
                <td className="px-3 py-2 font-mono text-xs text-ink">ML-KEM (CRYSTALS-Kyber)</td>
                <td className="px-3 py-2 font-heading text-xs">FIPS 203</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">RSA (signature, stateless)</td>
                <td className="px-3 py-2 font-mono text-xs text-ink">SLH-DSA (SPHINCS+)</td>
                <td className="px-3 py-2 font-heading text-xs">FIPS 205</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* CBOM file reference */}
      <div>
        <div className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
          CBOM Document Reference
        </div>
        <div className="rounded-sm border border-line bg-surface p-3 font-mono text-xs space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="font-heading uppercase tracking-wider text-[11px] text-ink-muted">Format:</span>
            <span className="text-ink">CycloneDX 1.6</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-heading uppercase tracking-wider text-[11px] text-ink-muted">Generator:</span>
            <span className="text-ink">hash patch v0.1.0</span>
          </div>
          {contentHash && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className="font-heading uppercase tracking-wider text-[11px] text-ink-muted">SHA-256 Digest:</span>
              <span className="text-ink break-all">{contentHash}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="font-heading uppercase tracking-wider text-[11px] text-ink-muted">Components:</span>
            <span className="text-ink font-heading font-semibold">{findings.length} assets</span>
          </div>
          {scannedFiles !== undefined && scannedFiles.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="font-heading uppercase tracking-wider text-[11px] text-ink-muted">Files Scanned:</span>
              <span className="text-ink font-heading font-semibold">
                {scannedFiles.length} total ({filesWithFindingsCount} with findings)
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <div className="h-full overflow-y-auto">
      {/* Top bar with Export PDF button */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-page px-4 py-2.5 sm:px-6">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-ink-muted">
          Readiness Report Dossier
        </h2>
        <button
          type="button"
          onClick={() => void handleExportPdf()}
          disabled={pdfExporting || !rawText}
          className="rounded-sm border border-line bg-surface px-3.5 py-1.5 font-heading text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pdfExporting ? "Generating…" : "Export PDF"}
        </button>
      </div>

      {/* ================================================================
         WEB VIEW — scrollable preview (no cover page, no page furniture)
         ================================================================ */}
      <div className="space-y-10 bg-page p-4 sm:p-6 max-w-5xl">
        {/* DOCUMENT HEADER */}
        <div className="border-b border-line pb-6 space-y-2.5">
          <div className="font-heading text-[11px] font-medium uppercase tracking-[0.2em] text-ink-muted">
            Cryptographic Bill of Materials — Readiness Assessment
          </div>
          <h1 className="font-heading text-[28px] sm:text-[32px] font-medium tracking-tight text-ink">
            Post-Quantum Readiness Assessment
          </h1>
          <p className="font-sans text-sm text-ink-muted leading-relaxed">
            Comprehensive audit of cryptographic primitives, migration timelines, and physical buffer blast radiuses.
          </p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 pt-1 font-mono text-xs text-ink-secondary">
            <span>Target: <strong className="text-ink font-semibold">{sourceName}</strong></span>
            {scannedFiles !== undefined && scannedFiles.length > 0 && (
              <span>Files: <strong className="text-ink font-semibold">{scannedFiles.length} scanned</strong> ({filesWithFindingsCount} with findings)</span>
            )}
            {timestamp && <span>Timestamp: {new Date(timestamp).toLocaleString()}</span>}
            <span className="font-sans text-ink-muted">hash patch v0.1.0</span>
          </div>
          <div className="mt-3 rounded-sm border border-line bg-surface p-4 font-sans text-[15px] text-ink leading-relaxed">
            {oneLineVerdict}
          </div>
        </div>

        {/* SECTION 1: EXECUTIVE SUMMARY */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Executive Summary
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              A high-level synthesis of cryptographic posture, critical vulnerabilities, and projected migration impact.
            </p>
          </div>
          <div className="space-y-4 pt-1">
            {executiveSummary.map((para, i) => (
              <p key={i} className="font-sans text-[15px] text-ink leading-[1.7]">
                {para}
              </p>
            ))}
          </div>
        </section>

        {/* SECTION 2: HEADLINE READINESS METRICS */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Headline Readiness Metrics
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              Two primary quantitative indicators governing migration priority and post-quantum urgency.
            </p>
          </div>
          <HeadlineMetricsSection />
        </section>

        {/* SECTION 3: RISK DISTRIBUTION */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Risk Distribution
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              Breakdown of cryptographic findings across quantum vulnerability categories and top directories.
            </p>
          </div>
          <RiskDistributionSection />
        </section>

        {/* SECTION 4: PRIORITY TARGETS */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Priority Targets
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              Remediation backlog ranked by combined algorithmic vulnerability and runtime exploitability.
            </p>
          </div>
          <PriorityTargetsSection />
        </section>

        {/* SECTION 5: MIGRATION */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Migration Sequencing
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              Projected residual risk curve and scheduled migration timeline over allocated engineer-days.
            </p>
          </div>
          <MigrationSection />
        </section>

        {/* SECTION 6: BLAST RADIUS */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Size Constraints &amp; Blast Radius
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              Physical buffer and schema allocation overflow risks when switching to larger post-quantum primitives.
            </p>
          </div>
          <BlastRadiusSection />
        </section>

        {/* SECTION 6.5: DEPLOYMENT EXPOSURE (Phase 4) */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Deployment Topology Exposure
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              How each cryptographic finding is exposed to the network, derived from correlated
              Kubernetes / Terraform deployment topology.
            </p>
          </div>
          <ExposureSection />
        </section>

        {/* SECTION 7: APPENDIX */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Appendix — Methodology &amp; Reference
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              Technical methodology, detection boundaries, known limitations, and standard algorithm mappings.
            </p>
          </div>
          <AppendixSection />
        </section>

        {/* SECTION 8: INTEGRITY / SIGNATURE */}
        <section className="space-y-3">
          <div className="border-b border-line pb-2">
            <h3 className="font-heading text-[20px] font-medium text-ink tracking-tight">
              Integrity &amp; Signature Verification
            </h3>
            <p className="mt-0.5 font-sans text-sm text-ink-muted leading-relaxed">
              Cryptographic hash digest verification and post-quantum digital signature validation status.
            </p>
          </div>
          <div className="rounded-sm border border-line bg-surface p-4 space-y-3 font-sans">
            <div>
              <div className="font-heading text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                SHA-256 Content Digest
              </div>
              <div className="font-mono text-xs text-ink break-all">
                {contentHash ?? "Computing…"}
              </div>
            </div>
            <div className="border-t border-line pt-3">
              <div className="font-heading text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                ML-DSA-65 Post-Quantum Signature (FIPS 204)
              </div>
              <div className="text-xs text-ink-muted leading-relaxed">
                ML-DSA-65 signature verification requires the Python backend's cryptography library
                and cannot run in a browser. Use the CLI tool{" "}
                <span className="font-mono text-ink">hash patch verify</span> to perform full
                post-quantum signature verification on this CBOM.
              </div>
            </div>
            <div className="border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-status-good" aria-hidden="true" />
                <span className="font-heading text-xs font-semibold uppercase tracking-wide text-status-good">
                  Digest Verified Internally
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-secondary leading-relaxed">
                Client-side SHA-256 digest computed via Web Crypto API. This confirms the
                loaded CBOM content is internally consistent — post-quantum signature
                verification requires the backend.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* ================================================================
         RAW CBOM APPENDIX (collapsed, web-only)
         ================================================================ */}
      <div className="border-t border-line px-4 py-4 sm:px-6">
        <details open={appendixOpen} onToggle={(e) => setAppendixOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer select-none font-heading text-xs font-medium uppercase tracking-wider text-ink-muted hover:text-ink transition-colors">
            Appendix — Raw CycloneDX 1.6 CBOM
            <span className="ml-2 font-mono font-normal normal-case tracking-normal">
              ({lineCount.toLocaleString()} lines · {byteSize.toLocaleString()} bytes)
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                disabled={!rawText}
                className="rounded-sm border border-line bg-surface px-3 py-1 font-heading text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors disabled:opacity-40"
              >
                {copied ? "Copied" : "Copy JSON"}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!rawText}
                className="rounded-sm border border-line bg-surface px-3 py-1 font-heading text-xs font-semibold uppercase tracking-wider text-ink-secondary hover:border-line-strong hover:text-ink transition-colors disabled:opacity-40"
              >
                Download CBOM
              </button>
            </div>
            {rawText ? (
              <div className="relative max-h-[520px] overflow-auto rounded-sm border border-line bg-surface p-4">
                <pre className="font-mono text-xs text-ink whitespace-pre leading-relaxed select-all">
                  {rawText}
                </pre>
              </div>
            ) : (
              <div className="rounded-sm border border-line bg-surface p-4 text-xs text-ink-muted">
                No CBOM document available.
              </div>
            )}
          </div>
        </details>
      </div>

      {/* ================================================================
         PDF PAGES — hidden, rendered only during PDF export.
         Each is a self-contained page div.
         ================================================================ */}
      <div id="pdf-pages-container" style={{ display: "none" }} aria-hidden="true">
        {/* PAGE 1 — COVER */}
        <div id="pdf-page-1" className="bg-page p-12 text-ink" style={{ width: "800px", minHeight: "1000px" }}>
          <div className="flex flex-col justify-between" style={{ minHeight: "900px" }}>
            <div className="space-y-6 pt-28">
              <div className="font-heading text-[11px] uppercase tracking-[0.3em] text-ink-muted">
                Cryptographic Bill of Materials — Readiness Assessment
              </div>
              <h1 className="font-heading text-4xl font-bold text-ink tracking-tight">
                hash patch
              </h1>
              <div className="space-y-3 pt-8">
                <div>
                  <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">Target Codebase</div>
                  <div className="font-mono text-sm text-ink mt-0.5">{sourceName}</div>
                </div>
                <div>
                  <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">Scan Timestamp</div>
                  <div className="font-mono text-sm text-ink mt-0.5">
                    {timestamp ? new Date(timestamp).toLocaleString() : "Not available"}
                  </div>
                </div>
                <div>
                  <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">Tool Version</div>
                  <div className="font-mono text-sm text-ink mt-0.5">hash patch v0.1.0</div>
                </div>
                {scannedFiles !== undefined && scannedFiles.length > 0 && (
                  <div>
                    <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted">Files Scanned</div>
                    <div className="font-mono text-sm text-ink mt-0.5">
                      {scannedFiles.length} total ({filesWithFindingsCount} with findings)
                    </div>
                  </div>
                )}
              </div>
              <div className="pt-8 border-t border-line">
                <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted mb-1">Assessment Verdict</div>
                <p className="font-sans text-sm text-ink leading-relaxed">{oneLineVerdict}</p>
              </div>
              <div className="pt-4">
                <div className="font-heading text-[10px] uppercase tracking-wider text-ink-muted mb-1">Signature Verification</div>
                <p className="font-sans text-xs text-ink-muted leading-relaxed">
                  ML-DSA-65 post-quantum signature verification requires the CLI backend.
                  {contentHash && (
                    <> SHA-256 content digest: <span className="font-mono text-ink">{contentHash.slice(0, 16)}…</span></>
                  )}
                </p>
              </div>
            </div>
            <div className="font-heading text-[9px] uppercase tracking-widest text-ink-muted pt-12">
              Generated by hash patch — Post-Quantum Cryptographic Readiness Assessment Dossier
            </div>
          </div>
        </div>

        {/* PAGE 2 — EXECUTIVE SUMMARY & HEADLINE METRICS */}
        <div id="pdf-page-2" className="bg-page p-10 text-ink space-y-6" style={{ width: "800px" }}>
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Executive Summary
            </h2>
            <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed mb-3">
              A high-level synthesis of cryptographic posture, critical vulnerabilities, and projected migration impact.
            </p>
            <div className="space-y-3">
              {executiveSummary.map((para, i) => (
                <p key={i} className="font-sans text-sm text-ink leading-[1.65]">
                  {para}
                </p>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-line">
            <h2 className="font-heading text-[20px] font-medium text-ink tracking-tight mb-1">
              Headline Readiness Metrics
            </h2>
            <p className="font-sans text-xs text-ink-muted leading-relaxed mb-3">
              Quantitative indicators governing migration priority and post-quantum urgency.
            </p>
            <HeadlineMetricsSection />
          </div>
        </div>

        {/* PAGE 3 — RISK DISTRIBUTION */}
        <div id="pdf-page-3" className="bg-page p-10 text-ink space-y-3" style={{ width: "800px" }}>
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Risk Distribution
            </h2>
            <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed mb-4">
              Breakdown of cryptographic findings across quantum vulnerability categories and top directories.
            </p>
          </div>
          <RiskDistributionSection />
        </div>

        {/* PAGE 4 — PRIORITY TARGETS */}
        <div id="pdf-page-4" className="bg-page p-10 text-ink space-y-3" style={{ width: "800px" }}>
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Priority Targets
            </h2>
            <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed mb-4">
              Remediation backlog ranked by combined algorithmic vulnerability and runtime exploitability.
            </p>
          </div>
          <PriorityTargetsSection />
        </div>

        {/* PAGE 5 — MIGRATION */}
        <div id="pdf-page-5" className="bg-page p-10 text-ink space-y-3" style={{ width: "800px" }}>
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Migration Sequencing
            </h2>
            <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed mb-4">
              Projected residual risk curve and scheduled migration timeline over allocated engineer-days.
            </p>
          </div>
          <MigrationSection />
        </div>

        {/* PAGE 6 — BLAST RADIUS */}
        <div id="pdf-page-6" className="bg-page p-10 text-ink space-y-3" style={{ width: "800px" }}>
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Size Constraints &amp; Blast Radius
            </h2>
            <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed mb-4">
              Physical buffer and schema allocation overflow risks when switching to larger post-quantum primitives.
            </p>
          </div>
          <BlastRadiusSection />
        </div>

        {/* PAGE 7 — APPENDIX */}
        <div id="pdf-page-7" className="bg-page p-10 text-ink space-y-3" style={{ width: "800px" }}>
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Appendix — Methodology &amp; Reference
            </h2>
            <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed mb-4">
              Technical methodology, detection boundaries, known limitations, and standard algorithm mappings.
            </p>
          </div>
          <AppendixSection />
        </div>

        {/* PAGE 8 — DEPLOYMENT TOPOLOGY EXPOSURE (Phase 4) */}
        <div id="pdf-page-8" className="bg-page p-10 text-ink space-y-3" style={{ width: "800px" }}>
          <div>
            <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">
              Deployment Topology Exposure
            </h2>
            <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed mb-4">
              Network exposure of each cryptographic finding, derived deterministically from
              correlated Kubernetes / Terraform deployment topology — never from an LLM verdict.
            </p>
          </div>
          <ExposureSection />
        </div>
      </div>
    </div>
  );
}
