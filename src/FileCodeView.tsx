import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, type Finding, type ShelfLifeEntry } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { compareFindingsPriority } from "./priority";
import { getRecommendationForFinding, type PqcRecommendation } from "./pqcRecommendations";
import type { TreeNode } from "./repositoryTree";
import { ShelfLifeModal } from "./ShelfLifeModal";
import { IssuesDrawer } from "./IssuesDrawer";
import { SERVICE_BASE_URL } from "./serviceUrl";

/** The ShelfLifeEntry backing a finding's longest shelf-life value, or
 * undefined if the finding has no shelf-life data at all. */
function longestShelfLifeEntry(finding: Finding): ShelfLifeEntry | undefined {
  if (finding.longestShelfLifeYears === undefined) return undefined;
  return finding.shelfLife.find((s) => s.shelfLifeYears === finding.longestShelfLifeYears);
}

/** A CRYPTO_REFERENCE (a string literal that merely looks like an algorithm
 * name, never passed as an argument to any crypto API call) has no
 * real-world exploitability — no severity color, quantum-status badge,
 * reachability badge, or migration patch should ever be shown for one. Same
 * rule already applied in RepositoryView.tsx / FindingsTable.tsx / ReportView.tsx. */
function isReferenceFinding(f: Finding): boolean {
  return f.findingType === "CRYPTO_REFERENCE";
}

/** A certificate finding (hash_patch/detect/certificates.py) is not
 * executable code — it has no reachability (nothing "calls" a certificate
 * file) and no source line to patch, so it gets the same "no reachability
 * badge, no Copy Patch" treatment as a CRYPTO_REFERENCE, but keeps its real
 * quantum-status severity (an RSA-2048 cert genuinely is broken-by-shor,
 * unlike a reference literal). See DetailPanel.tsx's identical rule. */
function isCertificateFinding(f: Finding): boolean {
  return f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE";
}

/** A cloud KMS/HSM client call (hash_patch/detect/cloud_kms/) is a real
 * operation call site (reachability applies) but the algorithm is managed
 * by the provider — there is nothing local at the call site to patch, so it
 * gets the same "no Copy Patch" treatment as a reference/certificate, with
 * honest client-call-only framing in place of a proposed replacement. */
function isCloudKeyFinding(f: Finding): boolean {
  return f.findingType === "CLOUD_KEY_OPERATION";
}

/** A compiled binary finding (hash_patch/detect/binary/) is observed in an
 * ELF/PE/Mach-O binary — not source code, so it gets the same "no Copy Patch"
 * treatment, with honest static-binary framing in place of source diffs. */
function isBinaryFinding(f: Finding): boolean {
  return f.findingType === "COMPILED_CRYPTO_ARTEFACT";
}

/** Severity dot color for gutter markers and the issue tab strip — neutral
 * gray for a reference (it never carries real severity), opaque-violet for a
 * cloud KMS/HSM client call (deliberately NOT on the red/amber/green quantum
 * verdict scale), else colored by quantum status as before. */
