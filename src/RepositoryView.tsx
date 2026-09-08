import { useMemo, useState } from "react";
import { displayName, type EvidenceOccurrence, type Finding, type ExposureState } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { compareFindingsPriority, computePriorityScore } from "./priority";
import { buildRepositoryTree, normalizeLocation, type TreeNode } from "./repositoryTree";
import { FileCodeView } from "./FileCodeView";

interface RepositoryViewProps {
  sourceName: string;
  findings: Finding[];
  scannedFiles?: string[];
}

/**
 * Filter evidence occurrences to those strictly inside the folder subtree,
 * keyed by full normalized path (not by basename).
 */
function getEvidenceInSubtree(
  evidence: EvidenceOccurrence[],
  node: TreeNode,
  targetRoot: string
): EvidenceOccurrence[] {
  if (!node.path) {
    return evidence;
  }
  const cleanNodePath = node.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();

  return evidence.filter((occ) => {
    if (!occ.locator) return false;
    const cleanLoc = occ.locator.replace(/\\/g, "/").toLowerCase();
    const normRel = normalizeLocation(occ.locator, targetRoot).toLowerCase();
    if (normRel === cleanNodePath || normRel.startsWith(cleanNodePath + "/")) {
      return true;
    }
    if (cleanLoc.includes("/" + cleanNodePath + "/") || cleanLoc.endsWith("/" + cleanNodePath)) {
      return true;
    }
    return false;
  });
}

/**
 * Proportional stacked severity bar using the four semantic risk colors:
 * - broken-by-shor: red (bg-status-critical)
 * - broken-classically: neutral gray (bg-status-neutral-fg)
 * - weakened-by-grover: amber (bg-status-warning)
 * - quantum-safe: green (bg-status-good)
 */
function SeverityBar({
  counts,
  total,
}: {
  counts: { shor: number; classic: number; grover: number; safe: number };
  total: number;
}) {
  if (total === 0) {
    return <div className="h-1.5 w-14 rounded-full bg-line/60" aria-hidden="true" />;
  }

  const shorPct = (counts.shor / total) * 100;
  const classicPct = (counts.classic / total) * 100;
  const groverPct = (counts.grover / total) * 100;
  const safePct = (counts.safe / total) * 100;

  return (
    <div
      className="flex h-1.5 w-14 overflow-hidden rounded-full bg-surface-2"
      title={`Shor: ${counts.shor} · Classic: ${counts.classic} · Grover: ${counts.grover} · Safe: ${counts.safe}`}
    >
      {shorPct > 0 && <div style={{ width: `${shorPct}%` }} className="h-full bg-status-critical" />}
      {classicPct > 0 && <div style={{ width: `${classicPct}%` }} className="h-full bg-status-neutral-fg" />}
      {groverPct > 0 && <div style={{ width: `${groverPct}%` }} className="h-full bg-status-warning" />}
      {safePct > 0 && <div style={{ width: `${safePct}%` }} className="h-full bg-status-good" />}
    </div>
  );
}

/** Most severe exposure state among a set of findings (external > mixed >
 * internal > unknown), driving folder-level exposure summaries. */
function subtreeExposure(findings: Finding[]): ExposureState | undefined {
  const rank: Record<ExposureState, number> = { external: 3, mixed: 2, internal: 1, unknown: 0 };
  let best: ExposureState | undefined = undefined;
  for (const f of findings) {
    const state = f.exposureState ?? "unknown";
    if (best === undefined || rank[state] > rank[best]) best = state;
  }
  return best;
}

/** Count of findings in each exposure state. */
function exposureCounts(findings: Finding[]): Record<ExposureState, number> {
  const counts: Record<ExposureState, number> = { external: 0, mixed: 0, internal: 0, unknown: 0 };
  for (const f of findings) counts[f.exposureState ?? "unknown"] += 1;
  return counts;
}

