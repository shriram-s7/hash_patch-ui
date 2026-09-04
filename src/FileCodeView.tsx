import { useEffect, useMemo, useRef, useState } from "react";
import type { Finding, ShelfLifeEntry } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { compareFindingsPriority } from "./priority";
import { getRecommendationForFinding, type PqcRecommendation } from "./pqcRecommendations";
import type { TreeNode } from "./repositoryTree";
import { ShelfLifeModal } from "./ShelfLifeModal";
import { IssuesDrawer } from "./IssuesDrawer";

/** The ShelfLifeEntry backing a finding's longest shelf-life value, or
 * undefined if the finding has no shelf-life data at all. */
function longestShelfLifeEntry(finding: Finding): ShelfLifeEntry | undefined {
  if (finding.longestShelfLifeYears === undefined) return undefined;
  return finding.shelfLife.find((s) => s.shelfLifeYears === finding.longestShelfLifeYears);
}

interface FileCodeViewProps {
  node: TreeNode;
  findings: Finding[];
  sourceName?: string;
}

export function FileCodeView({ node, findings, sourceName }: FileCodeViewProps) {
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sort findings by unified priority score comparator (highest risk first)
  const sortedFindings = useMemo(() => {
    return [...findings].sort(compareFindingsPriority);
  }, [findings]);

  const [selectedFindingIndex, setSelectedFindingIndex] = useState(0);
  const selectedFinding = sortedFindings[selectedFindingIndex] ?? sortedFindings[0];

  // "All Issues" slide-over drawer (replaces the old horizontally-scrolling
  // chip strip): open/closed only, content is always a stacked-card list.
  const [issuesDrawerOpen, setIssuesDrawerOpen] = useState(false);

  // Tooltip state for gutter hover
  const [hoveredFinding, setHoveredFinding] = useState<{
    finding: Finding;
    x: number;
    y: number;
  } | null>(null);

  // Copy patch state per finding id
  const [copiedPatchId, setCopiedPatchId] = useState<string | null>(null);

  // Shelf-life "show calculation" modal state
  const [shelfLifeModal, setShelfLifeModal] = useState<{ assetName: string; entry: ShelfLifeEntry } | undefined>(
    undefined
  );

  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Load actual file content with multi-candidate path resolution
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const candidates = getCandidateFileUrls(node, sourceName);

    async function fetchSource() {
      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;

          const contentType = res.headers.get("content-type") || "";
          // Reject Vite SPA fallback if content-type is text/html for non-html files
          if (contentType.includes("text/html") && !url.toLowerCase().endsWith(".html")) {
            continue;
          }

          const text = await res.text();
          // Detect SPA index.html fallback
          if (text.includes("<!doctype html") || text.includes('<div id="root">')) {
            continue;
          }

          if (active) {
            setSourceCode(text);
            setLoading(false);
          }
          return;
        } catch {
          // try next candidate
        }
      }

      // If all candidates fail, reconstruct source around evidence occurrences
      if (active) {
        const reconstructed = reconstructSourceFromEvidence(node.name, findings);
        setSourceCode(reconstructed);
        setLoading(false);
      }
    }

    void fetchSource();

    return () => {
      active = false;
    };
  }, [node, findings, sourceName]);

  // Scroll code viewer to selected finding's line
  useEffect(() => {
    if (!selectedFinding) return;
    const occ = getFindingOccurrenceInFile(selectedFinding, node);
    const targetLine = occ?.line;
    if (targetLine !== undefined) {
      const el = lineRefs.current.get(targetLine);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [selectedFinding, node]);

  // Map lines to findings for gutter markers (only occurrences strictly inside this file)
  const lineToFindings = useMemo(() => {
    const map = new Map<number, Finding[]>();
    for (const f of findings) {
      for (const occ of f.evidence) {
        if (!isOccurrenceInFile(occ.locator, node)) continue;
        if (occ.line !== undefined) {
          const list = map.get(occ.line) ?? [];
          list.push(f);
          map.set(occ.line, list);
        }
      }
    }
    return map;
  }, [findings, node]);

  // Lines of code
  const lines = useMemo(() => {
    if (sourceCode === null) return [];
    return sourceCode.split(/\r?\n/);
  }, [sourceCode]);

  // Next / Previous navigation handlers
  const handlePrevFinding = () => {
    if (sortedFindings.length === 0) return;
    setSelectedFindingIndex((prev) => (prev > 0 ? prev - 1 : sortedFindings.length - 1));
  };

  const handleNextFinding = () => {
    if (sortedFindings.length === 0) return;
    setSelectedFindingIndex((prev) => (prev < sortedFindings.length - 1 ? prev + 1 : 0));
  };

  // Pre-calculate recommendations for all findings in this file
  const recommendations = useMemo(() => {
    const map = new Map<string, { finding: Finding; rec: PqcRecommendation; lineText: string }>();
    for (const f of sortedFindings) {
      const occ = getFindingOccurrenceInFile(f, node);
      const lineNum = occ?.line;
      const lineText =
        lineNum !== undefined && lines[lineNum - 1] !== undefined
          ? lines[lineNum - 1]
          : occ?.snippet ?? f.evidence[0]?.snippet ?? "";
      map.set(f.id, {
        finding: f,
        rec: getRecommendationForFinding(f, lineText),
        lineText,
      });
    }
    return map;
  }, [sortedFindings, lines, node]);

  const handleCopyPatch = (findingId: string, replacementCode: string) => {
    const onSuccess = () => {
      setCopiedPatchId(findingId);
      setTimeout(() => setCopiedPatchId(null), 2000);
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(replacementCode)
        .then(onSuccess)
        .catch(() => {
          fallbackCopyText(replacementCode);
          onSuccess();
        });
    } else {
      fallbackCopyText(replacementCode);
      onSuccess();
    }
  };

  const selectedItem = selectedFinding ? recommendations.get(selectedFinding.id) : null;

  // Cards for the "All Issues" slide-over drawer — reuses the same
  // per-finding line/excerpt data already computed for the fix-preview.
  const issuesDrawerItems = useMemo(
    () =>
      sortedFindings.map((finding) => {
        const occ = getFindingOccurrenceInFile(finding, node);
        const item = recommendations.get(finding.id);
        return { finding, line: occ?.line, excerpt: item?.lineText ?? occ?.snippet ?? "" };
      }),
    [sortedFindings, recommendations, node]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-page text-ink">
      {/* 1. TOP BAR: Navigation Controls & Finding Counter */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-surface px-4">
        {/* File name and breadcrumb title */}
        <div className="flex items-center gap-2 truncate font-mono text-xs">
          <span className="font-semibold text-ink">{node.name}</span>
          <span className="text-ink-muted/50">•</span>
          <span className="text-ink-secondary truncate">{node.fullPath || node.path}</span>
        </div>

        {/* Priority-Ordered Triage Navigation */}
        <div className="flex items-center gap-3">
          <span className="font-heading text-xs text-ink-muted">
            Finding{" "}
            <span className="font-semibold text-ink tabular-nums">
              {sortedFindings.length > 0 ? selectedFindingIndex + 1 : 0}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-ink tabular-nums">{sortedFindings.length}</span>
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevFinding}
              disabled={sortedFindings.length <= 1}
              aria-label="Previous finding by priority"
              className="rounded-sm border border-line bg-page px-2.5 py-1 font-heading text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={handleNextFinding}
              disabled={sortedFindings.length <= 1}
              aria-label="Next finding by priority"
              className="rounded-sm border border-line bg-page px-2.5 py-1 font-heading text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* 2. MAIN SPLIT: Code Viewer (Top 55-60%) + Fix Preview Drawer (Bottom 40-45%) */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* CODE VIEWER */}
        <div className="relative min-h-0 flex-1 overflow-auto bg-surface/30 font-mono text-xs">
          {loading ? (
            <div className="flex h-full items-center justify-center p-8 text-ink-muted">
              Loading source code...
            </div>
          ) : error ? (
            <div className="p-6 text-status-critical">{error}</div>
          ) : (
            <div className="min-w-full inline-block py-2">
              {lines.map((codeLine, idx) => {
                const lineNum = idx + 1;
                const findingsOnLine = lineToFindings.get(lineNum);
                const occ = selectedFinding ? getFindingOccurrenceInFile(selectedFinding, node) : null;
                const isSelectedLine = occ?.line === lineNum;
                const primaryFinding = findingsOnLine?.[0];

                return (
                  <div
                    key={lineNum}
                    ref={(el) => {
                      if (el) lineRefs.current.set(lineNum, el);
                      else lineRefs.current.delete(lineNum);
                    }}
                    onClick={() => {
                      if (primaryFinding) {
                        const newIdx = sortedFindings.findIndex((f) => f.id === primaryFinding.id);
                        if (newIdx !== -1) setSelectedFindingIndex(newIdx);
                      }
                    }}
                    className={`group flex items-start leading-5 transition-colors ${
                      isSelectedLine
                        ? "bg-surface-2 font-semibold border-l-2 border-ink"
                        : "hover:bg-surface-2/40 border-l-2 border-transparent"
                    }`}
                  >
                    {/* GUTTER: Risk Marker */}
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                      {primaryFinding && (
                        <div
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredFinding({
                              finding: primaryFinding,
                              x: rect.right + 8,
                              y: rect.top,
                            });
                          }}
                          onMouseLeave={() => setHoveredFinding(null)}
                          className={`h-2.5 w-2.5 rounded-full cursor-pointer transition-transform hover:scale-125 ${
                            primaryFinding.quantumStatus === "broken-by-shor"
                              ? "bg-status-critical"
                              : primaryFinding.quantumStatus === "broken-classically"
                              ? "bg-status-neutral-fg"
                              : primaryFinding.quantumStatus === "weakened-by-grover"
                              ? "bg-status-warning"
                              : "bg-status-good"
                          }`}
                          aria-label={`Finding: ${primaryFinding.name}`}
                        />
                      )}
                    </div>

                    {/* LINE NUMBER (Neutral Grayscale) */}
                    <div className="w-11 shrink-0 select-none pr-3 text-right text-ink-muted/50">
                      {lineNum}
                    </div>

                    {/* CODE LINE (Neutral Grayscale Syntax) */}
                    <div className="min-w-0 flex-1 whitespace-pre pr-4 text-ink">
                      {renderNeutralSyntax(codeLine)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. FIX PREVIEW DRAWER (focused finding; "All Issues" opens the slide-over instead) */}
        {sortedFindings.length > 0 && (
          <div className="flex h-72 shrink-0 flex-col border-t border-line bg-surface">
            {/* Drawer Header with Tabs */}
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
              <div className="flex items-center gap-2 text-xs overflow-x-auto">
                <span className="font-heading font-medium text-[11px] uppercase tracking-wider text-ink-muted shrink-0">
                  Issues &amp; Fix Previews:
                </span>
                <button
                  type="button"
                  onClick={() => setIssuesDrawerOpen(true)}
                  className="flex shrink-0 items-center gap-1 rounded-sm border border-line px-2 py-0.5 font-mono text-[11px] text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
                >
                  <span aria-hidden="true">▤</span> All Issues ({sortedFindings.length})
                </button>

                {sortedFindings.map((f, i) => {
                  const isSelected = selectedFinding?.id === f.id;
                  const line = f.evidence[0]?.line;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFindingIndex(i)}
                      className={`flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-[11px] transition-colors shrink-0 ${
                        isSelected
                          ? "border border-ink bg-surface-2 font-semibold text-ink"
                          : "border border-line text-ink-muted hover:text-ink"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          f.quantumStatus === "broken-by-shor"
                            ? "bg-status-critical"
                            : f.quantumStatus === "broken-classically"
                            ? "bg-status-neutral-fg"
                            : f.quantumStatus === "weakened-by-grover"
                            ? "bg-status-warning"
                            : "bg-status-good"
                        }`}
                      />
                      <span>#{i + 1} {f.name}</span>
                      {line !== undefined && <span className="opacity-70">:{line}</span>}
                    </button>
                  );
                })}
              </div>

              {/* Reference figures badge */}
              <span className="hidden sm:inline-block shrink-0 rounded-sm border border-line bg-page px-2 py-0.5 font-mono text-[11px] text-ink-muted">
                Reference figures · Not measured on this system yet
              </span>
            </div>

            {/* Content: focused finding's fix preview */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {selectedItem ? (
                <div className="p-2 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span className="font-semibold text-ink">
                        #{selectedFindingIndex + 1} {selectedFinding.name}
                      </span>
                      {selectedFinding.evidence[0]?.line !== undefined && (
                        <span className="rounded-sm bg-surface px-1.5 py-0.5 border border-line text-ink-secondary">
                          Line {selectedFinding.evidence[0].line}
                        </span>
                      )}
                      <QuantumStatusBadge status={selectedFinding.quantumStatus} />
                      <ReachabilityBadge reachability={selectedFinding.reachability} status={selectedFinding.quantumStatus} />
                      {selectedFinding.longestShelfLifeYears !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            const entry = longestShelfLifeEntry(selectedFinding);
                            if (entry) setShelfLifeModal({ assetName: selectedFinding.name, entry });
                          }}
                          className="rounded-sm border border-line bg-page px-1.5 py-0.5 text-ink-secondary underline decoration-dotted underline-offset-2 hover:border-line-strong hover:text-ink hover:decoration-solid transition-colors"
                          aria-label={`Show shelf-life calculation for ${selectedFinding.name}`}
                        >
                          Shelf-life: {selectedFinding.longestShelfLifeYears}y
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopyPatch(selectedFinding.id, selectedItem.rec.replacementCode)}
                      className="rounded-sm border border-line bg-page px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors"
                    >
                      {copiedPatchId === selectedFinding.id ? "Copied!" : "Copy Patch"}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1 font-mono">
                      <div className="text-[11px] uppercase tracking-wider text-ink-muted">
                        Vulnerable Source
                      </div>
                      <pre className="rounded-sm border border-line bg-page p-2 text-ink whitespace-pre-wrap">
                        {selectedItem.lineText}
                      </pre>
                      <p className="text-[11px] text-ink-muted">{selectedItem.rec.vulnerabilityReason}</p>
                    </div>

                    <div className="space-y-1 font-mono">
                      <div className="text-[11px] uppercase tracking-wider text-ink-muted flex items-center justify-between">
                        <span>Proposed Replacement</span>
                        <span className="text-status-good font-semibold">
                          {selectedItem.rec.recommendedAlgorithm}
                        </span>
                      </div>
                      <pre className="rounded-sm border border-line bg-surface p-2 text-ink whitespace-pre-wrap">
                        {selectedItem.rec.replacementCode}
                      </pre>
                      <p className="text-[11px] text-ink-secondary">{selectedItem.rec.migrationNote}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Floating Tooltip on Gutter Marker Hover */}
      {hoveredFinding && (
        <div
          style={{
            position: "fixed",
            left: `${hoveredFinding.x}px`,
            top: `${hoveredFinding.y}px`,
            zIndex: 50,
          }}
          className="pointer-events-none w-72 rounded-sm border border-line-strong bg-surface p-2.5 shadow-xl font-mono text-xs text-ink space-y-1.5"
        >
          <div className="flex items-center justify-between gap-1">
            <span className="font-semibold text-ink">{hoveredFinding.finding.name}</span>
            <QuantumStatusBadge status={hoveredFinding.finding.quantumStatus} />
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span>Reachability:</span>
            <ReachabilityBadge
              reachability={hoveredFinding.finding.reachability}
              status={hoveredFinding.finding.quantumStatus}
            />
          </div>

          <p className="text-[11px] text-ink-muted leading-snug">
            {hoveredFinding.finding.quantumStatus === "broken-by-shor"
              ? "Broken by Shor's algorithm — polynomial-time discrete log / factorization enables full key recovery."
              : hoveredFinding.finding.quantumStatus === "broken-classically"
              ? "Broken classically — susceptible to collision or practical cryptanalytic attacks under conventional compute."
              : hoveredFinding.finding.quantumStatus === "weakened-by-grover"
              ? "Weakened by Grover's algorithm — quantum search space effectively halved."
              : "Quantum-safe cryptographic primitive."}
          </p>
        </div>
      )}

      {shelfLifeModal && (
        <ShelfLifeModal
          assetName={shelfLifeModal.assetName}
          entry={shelfLifeModal.entry}
          onClose={() => setShelfLifeModal(undefined)}
        />
      )}

      {issuesDrawerOpen && (
        <IssuesDrawer
          items={issuesDrawerItems}
          selectedId={selectedFinding?.id}
          onSelect={(findingId) => {
            const idx = sortedFindings.findIndex((f) => f.id === findingId);
            if (idx !== -1) setSelectedFindingIndex(idx);
            setIssuesDrawerOpen(false);
          }}
          onClose={() => setIssuesDrawerOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Checks if an evidence occurrence belongs to the current file node.
 * Prevents line numbers from other files leaking into this file's gutter.
 */
function isOccurrenceInFile(locator: string | undefined, node: TreeNode): boolean {
  if (!locator) return false;
  const cleanLoc = locator.replace(/\\/g, "/").toLowerCase();
  const cleanName = node.name.toLowerCase();
  const cleanPath = node.path.replace(/\\/g, "/").toLowerCase();

  // The locator must end with this file's name
  if (!cleanLoc.endsWith("/" + cleanName) && cleanLoc !== cleanName) {
    return false;
  }

  // If node.path has parent directories, verify the full path matches
  if (cleanPath.includes("/")) {
    if (!cleanLoc.endsWith("/" + cleanPath) && cleanLoc !== cleanPath) {
      return false;
    }
  }

  return true;
}

/**
 * Returns the occurrence of this finding that matches the current file, or fallback to first occurrence.
 */
function getFindingOccurrenceInFile(finding: Finding, node: TreeNode) {
  const matching = finding.evidence.find((occ) => isOccurrenceInFile(occ.locator, node));
  return matching ?? finding.evidence[0];
}

/**
 * Returns candidate URLs for fetching source code from Vite's /@fs/ endpoint.
 * Handles both absolute paths and relative project paths (e.g. testdata/python/...).
 */
function getCandidateFileUrls(node: TreeNode, sourceName?: string): string[] {
  const rawPath = node.fullPath || node.path;
  const cleanRaw = rawPath.replace(/\\/g, "/");
  const cleanName = node.path.replace(/\\/g, "/").replace(/^\/+/, "");

  const candidates: string[] = [];

  // If already absolute with Windows drive letter (e.g. D:/CBOM-SIH/...)
  if (/^[A-Za-z]:\//i.test(cleanRaw)) {
    candidates.push(`/@fs/${cleanRaw}`);
  }

  // If sourceName is provided and is an absolute path
  if (sourceName) {
    const cleanSource = sourceName.replace(/\\/g, "/").replace(/\/+$/, "");
    if (/^[A-Za-z]:\//i.test(cleanSource)) {
      candidates.push(`/@fs/${cleanSource}/${cleanName}`);
      candidates.push(`/@fs/${cleanSource}/${cleanRaw.replace(/^\/+/, "")}`);
      const folderName = cleanSource.split("/").pop();
      if (folderName && cleanName.startsWith(folderName + "/")) {
        candidates.push(`/@fs/${cleanSource}/${cleanName.slice(folderName.length + 1)}`);
      }
    }
  }

  // Strip leading slashes and relative prefixes
  const relPath = cleanRaw.replace(/^(\.\.\/|\.\/)+/, "").replace(/^\/+/, "");

  // Candidate repository directories
  candidates.push(`/@fs/D:/CBOM-SIH/hash_patch/${relPath}`);
  candidates.push(`/@fs/D:/CBOM-SIH/hash_patch/${cleanName}`);
  candidates.push(`/@fs/D:/CBOM-SIH/eval-target/${relPath}`);
  candidates.push(`/@fs/D:/CBOM-SIH/eval-target/${cleanName}`);
  candidates.push(`/@fs/D:/CBOM-SIH/${relPath}`);
  candidates.push(`/@fs/D:/CBOM-SIH/${cleanName}`);

  return [...new Set(candidates)];
}

/**
 * Fallback source reconstruction when file is not available on disk.
 * Places snippets at their reported line numbers so gutter markers line up.
 */
function reconstructSourceFromEvidence(fileName: string, findings: Finding[]): string {
  const lineMap = new Map<number, string>();
  let maxLine = 1;

  for (const f of findings) {
    for (const occ of f.evidence) {
      if (occ.line !== undefined) {
        maxLine = Math.max(maxLine, occ.line);
        lineMap.set(occ.line, occ.snippet || `// ${f.name} detected at line ${occ.line}`);
      }
    }
  }

  const generated: string[] = [];
  for (let i = 1; i <= Math.max(maxLine, 20); i++) {
    if (lineMap.has(i)) {
      generated.push(lineMap.get(i)!);
    } else if (i === 1) {
      generated.push(`// Offline preview for: ${fileName}`);
    } else {
      generated.push("");
    }
  }

  return generated.join("\n");
}

function renderNeutralSyntax(line: string) {
  if (!line) return " ";

  // Comment check (# or //)
  const commentMatch = /(#.*|\/\/.*)/.exec(line);
  if (commentMatch && commentMatch.index !== undefined) {
    const before = line.slice(0, commentMatch.index);
    const comment = commentMatch[0];
    return (
      <>
        {renderNeutralTokens(before)}
        <span className="text-ink-muted italic">{comment}</span>
      </>
    );
  }

  return renderNeutralTokens(line);
}

const KEYWORD_REGEX =
  /\b(import|from|as|def|return|class|if|elif|else|for|while|in|try|except|finally|with|assert|const|let|var|function|async|await|package|type|struct|func|public|private|static|void|int|char|bool)\b/g;

function renderNeutralTokens(text: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = KEYWORD_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={match.index} className="font-semibold text-ink">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function fallbackCopyText(text: string) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand("copy");
  } catch {
    // ignore
  }
  document.body.removeChild(textArea);
}