function severityDotClass(f: Finding): string {
  if (isReferenceFinding(f)) return "bg-ink-muted";
  if (isCloudKeyFinding(f)) return "bg-status-opaque";
  if (isBinaryFinding(f)) {
    if (f.quantumStatus === "broken-by-shor") return "bg-status-critical";
    if (f.quantumStatus === "broken-classically") return "bg-status-neutral-fg";
    if (f.quantumStatus === "weakened-by-grover") return "bg-status-warning";
    return "bg-indigo-400";
  }
  if (f.quantumStatus === "broken-by-shor") return "bg-status-critical";
  if (f.quantumStatus === "broken-classically") return "bg-status-neutral-fg";
  if (f.quantumStatus === "weakened-by-grover") return "bg-status-warning";
  return "bg-status-good";
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
  // True when sourceCode is the synthetic finding-context reconstruction
  // rather than real file content (the backend was unreachable, this file
  // isn't under the scanned root, or no scan root is known at all — e.g. a
  // CBOM loaded from an uploaded file rather than a live scan).
  const [sourceIsFallback, setSourceIsFallback] = useState(false);

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

  // Load actual file content from the local analysis engine
  // (GET /api/file-content, hash_patch/service.py) — falls back to a
  // synthetic finding-context reconstruction only when that fetch actually
  // fails (backend unreachable, file outside the scanned root, or no scan
  // root known at all, e.g. a CBOM loaded from an uploaded file).
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function fetchSource() {
      if (findings.some(isBinaryFinding)) {
        if (active) {
          setSourceCode(null);
          setSourceIsFallback(false);
          setLoading(false);
        }
        return;
      }

      const filePath = findRealFilePathForNode(node, findings);

      if (sourceName && filePath) {
        try {
          const url = `${SERVICE_BASE_URL}/api/file-content?path=${encodeURIComponent(filePath)}&root=${encodeURIComponent(sourceName)}`;
          const res = await fetch(url);
          if (res.ok) {
            const body = (await res.json()) as { content: string };
            if (active) {
              setSourceCode(body.content);
              setSourceIsFallback(false);
              setLoading(false);
            }
            return;
          }
        } catch {
          // backend unreachable — fall through to the synthetic reconstruction below
        }
      }

      // Real content unavailable: reconstruct source around evidence
      // occurrences so gutter markers still line up, clearly labeled as a
      // fallback rather than presented as real content.
      if (active) {
        const reconstructed = reconstructSourceFromEvidence(node.name, findings);
        setSourceCode(reconstructed);
        setSourceIsFallback(true);
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
          {findings.some(isBinaryFinding) ? (
            <div className="p-6 space-y-4 max-w-2xl font-mono text-xs">
              <div className="rounded-sm border border-indigo-700/40 bg-indigo-950/20 p-3 leading-relaxed">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-heading font-semibold text-sm text-indigo-300">
                    Compiled Binary Artifact
                  </span>
                  <span className="rounded-sm border border-indigo-700/50 bg-indigo-900/60 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200 uppercase">
                    {selectedFinding?.binaryCrypto?.binaryFormat ?? "Binary"}
                  </span>
                </div>
                <p className="text-ink-secondary text-xs leading-relaxed">
                  Static binary inspection only. Raw executable machine code is not editable text.
                  Source-level patches cannot be applied directly to compiled binaries.
                </p>
              </div>

              <div className="rounded-sm border border-line bg-surface p-3 space-y-2">
                <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                  Binary Artifact Inspection
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-ink-muted">Binary Format: </span>
                    <span className="font-semibold text-ink">{selectedFinding?.binaryCrypto?.binaryFormat ?? "ELF / PE / Mach-O"}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">Architecture: </span>
                    <span className="font-semibold text-ink">{selectedFinding?.binaryCrypto?.architecture ?? "Unknown"}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">Observed Findings: </span>
                    <span className="font-semibold text-ink">{findings.length} findings</span>
                  </div>
                  <div>
                    <span className="text-ink-muted">Verification Scope: </span>
                    <span className="font-semibold text-ink">{selectedFinding?.binaryCrypto?.verificationScope ?? "static_binary_observation"}</span>
                  </div>
                  {selectedFinding?.container && (
                    <>
                      <div>
                        <span className="text-ink-muted">Container Image: </span>
                        <span className="font-semibold text-teal-300">{selectedFinding.container.containerImage}</span>
                      </div>
                      <div>
                        <span className="text-ink-muted">Layer Digest: </span>
                        <span className="font-mono text-[11px] text-ink">{selectedFinding.container.layerDigest?.slice(0, 19)}...</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-sm border border-line bg-surface p-3 space-y-2">
                <div className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                  Discovered Cryptographic Evidence ({findings.length})
                </div>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {sortedFindings.map((bf, idx) => (
                    <div
                      key={bf.id}
                      onClick={() => setSelectedFindingIndex(idx)}
                      className={`cursor-pointer rounded-sm border p-2 text-xs transition-colors ${
                        selectedFindingIndex === idx
                          ? "border-indigo-500 bg-indigo-950/30 text-ink"
                          : "border-line bg-page hover:border-line-strong text-ink-secondary"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{displayName(bf)}</span>
                        <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                          {bf.binaryCrypto?.evidenceType?.replace("_", " ") ?? "evidence"}
                        </span>
                      </div>
                      <div className="text-[11px] text-ink-muted mt-1 truncate">
                        Observed: {bf.binaryCrypto?.observedValue ?? bf.name}
                        {bf.binaryCrypto?.library ? ` • Library: ${bf.binaryCrypto.library}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center p-8 text-ink-muted">
              Loading source code...
            </div>
          ) : error ? (
            <div className="p-6 text-status-critical">{error}</div>
          ) : (
            <div className="min-w-full inline-block py-2">
              {sourceIsFallback && (
                <div className="sticky top-0 z-10 mb-2 border-b border-line bg-status-warning/10 px-3 py-1.5 font-mono text-[11px] text-status-warning-fg">
                  Source unavailable — showing finding context only (not the real file content).
                </div>
              )}
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
                          className={`h-2.5 w-2.5 rounded-full cursor-pointer transition-transform hover:scale-125 ${severityDotClass(
                            primaryFinding
                          )}`}
                          aria-label={`Finding: ${displayName(primaryFinding)}`}
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
                      <span className={`h-1.5 w-1.5 rounded-full ${severityDotClass(f)}`} />
                      <span>#{i + 1} {displayName(f)}</span>
                      {isReferenceFinding(f) && <span className="opacity-70">(ref)</span>}
                      {isCertificateFinding(f) && <span className="opacity-70">(cert)</span>}
                      {isCloudKeyFinding(f) && <span className="opacity-70">(cloud)</span>}
                      {isBinaryFinding(f) && <span className="opacity-70">(binary)</span>}
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
                        #{selectedFindingIndex + 1} {displayName(selectedFinding)}
                      </span>
                      {selectedFinding.evidence[0]?.line !== undefined && (
                        <span className="rounded-sm bg-surface px-1.5 py-0.5 border border-line text-ink-secondary">
                          Line {selectedFinding.evidence[0].line}
                        </span>
                      )}
                      {isReferenceFinding(selectedFinding) ? (
                        <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                          Reference
                        </span>
                      ) : isCertificateFinding(selectedFinding) ? (
                        <>
                          <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                            Certificate
                          </span>
                          <QuantumStatusBadge status={selectedFinding.quantumStatus} />
                        </>
                      ) : isCloudKeyFinding(selectedFinding) ? (
                        <>
                          <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-status-opaque text-white border border-line">
                            Cloud KMS
                          </span>
                          <QuantumStatusBadge status={selectedFinding.quantumStatus} />
                          <ReachabilityBadge reachability={selectedFinding.reachability} status={selectedFinding.quantumStatus} />
                        </>
                      ) : isBinaryFinding(selectedFinding) ? (
                        <>
                          <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                            Compiled Binary
                          </span>
                          {selectedFinding.binaryCrypto?.evidenceType && (
                            <span className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line capitalize">
                              {selectedFinding.binaryCrypto.evidenceType.replace("_", " ")}
                            </span>
                          )}
                          <QuantumStatusBadge status={selectedFinding.quantumStatus} />
                        </>
                      ) : (
                        <>
                          <QuantumStatusBadge status={selectedFinding.quantumStatus} />
                          <ReachabilityBadge reachability={selectedFinding.reachability} status={selectedFinding.quantumStatus} />
                        </>
                      )}
                      <ExposureBadge exposure={selectedFinding.exposureState} />
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

                    {/* A CRYPTO_REFERENCE has nothing to migrate — there is
                        no crypto call site, so no patch can be proposed. A
                        CERTIFICATE finding is a parsed file, not a source
                        call site, so there is likewise no patch to propose. A
                        CLOUD_KEY_OPERATION has a real call site, but the
                        algorithm is provider-managed — there is nothing local
                        at the call site to patch either. A COMPILED_CRYPTO_ARTEFACT
                        is a compiled binary artifact, so no source code patch is available. */}
                    {!isReferenceFinding(selectedFinding) &&
                      !isCertificateFinding(selectedFinding) &&
                      !isCloudKeyFinding(selectedFinding) &&
                      !isBinaryFinding(selectedFinding) && (
                      <button
                        type="button"
                        onClick={() => handleCopyPatch(selectedFinding.id, selectedItem.rec.replacementCode)}
                        className="rounded-sm border border-line bg-page px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors"
                      >
                        {copiedPatchId === selectedFinding.id ? "Copied!" : "Copy Patch"}
                      </button>
                    )}
                  </div>

                  {isReferenceFinding(selectedFinding) ? (
                    <p className="p-1 font-mono text-[11px] text-ink-muted leading-relaxed">
                      String literal reference — not an executed cryptographic operation. This
                      text matches a known algorithm/cipher-suite name but is never passed as an
                      argument to a crypto API call anywhere in the scanned source, so there is
                      no live call site and no migration guidance to offer.
                    </p>
                  ) : isCertificateFinding(selectedFinding) ? (
                    selectedFinding.findingType === "CERTIFICATE_UNPARSEABLE" ? (
                      <p className="p-1 font-mono text-[11px] text-ink-muted leading-relaxed">
                        {selectedFinding.certificate?.error ?? "Certificate file found but could not be parsed."}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-1 font-mono text-[11px] text-ink">
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Subject</div>
                          <div className="break-all">{selectedFinding.certificate?.subject}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Issuer</div>
                          <div className="break-all">{selectedFinding.certificate?.issuer}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Signature algorithm</div>
                          <div className="break-all">{selectedFinding.certificate?.signatureAlgorithm}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Validity</div>
                          <div>
                            {selectedFinding.certificate?.notBefore} → {selectedFinding.certificate?.notAfter}
                            {selectedFinding.certificate?.expired ? " (expired)" : ""}
                          </div>
                        </div>
                      </div>
                    )
                  ) : isCloudKeyFinding(selectedFinding) ? (
                    <div className="space-y-2 p-1">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11px] text-ink">
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Provider</div>
                          <div className="break-all">{selectedFinding.cloudKey?.provider ?? "—"}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">SDK</div>
                          <div className="break-all">{selectedFinding.cloudKey?.sdk ?? "—"}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Operation</div>
                          <div className="break-all">{selectedFinding.cloudKey?.operation ?? "—"}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Verification scope</div>
                          <div className="break-all">{selectedFinding.cloudKey?.verificationScope ?? "—"}</div>
                        </div>
                      </div>
                      <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
                        Cloud-managed key usage call — proves this code invokes a cloud KMS/HSM
                        client, not what the provider does server-side. A static scanner cannot see
                        the provider's key algorithm or rotation policy, so no quantum-risk verdict
                        and no local code patch is offered; validate the key's configuration in the
                        provider console/IaC instead.
                      </p>
                    </div>
                  ) : isBinaryFinding(selectedFinding) ? (
                    <div className="space-y-2 p-1">
                      <div className="rounded-sm border border-indigo-700/40 bg-indigo-950/20 p-2 font-mono text-xs leading-relaxed">
                        <div className="font-semibold text-indigo-300 mb-1">
                          Static Binary Evidence — Runtime Execution is Not Verified
                        </div>
                        <div className="text-ink-secondary text-[11px]">
                          {selectedFinding.binaryCrypto?.honestFraming ??
                            "Static binary analysis observes this cryptographic artifact, but does not independently establish runtime execution."}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono text-[11px] text-ink">
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Binary format</div>
                          <div className="break-all">{selectedFinding.binaryCrypto?.binaryFormat ?? "—"}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Architecture</div>
                          <div className="break-all">{selectedFinding.binaryCrypto?.architecture ?? "—"}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Evidence type</div>
                          <div className="break-all capitalize">{selectedFinding.binaryCrypto?.evidenceType?.replace("_", " ") ?? "—"}</div>
                        </div>
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Observed value</div>
                          <div className="break-all">{selectedFinding.binaryCrypto?.observedValue ?? selectedFinding.name}</div>
                        </div>
                        {selectedFinding.binaryCrypto?.library && (
                          <div>
                            <div className="uppercase tracking-wider text-ink-muted">Library / Provider</div>
                            <div className="break-all">{selectedFinding.binaryCrypto.library}</div>
                          </div>
                        )}
                        <div>
                          <div className="uppercase tracking-wider text-ink-muted">Verification scope</div>
                          <div className="break-all">{selectedFinding.binaryCrypto?.verificationScope ?? "static_binary_observation"}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
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
                          <span className="flex items-center gap-1.5">
                            <span>Proposed Replacement</span>
                            <span className="text-status-good font-semibold">
                              {selectedItem.rec.recommendedAlgorithm}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyPatch(selectedFinding.id, selectedItem.rec.replacementCode)}
                            className="rounded-sm border border-line bg-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink hover:border-line-strong hover:bg-surface-2 transition-colors"
                          >
                            {copiedPatchId === selectedFinding.id ? "Copied!" : "Copy Patch"}
                          </button>
                        </div>
                        <pre className="rounded-sm border border-line bg-surface p-2 text-ink whitespace-pre-wrap">
                          {selectedItem.rec.replacementCode}
                        </pre>
                        <p className="text-[11px] text-ink-secondary">{selectedItem.rec.migrationNote}</p>
                      </div>
                    </div>
                  )}

                  {/* Phase 4: Deployment Topology Exposure (deterministic IaC
                      classification, shown only when the finding carries it) */}
                  {selectedFinding.exposureState !== undefined && (
                    <div className="mt-2 space-y-1.5 border-t border-line pt-2 font-mono text-[11px] text-ink">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="uppercase tracking-wider text-ink-muted">Deployment Exposure</span>
                        <ExposureBadge exposure={selectedFinding.exposureState} />
                        {selectedFinding.correlationStrength && (
                          <span className="text-ink-muted">
                            correlation: {selectedFinding.correlationStrength}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        {selectedFinding.workload && (
                          <div className="col-span-2">
                            <div className="uppercase tracking-wider text-ink-muted">Workload</div>
                            <div className="break-all">{selectedFinding.workload}</div>
                          </div>
                        )}
                        {selectedFinding.service && (
                          <div>
                            <div className="uppercase tracking-wider text-ink-muted">Service</div>
                            <div className="break-all">{selectedFinding.service}</div>
                          </div>
                        )}
                        {selectedFinding.ingress && (
                          <div>
                            <div className="uppercase tracking-wider text-ink-muted">Ingress</div>
                            <div className="break-all">{selectedFinding.ingress}</div>
                          </div>
                        )}
                        {selectedFinding.namespace && (
                          <div>
                            <div className="uppercase tracking-wider text-ink-muted">Namespace</div>
                            <div className="break-all">{selectedFinding.namespace}</div>
                          </div>
                        )}
                      </div>
                      {selectedFinding.evidenceChain && (
                        <div className="text-ink-secondary leading-relaxed break-words">
                          Evidence: {selectedFinding.evidenceChain}
                        </div>
                      )}
                      <p className="text-ink-muted leading-relaxed">
                        Classified from statically parsed IaC — never an LLM verdict. A finding with
                        no correlated workload stays UNKNOWN; static inspection alone never proves
                        external exposure.
                      </p>
                    </div>
                  )}
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
            <span className="font-semibold text-ink">{displayName(hoveredFinding.finding)}</span>
            {isReferenceFinding(hoveredFinding.finding) ? (
              <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                Reference
              </span>
            ) : (
              <QuantumStatusBadge status={hoveredFinding.finding.quantumStatus} />
            )}
          </div>

          {isReferenceFinding(hoveredFinding.finding) ? (
            <p className="text-[11px] text-ink-muted leading-snug">
              String literal reference — not an executed cryptographic operation.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
                <span>Reachability:</span>
                <ReachabilityBadge
                  reachability={hoveredFinding.finding.reachability}
                  status={hoveredFinding.finding.quantumStatus}
                />
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-ink-secondary">
                <span>Exposure:</span>
                <ExposureBadge exposure={hoveredFinding.finding.exposureState} />
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
            </>
          )}
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
 * Returns the real, absolute on-disk path for this file node — the exact
 * locator string a detector attached to one of its findings' evidence,
 * which is what the scan actually read from disk, rather than a path
 * reconstructed by string concatenation (which can disagree on separators
 * or relative segments). Falls back to `node.fullPath` only when this node
 * has no findings of its own to source a locator from (e.g. an
 * architectural directory placeholder file with zero findings).
 */
function findRealFilePathForNode(node: TreeNode, findings: Finding[]): string | undefined {
  for (const f of findings) {
    const occ = f.evidence.find((e) => isOccurrenceInFile(e.locator, node));
    if (occ?.locator) return occ.locator;
  }
  return node.fullPath || undefined;
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