function getRiskBadge(counts: TreeNode["counts"], total: number) {
  if (total === 0) {
    return (
      <span className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded font-mono text-[10px] text-ink-muted/50 bg-surface-2/60 border border-line/40">
        0
      </span>
    );
  }

  let colorClass = "bg-status-good/15 text-status-good border-status-good/30";
  if (counts.shor > 0) {
    colorClass = "bg-status-critical/15 text-status-critical border-status-critical/30";
  } else if (counts.classic > 0) {
    colorClass = "bg-status-neutral-fg/15 text-status-neutral-fg border-status-neutral-fg/30";
  } else if (counts.grover > 0) {
    colorClass = "bg-status-warning/15 text-status-warning border-status-warning/30";
  }

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border ${colorClass}`}
    >
      {total}
    </span>
  );
}

function isNodeVisible(
  node: TreeNode,
  term: string,
  onlyFindings: boolean,
  ancestorMatched: boolean
): boolean {
  if (onlyFindings && node.totalFindings === 0) {
    return false;
  }
  if (!term) {
    return true;
  }
  const cleanTerm = term.toLowerCase().trim().replace(/\\/g, "/");
  const termNoTrailingSlash = cleanTerm.replace(/\/+$/, "");
  const cleanPath = node.path.toLowerCase().replace(/\\/g, "/");
  const cleanFullPath = node.fullPath.toLowerCase().replace(/\\/g, "/");
  const cleanName = node.name.toLowerCase();

  const selfMatches =
    ancestorMatched ||
    cleanPath === termNoTrailingSlash ||
    cleanPath.startsWith(termNoTrailingSlash + "/") ||
    cleanPath.startsWith(cleanTerm) ||
    cleanPath.includes(cleanTerm) ||
    cleanFullPath.includes(cleanTerm) ||
    cleanName.includes(cleanTerm);

  if (selfMatches) {
    return true;
  }

  if (node.isFolder) {
    return node.children.some((child) =>
      isNodeVisible(child, term, onlyFindings, false)
    );
  }

  return false;
}

export function RepositoryView({ sourceName, findings, scannedFiles }: RepositoryViewProps) {
  const tree = useMemo(
    () => buildRepositoryTree(findings, sourceName, scannedFiles),
    [findings, sourceName, scannedFiles]
  );

  const [pathFilter, setPathFilter] = useState("");
  const [showOnlyFindings, setShowOnlyFindings] = useState(false);

  // Collapsed by default to depth 1: root (depth 0) expanded, its depth-1 children collapsed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set([tree.id]));
  const [selectedNode, setSelectedNode] = useState<TreeNode>(tree);

  const toggleExpand = (node: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return next;
    });
  };

  const handleSelectNode = (node: TreeNode) => {
    setSelectedNode(node);
    if (node.isFolder) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(node.id);
        return next;
      });
    }
  };

  // Find path of nodes leading to selectedNode for the breadcrumb
  const breadcrumbNodes = useMemo(() => {
    const chain: TreeNode[] = [];
    function findChain(curr: TreeNode, targetId: string): boolean {
      chain.push(curr);
      if (curr.id === targetId) return true;
      for (const child of curr.children) {
        if (findChain(child, targetId)) return true;
      }
      chain.pop();
      return false;
    }
    findChain(tree, selectedNode.id);
    return chain.length > 0 ? chain : [tree];
  }, [tree, selectedNode]);

  // Findings in selected node filtered strictly to this subtree's evidence
  const visibleFindingsWithEvidence = useMemo(() => {
    const list = selectedNode.isFolder ? selectedNode.allFindings : selectedNode.findings;
    const sorted = [...list].sort(compareFindingsPriority);
    return sorted
      .map((f) => {
        const evList = selectedNode.isFolder
          ? getEvidenceInSubtree(f.evidence, selectedNode, sourceName)
          : f.evidence.filter((occ) => {
              if (!occ.locator) return false;
              const cleanLoc = occ.locator.replace(/\\/g, "/").toLowerCase();
              const cleanPath = selectedNode.path.replace(/\\/g, "/").toLowerCase();
              return cleanLoc.endsWith("/" + cleanPath) || cleanLoc === cleanPath;
            });
        return {
          finding: f,
          evidence: evList,
        };
      })
      .filter((item) => item.evidence.length > 0 || !selectedNode.isFolder || selectedNode.path === "");
  }, [selectedNode, sourceName]);

  // Recursive flat rendering of visible tree nodes
  function renderTreeNode(node: TreeNode, ancestorMatched: boolean = false): React.ReactNode {
    if (!isNodeVisible(node, pathFilter, showOnlyFindings, ancestorMatched)) {
      return null;
    }

    const cleanTerm = pathFilter.toLowerCase().trim().replace(/\\/g, "/");
    const termNoTrailingSlash = cleanTerm.replace(/\/+$/, "");
    const cleanPath = node.path.toLowerCase().replace(/\\/g, "/");
    const cleanFullPath = node.fullPath.toLowerCase().replace(/\\/g, "/");
    const cleanName = node.name.toLowerCase();
    const selfMatched =
      ancestorMatched ||
      (Boolean(cleanTerm) &&
        (cleanPath === termNoTrailingSlash ||
          cleanPath.startsWith(termNoTrailingSlash + "/") ||
          cleanPath.startsWith(cleanTerm) ||
          cleanPath.includes(cleanTerm) ||
          cleanFullPath.includes(cleanTerm) ||
          cleanName.includes(cleanTerm)));

    const isExpanded = pathFilter.trim() !== "" || expandedIds.has(node.id);
    const isSelected = selectedNode.id === node.id;
    const isDimmed = node.totalFindings === 0;

    return (
      <div key={node.id} className="select-none">
        <div
          onClick={() => handleSelectNode(node)}
          style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
          className={`flex items-center gap-2 py-1 pr-3 text-xs transition-colors cursor-pointer border-l-2 ${
            isSelected
              ? "border-ink bg-surface-2 font-semibold text-ink"
              : "border-transparent text-ink-secondary hover:bg-surface-2/60 hover:text-ink font-normal"
          } ${isDimmed ? "opacity-50" : ""}`}
        >
          {/* Expand / collapse chevron */}
          {node.isFolder ? (
            <button
              type="button"
              onClick={(e) => toggleExpand(node, e)}
              className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-muted hover:text-ink"
              aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
            >
              <svg
                className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}

          {/* Folder / File Icon */}
          {node.isFolder ? (
            <svg
              className="h-3.5 w-3.5 shrink-0 text-ink-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          ) : node.findings.some((f) => f.findingType === "COMPILED_CRYPTO_ARTEFACT") ? (
            <span
              className="shrink-0 font-mono text-[9px] font-bold text-indigo-400 bg-indigo-950 px-1 py-0.5 rounded-xs border border-indigo-700/50"
              title="Compiled Binary"
            >
              01
            </span>
          ) : (
            <svg
              className="h-3.5 w-3.5 shrink-0 text-ink-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          )}

          {/* Node name */}
          <span className="truncate font-mono text-xs">{node.name}</span>

          {/* Spacer */}
          <span className="flex-1" />

          {/* Severity bar & finding count badge */}
          <div className="flex shrink-0 items-center gap-2">
            <SeverityBar counts={node.counts} total={node.totalFindings} />
            {getRiskBadge(node.counts, node.totalFindings)}
          </div>
        </div>

        {/* Recursive render children if expanded */}
        {node.isFolder && isExpanded && node.children.map((child) => renderTreeNode(child, selfMatched))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-page text-ink">
      {/* TOP: Single-line Monospace Breadcrumb */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-4 font-mono text-xs text-ink-muted overflow-x-auto whitespace-nowrap">
        {breadcrumbNodes.map((item, idx) => {
          const isLast = idx === breadcrumbNodes.length - 1;
          return (
            <div key={item.id} className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => handleSelectNode(item)}
                className={`transition-colors underline-offset-2 ${
                  isLast ? "text-ink font-semibold" : "text-ink-secondary hover:text-ink hover:underline"
                }`}
              >
                {item.name}
              </button>
              {!isLast && <span className="text-line-strong">/</span>}
            </div>
          );
        })}
      </div>

      {/* SPLIT CONTENT: Tree View on Left, Code Viewer / Folder Summary on Right */}
      <div className="flex min-h-0 flex-1 divide-x divide-line overflow-hidden">
        {/* LEFT PANE: Hierarchical Drill-Down Tree with Controls */}
        <div className="flex w-1/2 min-w-[320px] max-w-[520px] flex-col overflow-hidden bg-surface/40">
          {/* Controls: Search input & All vs Findings-only toggle */}
          <div className="shrink-0 border-b border-line bg-surface/70 p-2.5 space-y-2">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                placeholder="Filter path (e.g. internal/generated/)..."
                className="w-full rounded-sm border border-line bg-page pl-8 pr-7 py-1 font-mono text-xs text-ink placeholder:text-ink-muted/50 focus:border-ink focus:outline-none transition-colors"
              />
              {pathFilter && (
                <button
                  type="button"
                  onClick={() => setPathFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center text-ink-muted hover:text-ink text-xs"
                  aria-label="Clear filter"
                >
                  ×
                </button>
              )}
            </div>

            <div className="flex rounded-sm border border-line p-0.5 text-xs bg-page font-heading">
              <button
                type="button"
                onClick={() => setShowOnlyFindings(false)}
                className={`flex-1 rounded-sm py-1 px-2 text-center text-[11px] font-medium transition-colors ${
                  !showOnlyFindings
                    ? "bg-surface text-ink shadow-xs font-semibold"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Show all scanned files
              </button>
              <button
                type="button"
                onClick={() => setShowOnlyFindings(true)}
                className={`flex-1 rounded-sm py-1 px-2 text-center text-[11px] font-medium transition-colors ${
                  showOnlyFindings
                    ? "bg-surface text-ink shadow-xs font-semibold"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                Only files with findings
              </button>
            </div>
          </div>

          {/* Tree list */}
          <div className="flex-1 overflow-y-auto py-2">
            {renderTreeNode(tree)}
          </div>
        </div>

        {/* RIGHT PANE: FileCodeView for files, or Folder Summary for folders */}
        <div className="flex-1 overflow-hidden bg-page">
          {!selectedNode.isFolder ? (
            <FileCodeView
              node={selectedNode}
              findings={selectedNode.findings}
              sourceName={sourceName}
            />
          ) : (
            <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-4">
              {/* Header / Target Details */}
              <div className="border-b border-line pb-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-heading text-[20px] font-medium text-ink tracking-tight">
                      Folder: {selectedNode.name}
                    </h2>
                    <p className="mt-0.5 font-sans text-xs text-ink-muted leading-relaxed">
                      Cryptographic asset distribution and worst-case quantum vulnerability for this directory subtree.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 font-heading">
                    <SeverityBar counts={selectedNode.counts} total={selectedNode.totalFindings} />
                    <span className="text-xs font-semibold text-ink tabular-nums">
                      {selectedNode.counts.references > 0 && selectedNode.counts.operations > 0
                        ? `${selectedNode.counts.operations} operation${selectedNode.counts.operations === 1 ? "" : "s"} · ${selectedNode.counts.references} reference${selectedNode.counts.references === 1 ? "" : "s"}`
                        : selectedNode.counts.references > 0
                        ? `${selectedNode.counts.references} crypto reference${selectedNode.counts.references === 1 ? "" : "s"}`
                        : `${selectedNode.totalFindings} finding${selectedNode.totalFindings === 1 ? "" : "s"}`}
                    </span>
                  </div>
                </div>

                <div className="truncate font-mono text-xs text-ink-secondary" title={selectedNode.fullPath}>
                  {selectedNode.fullPath || selectedNode.path}
                </div>

                {/* Severity Breakdown Strip */}
                {selectedNode.totalFindings > 0 && (
                  <div className="flex flex-wrap items-center gap-3 pt-1 font-heading text-xs text-ink-muted">
                    <span className="text-status-critical font-semibold">
                      {selectedNode.counts.shor} Shor
                    </span>
                    <span>•</span>
                    <span className="text-status-neutral-fg font-semibold">
                      {selectedNode.counts.classic} Classic
                    </span>
                    <span>•</span>
                    <span className="text-status-warning font-semibold">
                      {selectedNode.counts.grover} Grover
                    </span>
                    <span>•</span>
                    <span className="text-status-good font-semibold">
                      {selectedNode.counts.safe} Safe
                    </span>
                    {selectedNode.counts.cloudKms > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-status-opaque font-semibold">
                          {selectedNode.counts.cloudKms} Cloud KMS
                        </span>
                      </>
                    )}
                    {selectedNode.counts.binaryCrypto > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-indigo-400 font-semibold">
                          {selectedNode.counts.binaryCrypto} Binary Crypto
                        </span>
                      </>
                    )}
                    {selectedNode.priorityScore > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-ink font-semibold">
                          Max Priority: {selectedNode.priorityScore}
                        </span>
                      </>
                    )}

                    {/* Phase 4: Deployment exposure summary for the subtree */}
                    {(() => {
                      const ec = exposureCounts(selectedNode.allFindings);
                      const best = subtreeExposure(selectedNode.allFindings);
                      return (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1.5">
                            <ExposureBadge exposure={best} />
                            <span className="text-ink-muted font-normal">
                              {ec.external + ec.mixed > 0
                                ? `${ec.external + ec.mixed} exposed · ${ec.internal} internal · ${ec.unknown} unknown`
                                : `${ec.external} ext · ${ec.internal} int · ${ec.unknown} unk`}
                            </span>
                          </span>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>

              {/* Content: Findings List in selected folder */}
              {selectedNode.totalFindings === 0 ? (
                <div className="rounded-sm border border-line bg-surface p-6 text-center space-y-1">
                  <p className="font-heading text-base font-medium text-ink">Zero findings in this directory</p>
                  <p className="font-sans text-sm text-ink-muted leading-relaxed">
                    Present in the filesystem hierarchy for structural context, but no cryptographic assets were detected in this path.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between font-heading text-xs uppercase tracking-wider text-ink-muted pb-1">
                    <span>
                      Findings in subtree (sorted by priority model):
                    </span>
                    <span className="font-mono lowercase tracking-normal">
                      {visibleFindingsWithEvidence.length} assets
                    </span>
                  </div>

                  <div className="space-y-2">
                    {visibleFindingsWithEvidence.map(({ finding, evidence }) => {
                      const isReference = finding.findingType === "CRYPTO_REFERENCE";
                      const isCertificate =
                        finding.findingType === "CERTIFICATE" || finding.findingType === "CERTIFICATE_UNPARSEABLE";
                      const isCloudKey = finding.findingType === "CLOUD_KEY_OPERATION";
                      const priority = computePriorityScore(finding);
                      const isInert = finding.reachability === "inert";

                      return (
                        <div
                          key={finding.id}
                          className={`rounded-sm border border-line bg-surface p-3 space-y-2 transition-colors hover:border-line-strong ${
                            isInert ? "opacity-60 hover:opacity-100 transition-opacity" : ""
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-ink">{displayName(finding)}</span>
                              {isReference && (
                                <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                                  Reference
                                </span>
                              )}
                              {isCertificate && (
                                <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                                  Certificate
                                </span>
                              )}
                              {isCloudKey && (
                                <>
                                  <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-status-opaque text-white border border-line">
                                    Cloud KMS
                                  </span>
                                  {finding.cloudKey?.operation && (
                                    <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                                      {finding.cloudKey.operation}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>

                            {/* A CRYPTO_REFERENCE has no real-world
                                exploitability — it never carries a priority
                                score, quantum-status badge, or reachability
                                badge on the same scale as a genuine
                                operation. The "Reference" tag above is its
                                only status indicator. A CERTIFICATE finding
                                keeps its real priority score and quantum
                                badge (an RSA-2048 cert is genuinely
                                broken-by-shor) but never a reachability
                                badge — a certificate file is never "called"
                                from code. */}
                            {!isReference && (
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-secondary border border-line">
                                  Score: {priority}
                                </span>
                                <QuantumStatusBadge status={finding.quantumStatus} />
                                {!isCertificate && (
                                  <ReachabilityBadge
                                    reachability={finding.reachability}
                                    status={finding.quantumStatus}
                                    mixed={finding.mixedReachability}
                                  />
                                )}
                                <ExposureBadge exposure={finding.exposureState} />
                              </div>
                            )}
                          </div>

                          {evidence.map((occ, evIdx) => {
                            const rel = occ.locator ? normalizeLocation(occ.locator, sourceName) : "unlocated";
                            return (
                              <div key={evIdx} className="space-y-1">
                                <div className="flex items-center justify-between font-mono text-xs text-ink-secondary">
                                  <span>
                                    {rel}
                                    {occ.line !== undefined && <span className="text-ink-muted">:{occ.line}</span>}
                                  </span>
                                  {occ.reachability && (
                                    <ReachabilityBadge reachability={occ.reachability} status={finding.quantumStatus} />
                                  )}
                                </div>
                                {occ.snippet && (
                                  <pre className="overflow-x-auto rounded-sm bg-page p-2 font-mono text-xs text-ink-secondary border border-line/60 whitespace-pre">
                                    {occ.snippet}
                                  </pre>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
