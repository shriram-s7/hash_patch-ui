import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  Code2,
  ChevronLeft,
  ChevronRight,
  Check,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { displayName, type Finding, type QuantumStatus } from "./cbom/types";
import { compareFindingsPriority, computePriorityScore } from "./priority";
import { getRecommendationForFinding, type PqcRecommendation } from "./pqcRecommendations";
import type { TreeNode } from "./repositoryTree";
import { SERVICE_BASE_URL } from "./serviceUrl";
import { ResizableDivider } from "./components/ResizableDivider";
import { FEATURE_GUIDED_UI } from "./tour/flags";
import { Coachmark } from "./tour/Coachmark";
import { tourStore, useTourStoreState } from "./tour/store";
import { useTourStep } from "./tour/useTourStep";
import { useReducedMotion } from "./tour/useReducedMotion";
import { useIsDark } from "./useIsDark";

const FILE_GUTTER_DOT_TOUR_ID = "file.gutter-dot";
const STEP_GUTTER = "file.gutter-dot.gutter";
const STEP_ANALYSIS = "file.gutter-dot.analysis";
const STEP_IDS = [STEP_GUTTER, STEP_ANALYSIS];

const FINDING_TABS_TOUR_ID = "finding.tabs";
const TAB_STEP_IDS = [
  "finding.tabs.overview",
  "finding.tabs.fix",
  "finding.tabs.chain",
  "finding.tabs.references",
];

// Recommended Action authority chip -- first-visit ring nudge, once per user.
const AUTHORITY_CHIP_NUDGE_ID = "finding.authority-chip-nudge";

// Contrast-verified against the card surface each theme actually renders on
// (see FileWorkspace's flip-card review): dark label 10.39:1 / border 3.18:1,
// light label 6.84:1 / border 3.39:1 -- all above the 4.5:1 (label) and 3:1
// (border) WCAG AA floors. The spec's suggested border alpha (70% dark / 45%
// light) measured under the floor once blended against the real card
// surface, so alpha is raised here (90% / 80%) to actually clear 3:1.
const AUTHORITY_CHIP_COLORS = {
  dark: { bg: "#451A03", border: "rgba(180, 83, 9, 0.9)", label: "#FCD34D", icon: "#FCD34D" },
  light: { bg: "#FFFBEB", border: "rgba(180, 83, 9, 0.8)", label: "#92400E", icon: "#92400E" },
};

/** Rotate/flip glyph -- the standard signal for "this surface flips". */
function RotateGlyph({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 2.6-6.36" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function parseStandardDetails(standardStr: string, algoName: string) {
  let docId = standardStr;
  let title = "";
  const match = standardStr.match(/^([^(]+)(?:\(([^)]+)\))?/);
  if (match) {
    docId = match[1].trim();
    title = match[2] ? match[2].trim() : "";
  }
  const formattedDoc = title ? `${docId} · ${title}` : docId;

  let url = "https://csrc.nist.gov/publications";
  let statusDate = "";
  if (docId.includes("204")) {
    url = "https://csrc.nist.gov/pubs/fips/204/final";
    statusDate = "Final Standard · Published August 2024";
  } else if (docId.includes("203")) {
    url = "https://csrc.nist.gov/pubs/fips/203/final";
    statusDate = "Final Standard · Published August 2024";
  } else if (docId.includes("205")) {
    url = "https://csrc.nist.gov/pubs/fips/205/final";
    statusDate = "Final Standard · Published August 2024";
  } else if (docId.includes("38D") || docId.includes("800-38")) {
    url = "https://csrc.nist.gov/pubs/sp/800/38/d/final";
    statusDate = "NIST Special Publication · SP 800-38D";
  } else if (docId.includes("180-4")) {
    url = "https://csrc.nist.gov/pubs/fips/180-4/final";
  } else if (docId.includes("202")) {
    url = "https://csrc.nist.gov/pubs/fips/202/final";
  }

  let paramReason = "";
  const upperAlgo = (algoName || "").toUpperCase();
  if (upperAlgo.includes("ML-DSA-65")) {
    paramReason = "ML-DSA-65 = NIST Security Category 3 (AES-192 equivalent security)";
  }

  return { docId, formattedDoc, url, statusDate, paramReason };
}

function FixCardArrow({ findingId }: { findingId: string }) {
  const gradId = `fix-arrow-grad-${findingId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  return (
    <div className="flex items-center justify-center px-2 w-full max-w-[150px]">
      <svg className="w-full h-5 overflow-visible" viewBox="0 0 120 20" fill="none">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <line
          x1="4"
          y1="10"
          x2="108"
          y2="10"
          stroke={`url(#${gradId})`}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M102 5 L112 10 L102 15"
          stroke="#10b981"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

interface FixCardProps {
  finding: Finding;
  rec: PqcRecommendation;
  isFlipped: boolean;
  isFlippingBack: boolean;
  onFlip: (flip: boolean) => void;
  isCollapsed: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
  showAuthorityRing: boolean;
  isDarkTheme: boolean;
  reducedMotion: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function FixCard({
  finding,
  rec,
  isFlipped,
  isFlippingBack,
  onFlip,
  isCollapsed,
  onToggleCollapse,
  showAuthorityRing,
  isDarkTheme,
  reducedMotion,
  className = "",
  style = {},
}: FixCardProps) {
  const parsedStd = parseStandardDetails(rec.standard, rec.recommendedAlgorithm);
  const chipColors = isDarkTheme ? AUTHORITY_CHIP_COLORS.dark : AUTHORITY_CHIP_COLORS.light;

  if (isCollapsed) {
    return (
      <div
        className={`flex items-center justify-between w-full h-full px-4 rounded-xl border border-emerald-500/30 cursor-pointer select-none ${className}`}
        style={{
          background: "#0d1424",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
          ...style,
        }}
        onClick={() => onToggleCollapse(false)}
      >
        <div className="flex items-center gap-2 text-xs font-mono font-semibold truncate mr-2">
          <span className="text-red-400 font-bold">{displayName(finding)}</span>
          <span className="text-[#8b949e]">→</span>
          <span className="text-emerald-400 font-bold">{rec.recommendedAlgorithm}</span>
          {parsedStd.docId && (
            <>
              <span className="text-[#6e7681]">·</span>
              <span className="text-[#93a1b5] truncate">{parsedStd.docId}</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(false);
          }}
          className="p-1 rounded text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors cursor-pointer shrink-0"
          title="Expand fix card"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full ${className}`}
      style={{
        perspective: "1400px",
        ...style,
      }}
    >
      <div
        className="relative w-full h-full cursor-pointer"
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          transition: reducedMotion
            ? "none"
            : `transform ${isFlippingBack ? 200 : 520}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
        onClick={() => {
          if (!isFlipped) onFlip(true);
          else onFlip(false);
        }}
      >
        {/* FRONT FACE */}
        <div
          className="absolute inset-0 rounded-xl border p-4 flex flex-col justify-between select-none"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(0deg)",
            background: "#0c1322",
            borderColor: "rgba(16, 185, 129, 0.3)",
            boxShadow:
              "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4), 0 0 16px rgba(16, 185, 129, 0.12)",
          }}
        >
          {/* Top row */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#8b949e] font-mono">
              REPLACE
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(true);
              }}
              className="p-1 -mr-1 -mt-1 rounded text-[#8b949e] hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title="Collapse fix card"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          {/* Middle row: Display type */}
          <div className="flex items-center justify-between my-auto gap-3">
            {/* Old algo */}
            <div className="flex-1 min-w-0 text-left">
              <div className="text-lg sm:text-2xl font-black tracking-tight text-red-400 truncate">
                {displayName(finding)}
              </div>
              <div className="text-[11px] text-[#8b949e] font-medium truncate mt-0.5">
                {quantumStatusText(finding).text}
              </div>
            </div>

            {/* Drawn SVG Arrow */}
            <FixCardArrow findingId={finding.id} />

            {/* New algo */}
            <div className="flex-1 min-w-0 text-right">
              <div className="text-lg sm:text-2xl font-black tracking-tight text-emerald-400 truncate">
                {rec.recommendedAlgorithm}
              </div>
              <div className="text-[11px] text-[#8b949e] font-medium truncate mt-0.5">
                {parsedStd.docId || rec.standard}
              </div>
            </div>
          </div>

          {/* Bottom row: Flip button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFlip(true);
            }}
            className="relative flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all hover:brightness-110 active:scale-[0.99] cursor-pointer"
            style={{
              background: chipColors.bg,
              border: `1px solid ${chipColors.border}`,
              color: chipColors.label,
            }}
          >
            {showAuthorityRing && (
              <span
                className={`rec-chip-ring ${reducedMotion ? "" : "rec-chip-ring--pulse"}`}
                aria-hidden="true"
              />
            )}
            <RotateGlyph style={{ color: chipColors.icon }} />
            Who requires this?
          </button>
        </div>

        {/* BACK FACE */}
        <div
          className="absolute inset-0 rounded-xl border p-4 flex flex-col justify-between select-none"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
            background: "linear-gradient(135deg, #0d1224 0%, #151b33 100%)",
            borderColor: "rgba(99, 102, 241, 0.35)",
            boxShadow:
              "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 24px rgba(99, 102, 241, 0.15)",
          }}
        >
          <div>
            <div className="flex items-center justify-between pb-1.5 border-b border-amber-500/30">
              <div className="text-[10px] font-bold tracking-widest uppercase text-amber-400 font-mono">
                MANDATED BY
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFlip(false);
                }}
                className="rounded-md border border-[#30363d] px-2.5 py-0.5 text-xs font-medium text-[#c9d1d9] hover:bg-white/5 transition-colors cursor-pointer"
              >
                ← Back
              </button>
            </div>

            <div className="text-base sm:text-lg font-black text-white leading-tight mt-2">
              NIST — National Institute of Standards and Technology
            </div>

            <div className="mt-1.5 space-y-0.5">
              <div className="text-xs sm:text-sm font-semibold text-[#e7ecf3]">
                {parsedStd.formattedDoc}
              </div>
              {parsedStd.statusDate && (
                <div className="text-[11px] text-[#93a1b5] font-mono">
                  {parsedStd.statusDate}
                </div>
              )}
              {parsedStd.paramReason && (
                <div className="text-xs text-amber-300/90 font-medium mt-1">
                  {parsedStd.paramReason}
                </div>
              )}
            </div>
          </div>

          <div className="pt-2 border-t border-[#21262d] flex items-center justify-between">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(parsedStd.url, "_blank");
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] cursor-pointer"
              style={{
                background: "#2563eb",
                boxShadow: "0 1px 6px rgba(37, 99, 235, 0.35)",
              }}
            >
              <span>Read the standard</span>
              <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
            </button>
            <span className="text-[10px] text-[#6e7681]">Official federal specification</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function hasPqcReplacement(finding: Finding, rec: PqcRecommendation): boolean {
  if (finding.quantumStatus === "quantum-safe") return false;
  if (!rec.recommendedAlgorithm) return false;
  return rec.recommendedAlgorithm.trim().toLowerCase() !== displayName(finding).trim().toLowerCase();
}

interface SlideTransition {
  outgoingFinding: Finding;
  outgoingRec: PqcRecommendation;
  direction: "next" | "prev";
  wasCollapsed: boolean;
}

interface FixStageProps {
  finding: Finding;
  rec: PqcRecommendation;
  isFlipped: boolean;
  isFlippingBack: boolean;
  setIsFlipped: (flip: boolean) => void;
  slideTransition: SlideTransition | null;
  navDirection: "next" | "prev" | "none";
  showAuthorityRing: boolean;
  isDarkTheme: boolean;
  reducedMotion: boolean;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

function FixStage({
  finding,
  rec,
  isFlipped,
  isFlippingBack,
  setIsFlipped,
  slideTransition,
  navDirection,
  showAuthorityRing,
  isDarkTheme,
  reducedMotion,
  isCollapsed,
  setIsCollapsed,
}: FixStageProps) {
  const currentHasReplacement = hasPqcReplacement(finding, rec);

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden border transition-[height] duration-200"
      style={{
        height: isCollapsed ? "48px" : "216px",
        background: "#080c13",
        borderColor: "#21262d",
        boxShadow:
          "inset 16px 0 20px -10px rgba(0,0,0,0.8), inset -16px 0 20px -10px rgba(0,0,0,0.8)",
      }}
    >
      {!currentHasReplacement && !slideTransition ? (
        <div className="flex h-full w-full items-center justify-center text-xs text-[#8b949e]">
          No PQC replacement mapped for this finding
        </div>
      ) : (
        <>
          {slideTransition && (
            <div
              key={`outgoing-${slideTransition.outgoingFinding.id}`}
              className={`absolute inset-2 ${
                reducedMotion
                  ? "fix-card-reduced-out"
                  : slideTransition.direction === "next"
                  ? "fix-card-outgoing-next"
                  : "fix-card-outgoing-prev"
              }`}
            >
              {hasPqcReplacement(slideTransition.outgoingFinding, slideTransition.outgoingRec) ? (
                <FixCard
                  finding={slideTransition.outgoingFinding}
                  rec={slideTransition.outgoingRec}
                  isFlipped={false}
                  isFlippingBack={false}
                  onFlip={() => {}}
                  isCollapsed={slideTransition.wasCollapsed}
                  onToggleCollapse={() => {}}
                  showAuthorityRing={false}
                  isDarkTheme={isDarkTheme}
                  reducedMotion={reducedMotion}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-[#8b949e]">
                  No PQC replacement mapped for this finding
                </div>
              )}
            </div>
          )}

          {currentHasReplacement ? (
            <div
              key={`incoming-${finding.id}`}
              className={`absolute inset-2 ${
                slideTransition
                  ? reducedMotion
                    ? "fix-card-reduced-in"
                    : slideTransition.direction === "next"
                    ? "fix-card-incoming-next"
                    : "fix-card-incoming-prev"
                  : navDirection === "none"
                  ? "fix-card-incoming-initial"
                  : ""
              }`}
            >
              <FixCard
                finding={finding}
                rec={rec}
                isFlipped={isFlipped}
                isFlippingBack={isFlippingBack}
                onFlip={setIsFlipped}
                isCollapsed={isCollapsed}
                onToggleCollapse={setIsCollapsed}
                showAuthorityRing={showAuthorityRing}
                isDarkTheme={isDarkTheme}
                reducedMotion={reducedMotion}
              />
            </div>
          ) : (
            <div
              key={`incoming-fallback-${finding.id}`}
              className={`absolute inset-2 flex items-center justify-center text-xs text-[#8b949e] ${
                slideTransition
                  ? reducedMotion
                    ? "fix-card-reduced-in"
                    : slideTransition.direction === "next"
                    ? "fix-card-incoming-next"
                    : "fix-card-incoming-prev"
                  : ""
              }`}
            >
              No PQC replacement mapped for this finding
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Full file view's right rail: findings list (upper) + finding-detail tabs
// (lower, collapsible) sharing one resizable panel -- see Change 2/4 of the
// immersive-file-view redesign. Own localStorage keys, separate from the
// folder-browser's tree width, since this panel's role changed (it used to
// be just a findings list; the finding-detail tabs moved into it from the
// old full-width bottom panel).
const DETAIL_WIDTH_KEY = "file-view-detail-width";
const DETAIL_WIDTH_DEFAULT = 380;
const DETAIL_WIDTH_MIN = 280;
const DETAIL_WIDTH_MAX = 600;



interface FileWorkspaceProps {
  node: TreeNode;
  findings: Finding[];
  allFindings: Finding[];
  sourceName: string;
}

type Severity = "high" | "medium" | "low";

function severityTier(f: Finding): Severity {
  const score = computePriorityScore(f);
  if (score >= 700) return "high";
  if (score >= 300) return "medium";
  return "low";
}

const CATEGORY_LABEL: Record<string, string> = {
  hash: "Hash Function",
  mac: "Message Authentication Code",
  "block-cipher": "Block Cipher",
  "stream-cipher": "Stream Cipher",
  signature: "Signature",
  "key-agreement": "Key Agreement",
  pke: "Public Key Encryption",
  kdf: "Key Derivation Function",
  drbg: "Random Number Generator",
  "key-derivation-function": "Key Derivation Function",
};

function categoryLabel(f: Finding): string {
  const p = (f.primitive ?? "").toLowerCase();
  return CATEGORY_LABEL[p] ?? (f.primitive ? f.primitive.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown");
}

function reachabilityText(f: Finding): { text: string; color: string } {
  if (f.mixedReachability) return { text: "Mixed", color: "#f59e0b" };
  switch (f.reachability) {
    case "live-external":
      return { text: "Live (entry)", color: "#ef4444" };
    case "live-internal":
      return { text: "Live (internal)", color: "#f59e0b" };
    case "inert":
      return { text: "Inert", color: "#6b7280" };
    default:
      return { text: "Unknown", color: "#8b949e" };
  }
}

function quantumStatusText(f: Finding): { text: string; color: string } {
  switch (f.quantumStatus) {
    case "broken-by-shor":
      return { text: "Broken by Shor", color: "#ef4444" };
    case "weakened-by-grover":
      return { text: "Weakened by Grover", color: "#f59e0b" };
    case "broken-classically":
      return { text: "Broken classically", color: "#8b949e" };
    case "quantum-safe":
      return { text: "Quantum-safe", color: "#22c55e" };
    default:
      return { text: "Unknown", color: "#8b949e" };
  }
}

export function getDotColor(quantumStatus: QuantumStatus | undefined): string {
  switch (quantumStatus) {
    case "broken-by-shor":
      return "#ef4444";
    case "weakened-by-grover":
      return "#f59e0b";
    case "broken-classically":
      return "#6b7280";
    case "quantum-safe":
      return "#22c55e";
    default:
      return "#8b949e";
  }
}

export function getSeverityStyle(quantumStatus: QuantumStatus | undefined): string {
  switch (quantumStatus) {
    case "broken-by-shor":
      return "bg-[#ef4444]/20 text-[#ef4444] border-[#ef4444]/30";
    case "weakened-by-grover":
      return "bg-[#f59e0b]/20 text-[#f59e0b] border-[#f59e0b]/30";
    case "broken-classically":
      return "bg-[#6b7280]/20 text-[#6b7280] border-[#6b7280]/30";
    case "quantum-safe":
      return "bg-[#22c55e]/20 text-[#22c55e] border-[#22c55e]/30";
    default:
      return "bg-[#6b7280]/20 text-[#6b7280] border-[#6b7280]/30";
  }
}

const LANG_ICON: Record<string, string> = {
  py: "\u{1F40D}",
  java: "☕",
  go: "Go",
  c: "C",
  h: "C",
  cpp: "C++",
  js: "JS",
  ts: "TS",
  rs: "RS",
  rb: "RB",
};

export function languageIcon(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return LANG_ICON[ext] ?? "\u{1F4C4}";
}

export function languageName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const names: Record<string, string> = {
    py: "Python",
    java: "Java",
    go: "Go",
    c: "C",
    h: "C Header",
    cpp: "C++",
    js: "JavaScript",
    ts: "TypeScript",
    rs: "Rust",
    rb: "Ruby",
  };
  return names[ext] ?? "Plain Text";
}

function isOccurrenceInFile(locator: string | undefined, node: TreeNode): boolean {
  if (!locator) return false;
  const cleanLoc = locator.replace(/\\/g, "/").toLowerCase();
  const cleanName = node.name.toLowerCase();
  const cleanPath = node.path.replace(/\\/g, "/").toLowerCase();
  if (!cleanLoc.endsWith("/" + cleanName) && cleanLoc !== cleanName) return false;
  if (cleanPath.includes("/")) {
    if (!cleanLoc.endsWith("/" + cleanPath) && cleanLoc !== cleanPath) return false;
  }
  return true;
}

function getFindingOccurrenceInFile(finding: Finding, node: TreeNode) {
  return finding.evidence.find((occ) => isOccurrenceInFile(occ.locator, node)) ?? finding.evidence[0];
}

export function findRealFilePathForNode(node: TreeNode, findings: Finding[]): string | undefined {
  for (const f of findings) {
    const occ = f.evidence.find((e) => isOccurrenceInFile(e.locator, node));
    if (occ?.locator) return occ.locator;
  }
  return node.fullPath || undefined;
}

export function reconstructSourceFromEvidence(fileName: string, findings: Finding[]): string {
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
    if (lineMap.has(i)) generated.push(lineMap.get(i)!);
    else if (i === 1) generated.push(`// Offline preview for: ${fileName}`);
    else generated.push("");
  }
  return generated.join("\n");
}

function copyToClipboard(text: string, onDone: () => void) {
  if (navigator?.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onDone).catch(() => fallbackCopy(text, onDone));
  } else {
    fallbackCopy(text, onDone);
  }
}

function fallbackCopy(text: string, onDone: () => void) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try {
    document.execCommand("copy");
  } catch {
    // ignore
  }
  document.body.removeChild(el);
  onDone();
}

const KEYWORD_REGEX =
  /\b(import|from|as|def|return|class|if|elif|else|for|while|in|try|except|finally|with|assert|const|let|var|function|async|await|package|type|struct|func|public|private|static|void|int|char|bool)\b/g;

export function renderSyntax(line: string) {
  if (!line) return " ";
  const commentMatch = /(#.*|\/\/.*)/.exec(line);
  const renderTokens = (text: string) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    KEYWORD_REGEX.lastIndex = 0;
    while ((match = KEYWORD_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      parts.push(
        <span key={match.index} style={{ color: "#ff7b72" }}>
          {match[0]}
        </span>,
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  };
  if (commentMatch && commentMatch.index !== undefined) {
    const before = line.slice(0, commentMatch.index);
    return (
      <>
        {renderTokens(before)}
        <span style={{ color: "#6e7681", fontStyle: "italic" }}>{commentMatch[0]}</span>
      </>
    );
  }
  return renderTokens(line);
}

type BottomTab = "details" | "chain" | "fix" | "references";

export function FileWorkspace({ node, findings, allFindings, sourceName }: FileWorkspaceProps) {
  const sortedFindings = useMemo(() => [...findings].sort(compareFindingsPriority), [findings]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => setSelectedIndex(0), [node.id]);
  const selectedFinding = sortedFindings[selectedIndex] ?? sortedFindings[0];

  // Modal state — opens the full finding analysis popup
  const [modalOpen, setModalOpen] = useState(false);
  const [modalIndex, setModalIndex] = useState(0);
  const [modalTab, setModalTab] = useState<BottomTab>("details");
  const [modalCopiedId, setModalCopiedId] = useState<string | null>(null);

  // Part B (flip), Part C (direction), Part D (Fix Card motion)
  const [isFlipped, setIsFlipped] = useState(false);
  const [isFlippingBack, setIsFlippingBack] = useState(false);
  const [navDirection, setNavDirection] = useState<"next" | "prev" | "none">("none");
  const [slideTransition, setSlideTransition] = useState<SlideTransition | null>(null);

  const tourStoreState = useTourStoreState();
  const isCollapsed = tourStoreState.fixCardCollapsed ?? false;
  const setIsCollapsed = (collapsed: boolean) => tourStore.setFixCardCollapsed(collapsed);

  const tabFixRef = useRef<HTMLButtonElement | null>(null);
  const tabChainRef = useRef<HTMLButtonElement | null>(null);
  const tabRefsRef = useRef<HTMLButtonElement | null>(null);

  // Authority-chip ring nudge
  const isDarkTheme = useIsDark();
  const reducedMotion = useReducedMotion();
  const [authorityNudge, setAuthorityNudge] = useState<{ armed: boolean; findingId: string | null }>({
    armed: false,
    findingId: null,
  });

  // Part D: finding.tabs tour arms once on first finding
  useEffect(() => {
    if (!FEATURE_GUIDED_UI) return;
    if (!modalOpen || modalIndex !== 0) return;
    if (tourStore.hasSeen(FINDING_TABS_TOUR_ID)) return;
    if (tourStore.getSnapshot().activeTour === FINDING_TABS_TOUR_ID) return;
    tourStore.startTour(FINDING_TABS_TOUR_ID, TAB_STEP_IDS);
  }, [modalOpen, modalIndex]);

  // Follow user tab progression during finding.tabs tour
  useEffect(() => {
    if (!FEATURE_GUIDED_UI || !modalOpen) return;
    const snap = tourStore.getSnapshot();
    if (snap.activeTour !== FINDING_TABS_TOUR_ID) return;

    const targetStepIndex =
      modalTab === "details" ? 0 :
      modalTab === "fix" ? 1 :
      modalTab === "chain" ? 2 : 3;

    if (snap.activeStepIndex !== targetStepIndex) {
      tourStore.startTour(FINDING_TABS_TOUR_ID, TAB_STEP_IDS);
      for (let i = 0; i < targetStepIndex; i++) {
        tourStore.nextStep();
      }
    }
  }, [modalTab, modalOpen]);

  const tabTourStepInfo = useMemo(() => {
    if (modalTab === "details") {
      return {
        stepId: "finding.tabs.overview",
        anchorRef: tabFixRef,
        nextTabId: "fix" as BottomTab,
        title: "Suggested Fix",
        body: "The verdict and the fix.",
        stepN: 1,
      };
    }
    if (modalTab === "fix") {
      return {
        stepId: "finding.tabs.fix",
        anchorRef: tabChainRef,
        nextTabId: "chain" as BottomTab,
        title: "Call Chain",
        body: "Copy-ready replacement code.",
        stepN: 2,
      };
    }
    if (modalTab === "chain") {
      return {
        stepId: "finding.tabs.chain",
        anchorRef: tabRefsRef,
        nextTabId: "references" as BottomTab,
        title: "References",
        body: "How execution reaches this line.",
        stepN: 3,
      };
    }
    if (modalTab === "references") {
      return {
        stepId: "finding.tabs.references",
        anchorRef: tabRefsRef,
        nextTabId: "references" as BottomTab,
        title: "Traceability",
        body: "Every claim, traceable.",
        stepN: 4,
      };
    }
    return null;
  }, [modalTab]);

  const openModal = (idx: number) => {
    setModalIndex(idx);
    setModalTab("details");
    setIsFlipped(false);
    setIsFlippingBack(false);
    setSlideTransition(null);
    setNavDirection("none");
    setModalOpen(true);
  };

  const [codeTab, setCodeTab] = useState<"code" | "info">("code");
  const [sortMode, setSortMode] = useState<"line" | "priority">("line");
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [rawMode, setRawMode] = useState(false);
  const [detailWidth, setDetailWidth] = useState(() => {
    const saved = localStorage.getItem(DETAIL_WIDTH_KEY);
    return saved ? parseInt(saved) : DETAIL_WIDTH_DEFAULT;
  });

  const handleDetailResize = (delta: number) => {
    if (delta === 0) {
      setDetailWidth(DETAIL_WIDTH_DEFAULT);
      localStorage.removeItem(DETAIL_WIDTH_KEY);
      return;
    }
    setDetailWidth((w) => {
      // The divider sits to the LEFT of this panel, so dragging it right
      // (positive delta) should shrink the panel, not grow it.
      const next = Math.min(DETAIL_WIDTH_MAX, Math.max(DETAIL_WIDTH_MIN, w - delta));
      localStorage.setItem(DETAIL_WIDTH_KEY, String(next));
      return next;
    });
  };



  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceIsFallback, setSourceIsFallback] = useState(false);
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Guided tour refs and step states (additive only)
  const firstGutterRef = useRef<HTMLSpanElement>(null);
  const firstViewAnalysisRef = useRef<HTMLButtonElement>(null);
  const codeScrollRef = useRef<HTMLDivElement>(null);

  const showGutterStep = useTourStep(STEP_GUTTER);
  const showAnalysisStep = useTourStep(STEP_ANALYSIS);

  // Arm tour on first entry to this view only -- if zero findings, does not arm
  useEffect(() => {
    if (!FEATURE_GUIDED_UI) return;
    if (sortedFindings.length === 0) return;
    if (tourStore.hasSeen(FILE_GUTTER_DOT_TOUR_ID)) return;
    if (tourStore.getSnapshot().activeTour) return;
    tourStore.startTour(FILE_GUTTER_DOT_TOUR_ID, STEP_IDS);
  }, [sortedFindings.length]);

  // Step 1: scroll to first flagged line if out of view, wait for settle, then anchor
  const [gutterReady, setGutterReady] = useState(false);

  useEffect(() => {
    if (!showGutterStep) {
      setGutterReady(false);
      return;
    }
    if (!firstGutterRef.current) return;

    const el = firstGutterRef.current;
    const container = codeScrollRef.current;
    if (!container) {
      setGutterReady(true);
      return;
    }

    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const inView = eRect.top >= cRect.top && eRect.bottom <= cRect.bottom;

    if (inView) {
      setGutterReady(true);
      return;
    }

    setGutterReady(false);
    el.scrollIntoView({ block: "center", behavior: "smooth" });

    let timer: ReturnType<typeof setTimeout>;
    const onSettle = () => {
      clearTimeout(timer);
      setGutterReady(true);
    };

    container.addEventListener("scrollend", onSettle, { once: true });
    timer = setTimeout(onSettle, 350);

    return () => {
      container.removeEventListener("scrollend", onSettle);
      clearTimeout(timer);
    };
  }, [showGutterStep, loading]);

  // Direct click listener on first View Analysis button: hands off to finding.tabs if tour is running
  useEffect(() => {
    const el = firstViewAnalysisRef.current;
    if (!el) return;
    const onRealClick = () => {
      if (tourStore.getSnapshot().activeTour === FILE_GUTTER_DOT_TOUR_ID) {
        tourStore.handoffTour(FINDING_TABS_TOUR_ID, TAB_STEP_IDS);
      }
    };
    el.addEventListener("click", onRealClick);
    return () => el.removeEventListener("click", onRealClick);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);

    async function fetchSource() {
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
          // fall through
        }
      }
      if (active) {
        setSourceCode(reconstructSourceFromEvidence(node.name, findings));
        setSourceIsFallback(true);
        setLoading(false);
      }
    }

    void fetchSource();
    return () => {
      active = false;
    };
  }, [node, findings, sourceName]);

  useEffect(() => {
    if (!selectedFinding) return;
    const occ = getFindingOccurrenceInFile(selectedFinding, node);
    if (occ?.line !== undefined) {
      lineRefs.current.get(occ.line)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedFinding, node]);

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

  // Identify the first flagged line and primary finding
  const firstFindingLine = useMemo(() => {
    if (lineToFindings.size === 0) return null;
    const nums = Array.from(lineToFindings.keys());
    return Math.min(...nums);
  }, [lineToFindings]);

  const firstFinding = useMemo(() => {
    if (firstFindingLine === null) return null;
    return lineToFindings.get(firstFindingLine)?.[0] ?? null;
  }, [firstFindingLine, lineToFindings]);

  const gutterBodyCopy = useMemo(() => {
    if (!firstFinding) {
      return "Each marker is a cryptographic operation the scanner resolved to a real API call — not a text match.";
    }
    const name = displayName(firstFinding);
    const cat = firstFinding.primitive ? (CATEGORY_LABEL[firstFinding.primitive] || firstFinding.primitive) : "";
    const desc = cat && !name.toLowerCase().includes(cat.toLowerCase()) ? `${name} (${cat})` : name;
    return `Each marker is a cryptographic operation the scanner resolved to a real API call — not a text match. Line ${firstFindingLine ?? "—"} here is a ${desc}.`;
  }, [firstFinding, firstFindingLine]);

  const lines = useMemo(() => (sourceCode === null ? [] : sourceCode.split(/\r?\n/)), [sourceCode]);

  const relPath = (node.fullPath || node.path || node.name).replace(/\\/g, "/");
  const [copiedName, setCopiedName] = useState(false);

  const sortedForList = useMemo(() => {
    if (sortMode === "priority") return sortedFindings;
    return [...sortedFindings].sort((a, b) => {
      const la = getFindingOccurrenceInFile(a, node)?.line ?? 0;
      const lb = getFindingOccurrenceInFile(b, node)?.line ?? 0;
      return la - lb;
    });
  }, [sortedFindings, sortMode, node]);

  const findingsById = useMemo(() => new Map(allFindings.map((f) => [f.id, f])), [allFindings]);

  const selectByFindingId = (id: string) => {
    const idx = sortedFindings.findIndex((f) => f.id === id);
    if (idx !== -1) setSelectedIndex(idx);
  };

  const handleOpenRaw = () => {
    if (sourceCode === null) return;
    const blob = new Blob([sourceCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };



  // Build the analysis modal ahead of the return so we can use const declarations.
  const modalFinding = sortedForList[modalIndex];
  const modalRec = modalFinding
    ? getRecommendationForFinding(modalFinding, getFindingOccurrenceInFile(modalFinding, node)?.snippet ?? "")
    : null;
  const modalOcc = modalFinding ? getFindingOccurrenceInFile(modalFinding, node) : null;
  const accentCol = modalFinding ? getDotColor(modalFinding.quantumStatus) : "#3b82f6";
  const modalTotal = sortedForList.length;
  const total = modalTotal;

  const navigateToFinding = (targetIdx: number) => {
    if (targetIdx === modalIndex || targetIdx < 0 || targetIdx >= sortedForList.length) return;
    const targetDir = targetIdx > modalIndex ? "next" : "prev";
    const currentF = sortedForList[modalIndex];
    const currentR = currentF ? getRecommendationForFinding(currentF, getFindingOccurrenceInFile(currentF, node)?.snippet ?? "") : null;
    const isCurrentlyCollapsed = tourStore.getSnapshot().fixCardCollapsed ?? false;

    if (isFlipped) {
      setIsFlippingBack(true);
      setIsFlipped(false);
      setTimeout(() => {
        setIsFlippingBack(false);
        setNavDirection(targetDir);
        if (currentF && currentR) {
          setSlideTransition({
            outgoingFinding: currentF,
            outgoingRec: currentR,
            direction: targetDir,
            wasCollapsed: isCurrentlyCollapsed,
          });
        }
        setModalIndex(targetIdx);
        setModalTab("details");
      }, 200);
    } else {
      setNavDirection(targetDir);
      if (currentF && currentR) {
        setSlideTransition({
          outgoingFinding: currentF,
          outgoingRec: currentR,
          direction: targetDir,
          wasCollapsed: isCurrentlyCollapsed,
        });
      }
      setModalIndex(targetIdx);
      setModalTab("details");
    }
  };

  useEffect(() => {
    if (!slideTransition) return;
    const timer = setTimeout(() => {
      setSlideTransition(null);
    }, 560);
    return () => clearTimeout(timer);
  }, [slideTransition]);

  useEffect(() => {
    if (!modalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateToFinding(modalIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateToFinding(modalIndex + 1);
      } else if (e.key === "Escape") {
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, modalIndex, isFlipped, sortedForList.length]);

  // Arm the authority-chip ring nudge once, ever, for the first qualifying
  // finding the user sees -- markSeen fires immediately so no later finding
  // (this session or a future one) re-triggers it.
  useEffect(() => {
    if (!FEATURE_GUIDED_UI || !modalOpen) return;
    if (!modalRec?.standard) return;
    if (tourStore.hasSeen(AUTHORITY_CHIP_NUDGE_ID)) return;
    setAuthorityNudge({ armed: true, findingId: modalFinding?.id ?? null });
    tourStore.markSeen(AUTHORITY_CHIP_NUDGE_ID);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, modalFinding?.id, modalRec?.standard]);

  const showAuthorityRing =
    authorityNudge.armed && authorityNudge.findingId === modalFinding?.id && !isFlipped;

  const MODAL_TABS: [BottomTab, string][] = [
    ["details", "Overview"],
    ["fix", "Suggested Fix"],
    ["chain", "Call Chain"],
    ["references", "References"],
  ];

  return (
    <>
    <div className="flex h-full min-w-0 flex-col overflow-hidden" style={{ background: "#0d1117" }}>
      {/* File header row */}
      <div className="flex shrink-0 items-start justify-between gap-3 border-b px-5 py-3" style={{ borderColor: "#21262d" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg" style={{ background: "#161b22" }}>
              {languageIcon(node.name)}
            </span>
            <h2 className="truncate text-lg font-bold text-white">{node.name}</h2>
            <button
              type="button"
              onClick={() => copyToClipboard(node.name, () => { setCopiedName(true); setTimeout(() => setCopiedName(false), 1500); })}
              title="Copy filename"
              className="shrink-0"
              style={{ color: "#8b949e" }}
            >
              {copiedName ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "#8b949e" }}>
            <span>Path:</span>
            <span className="font-mono truncate" style={{ color: "#3b82f6" }} title={relPath}>
              {relPath}
            </span>
            <span style={{ color: "#30363d" }}>│</span>
            <span style={{ color: "#3b82f6" }}>{sortedFindings.length} findings</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleOpenRaw}
            disabled={sourceCode === null}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: "#30363d" }}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            Open in new tab
          </button>
          <button
            type="button"
            onClick={() => setRawMode((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/5"
            style={{ borderColor: rawMode ? "#3b82f6" : "#30363d" }}
          >
            <Code2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            View Raw
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Code panel */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex h-10 shrink-0 items-center justify-between border-b px-3" style={{ borderColor: "#21262d" }}>
              <div className="flex items-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => setCodeTab("code")}
                  className="border-b-2 pb-2 pt-2 font-medium"
                  style={{ borderColor: codeTab === "code" ? "#3b82f6" : "transparent", color: codeTab === "code" ? "#ffffff" : "#8b949e" }}
                >
                  Code
                </button>
                <button
                  type="button"
                  onClick={() => setCodeTab("info")}
                  className="border-b-2 pb-2 pt-2 font-medium"
                  style={{ borderColor: codeTab === "info" ? "#3b82f6" : "transparent", color: codeTab === "info" ? "#ffffff" : "#8b949e" }}
                >
                  File Info
                </button>
              </div>
              {sortedFindings.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: "#ef4444" }}>
                    {sortedFindings.length} findings
                  </span>
                  <div className="flex items-center gap-1 text-xs" style={{ color: "#8b949e" }}>
                    <button
                      type="button"
                      onClick={() => setSelectedIndex((i) => (i > 0 ? i - 1 : sortedFindings.length - 1))}
                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-white/5"
                      aria-label="Previous finding"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <span className="tabular-nums">
                      {selectedIndex + 1}/{sortedFindings.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedIndex((i) => (i < sortedFindings.length - 1 ? i + 1 : 0))}
                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-white/5"
                      aria-label="Next finding"
                    >
                      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {codeTab === "info" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5 text-xs" style={{ color: "#c9d1d9" }}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <dt className="uppercase" style={{ color: "#6e7681", fontSize: 10 }}>Language</dt>
                    <dd className="mt-0.5">{languageName(node.name)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase" style={{ color: "#6e7681", fontSize: 10 }}>Lines</dt>
                    <dd className="mt-0.5 tabular-nums">{lines.length}</dd>
                  </div>
                  <div>
                    <dt className="uppercase" style={{ color: "#6e7681", fontSize: 10 }}>Findings</dt>
                    <dd className="mt-0.5 tabular-nums">{sortedFindings.length}</dd>
                  </div>
                  <div>
                    <dt className="uppercase" style={{ color: "#6e7681", fontSize: 10 }}>Source</dt>
                    <dd className="mt-0.5">{sourceIsFallback ? "Reconstructed from evidence" : "Local scan engine"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="uppercase" style={{ color: "#6e7681", fontSize: 10 }}>Path</dt>
                    <dd className="mt-0.5 break-all font-mono">{relPath}</dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div ref={codeScrollRef} className="relative min-h-0 flex-1 overflow-auto font-mono text-xs" style={{ background: "#0d1117" }}>
                {loading ? (
                  <div className="flex h-full items-center justify-center p-8" style={{ color: "#8b949e" }}>
                    Loading source code…
                  </div>
                ) : rawMode ? (
                  <pre className="whitespace-pre p-4" style={{ color: "#c9d1d9" }}>
                    {sourceCode}
                  </pre>
                ) : (
                  <div className="min-w-full inline-block py-1">
                    {sourceIsFallback && (
                      <div className="sticky top-0 z-10 mb-1 px-3 py-1.5 text-[11px]" style={{ background: "rgba(210,153,34,0.12)", color: "#d29922" }}>
                        Source unavailable — showing finding context only.
                      </div>
                    )}
                    {lines.map((codeLine, idx) => {
                      const lineNum = idx + 1;
                      const findingsOnLine = lineToFindings.get(lineNum);
                      const primaryFinding = findingsOnLine?.[0];
                      const occ = selectedFinding ? getFindingOccurrenceInFile(selectedFinding, node) : undefined;
                      const isSelectedLine = occ?.line === lineNum;
                      const tier = primaryFinding ? severityTier(primaryFinding) : undefined;
                      const bgTint =
                        tier === "high" ? "rgba(239,68,68,0.15)" : tier === "medium" ? "rgba(245,158,11,0.15)" : undefined;
                      const statusInfo = primaryFinding ? quantumStatusText(primaryFinding) : undefined;
                      const reachInfo = primaryFinding ? reachabilityText(primaryFinding) : undefined;

                      return (
                        <div
                          key={lineNum}
                          ref={(el) => {
                            if (el) lineRefs.current.set(lineNum, el);
                            else lineRefs.current.delete(lineNum);
                          }}
                          onClick={() => primaryFinding && selectByFindingId(primaryFinding.id)}
                          className="flex items-start leading-5 cursor-default"
                          style={{
                            background: isSelectedLine ? "rgba(59,130,246,0.12)" : bgTint,
                            borderLeft: isSelectedLine ? "2px solid #3b82f6" : "2px solid transparent",
                          }}
                        >
                          <div className="group relative flex h-5 w-2 shrink-0 items-center justify-center">
                            {primaryFinding && (
                              <>
                                <span
                                  ref={lineNum === firstFindingLine ? firstGutterRef : undefined}
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{ background: getDotColor(primaryFinding.quantumStatus) }}
                                />
                                <div
                                  className="pointer-events-none absolute left-4 top-1/2 z-20 hidden w-64 -translate-y-1/2 rounded-lg border p-3 text-xs shadow-lg group-hover:block"
                                  style={{ background: "#0d1a2e", borderColor: "#21262d" }}
                                >
                                  <div className="font-semibold text-white">{displayName(primaryFinding)}</div>
                                  <div className="mt-1 font-medium" style={{ color: "#ef4444" }}>
                                    {statusInfo?.text}
                                  </div>
                                  <p className="mt-1 leading-relaxed" style={{ color: "#8b949e" }}>
                                    {getRecommendationForFinding(primaryFinding, codeLine).vulnerabilityReason}
                                  </p>
                                  <div className="mt-1.5" style={{ color: "#8b949e" }}>
                                    Reachability:{" "}
                                    <span style={{ color: reachInfo?.color }}>{reachInfo?.text}</span>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                          <div className="w-10 shrink-0 select-none pr-3 text-right" style={{ color: "#484f58" }}>
                            {lineNum}
                          </div>
                          <div className="min-w-0 flex-1 whitespace-pre pr-4" style={{ color: "#c9d1d9" }}>
                            {renderSyntax(codeLine)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px]" style={{ background: "#161b22", borderColor: "#21262d", color: "#8b949e" }}>
              <span>{languageName(node.name)}</span>
              <span>
                Ln {selectedFinding ? getFindingOccurrenceInFile(selectedFinding, node)?.line ?? "—" : "—"}
                {selectedFinding?.evidence[0]?.column !== undefined ? `, Col ${selectedFinding.evidence[0].column}` : ""}
              </span>
              <span>UTF-8</span>
            </div>
          </div>

          <ResizableDivider onResize={handleDetailResize} />

          {/* Right: Detail Panel — findings list (upper) + finding detail (lower) */}
          <div className="flex h-full shrink-0 flex-col overflow-hidden" style={{ width: detailWidth, background: "#0d1117" }}>
            {/* Findings in this file - extended to full height */}
            <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
              {/* Header with title, count badge, and aligned Sort control */}
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "#21262d", background: "#161b22" }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold uppercase tracking-wider text-white">Findings in this file</span>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-sm" style={{ background: "#3b82f6" }}>
                    {sortedFindings.length}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 text-xs" style={{ color: "#8b949e" }}>
                  <span className="text-[11px]">Sort:</span>
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as "line" | "priority")}
                    className="rounded border bg-[#0d1117] px-2 py-1 text-xs text-white focus:outline-none focus:border-[#3b82f6]"
                    style={{ borderColor: "#30363d" }}
                  >
                    <option value="line" style={{ color: "#fff", background: "#161b22" }}>Line number</option>
                    <option value="priority" style={{ color: "#fff", background: "#161b22" }}>Priority</option>
                  </select>
                </div>
              </div>

              {/* Finding list cards */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {sortedForList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center" style={{ color: "#6e7681" }}>
                    <Check className="mb-2 h-6 w-6 text-emerald-500" strokeWidth={1.5} />
                    <p className="text-xs font-medium text-white">No findings in this file</p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "#8b949e" }}>
                      All cryptographic implementations are safe or no findings detected.
                    </p>
                  </div>
                ) : (
                  sortedForList.map((f) => {
                    const occ = getFindingOccurrenceInFile(f, node);
                    const isSelected = selectedFinding?.id === f.id;
                    const rec = getRecommendationForFinding(f, occ?.snippet ?? "");
                    const accentColor = getDotColor(f.quantumStatus);

                    const sortedIdx = sortedForList.indexOf(f);
                    return (
                      <div
                        key={f.id}
                        className="border-b"
                        style={{
                          borderColor: "#21262d",
                          borderLeft: isSelected ? `3px solid ${accentColor}` : "3px solid transparent",
                          background: isSelected ? "rgba(59,130,246,0.10)" : "transparent",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => selectByFindingId(f.id)}
                          className="group flex w-full items-start gap-2.5 px-3.5 pt-3 pb-1.5 text-left transition-colors"
                          style={isSelected ? {} : {}}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.closest('div')!.style.background = "#1c2128";
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) (e.currentTarget.closest('div') as HTMLElement)!.style.background = "transparent";
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${getSeverityStyle(f.quantumStatus)}`}
                              >
                                {quantumStatusText(f).text}
                              </span>
                              <span className="truncate text-xs font-bold text-white min-w-0">
                                {displayName(f)}
                              </span>
                              <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: "#8b949e" }}>
                                Line {occ?.line ?? "—"}
                              </span>
                            </div>
                            <p
                              className="mt-1.5 text-xs leading-relaxed"
                              style={{
                                color: isSelected ? "#c9d1d9" : "#8b949e",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {rec.vulnerabilityReason}
                            </p>
                            {reviewed.has(f.id) && (
                              <div className="mt-1 flex items-center gap-1 text-[10px] font-medium text-emerald-400">
                                <span>✓ Reviewed</span>
                              </div>
                            )}
                          </div>
                        </button>
                        {/* View Analysis CTA — prominent green button always visible */}
                        <div className="flex items-center gap-2 px-3.5 pb-3">
                          <button
                            ref={sortedIdx === 0 ? firstViewAnalysisRef : undefined}
                            type="button"
                            onClick={() => openModal(sortedIdx)}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[11px] font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98]"
                            style={{
                              background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
                              boxShadow: "0 1px 6px rgba(22,163,74,0.35)",
                            }}
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                            View Analysis
                          </button>
                          <button
                            type="button"
                            onClick={() => setReviewed((prev) => {
                              const next = new Set(prev);
                              if (next.has(f.id)) next.delete(f.id);
                              else next.add(f.id);
                              return next;
                            })}
                            className="flex items-center gap-1 shrink-0 rounded-md border px-2 py-1.5 text-[10px] font-semibold transition-colors"
                            style={{
                              background: reviewed.has(f.id) ? "rgba(34,197,94,0.12)" : "transparent",
                              borderColor: reviewed.has(f.id) ? "rgba(34,197,94,0.4)" : "#30363d",
                              color: reviewed.has(f.id) ? "#4ade80" : "#8b949e",
                            }}
                            title={reviewed.has(f.id) ? "Unmark" : "Mark reviewed"}
                          >
                            <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                            {reviewed.has(f.id) ? "Done" : "Review"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
    </div>

      {/* ======= FINDING ANALYSIS MODAL ======= */}
      {modalOpen && modalFinding && modalRec && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(6px)" }}
            onClick={() => setModalOpen(false)}
          >
            <div
              className="relative flex flex-col rounded-2xl shadow-2xl overflow-hidden"
              style={{
                background: "#0d1117",
                border: `1px solid ${accentCol}55`,
                width: "min(780px, 96vw)",
                maxHeight: "90vh",
                boxShadow: `0 0 0 1px ${accentCol}22, 0 24px 80px rgba(0,0,0,0.7)`,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div
                className="flex shrink-0 items-start justify-between gap-3 px-6 py-4 border-b"
                style={{ borderColor: "#21262d", background: "#161b22" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getSeverityStyle(modalFinding.quantumStatus)}`}
                    >
                      {quantumStatusText(modalFinding).text}
                    </span>
                    <h2 className="text-base font-bold text-white truncate">
                      {displayName(modalFinding)}
                    </h2>
                    <span className="font-mono text-xs shrink-0" style={{ color: "#8b949e" }}>
                      Line {modalOcc?.line ?? "—"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs truncate" style={{ color: "#8b949e" }}>
                    {node.name} — {categoryLabel(modalFinding)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Prev / Next finding navigation */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => navigateToFinding(modalIndex - 1)}
                      disabled={modalIndex === 0}
                      className="flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-30 cursor-pointer"
                      style={{ borderColor: "#30363d", background: "#0d1117", color: "#c9d1d9" }}
                      title="Previous finding"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    <span className="text-[11px] font-mono px-1" style={{ color: "#8b949e" }}>
                      {modalIndex + 1}/{total}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigateToFinding(modalIndex + 1)}
                      disabled={modalIndex === total - 1}
                      className="flex h-7 w-7 items-center justify-center rounded-md border transition-colors disabled:opacity-30 cursor-pointer"
                      style={{ borderColor: "#30363d", background: "#0d1117", color: "#c9d1d9" }}
                      title="Next finding"
                    >
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-white/5 cursor-pointer"
                    style={{ borderColor: "#30363d", color: "#8b949e" }}
                    title="Close"
                  >
                    <X className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              </div>

              {/* Finding mini-nav strip (clickable pills) */}
              {total > 1 && (
                <div
                  className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-6 py-2 border-b"
                  style={{ borderColor: "#21262d", background: "#0d1117" }}
                >
                  {sortedForList.map((ff, idx) => (
                    <button
                      key={ff.id}
                      type="button"
                      onClick={() => navigateToFinding(idx)}
                      className="shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-all cursor-pointer"
                      style={{
                        borderColor: idx === modalIndex ? accentCol : "#30363d",
                        background: idx === modalIndex ? `${accentCol}22` : "transparent",
                        color: idx === modalIndex ? accentCol : "#8b949e",
                      }}
                    >
                      {displayName(ff)}
                    </button>
                  ))}
                </div>
              )}

              {/* Tab bar */}
              <div
                className="flex shrink-0 items-center gap-1.5 border-b px-6 py-2 overflow-x-auto"
                style={{ borderColor: "#21262d", background: "#161b22" }}
              >
                {MODAL_TABS.map(([id, label]) => (
                  <button
                    key={id}
                    ref={(el) => {
                      if (id === "fix") tabFixRef.current = el;
                      else if (id === "chain") tabChainRef.current = el;
                      else if (id === "references") tabRefsRef.current = el;
                    }}
                    type="button"
                    onClick={() => setModalTab(id)}
                    className={`shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      modalTab === id
                        ? "bg-[#22c55e] text-white shadow"
                        : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setReviewed((prev) => {
                    const next = new Set(prev);
                    if (next.has(modalFinding.id)) next.delete(modalFinding.id);
                    else next.add(modalFinding.id);
                    return next;
                  })}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors"
                  style={{
                    background: reviewed.has(modalFinding.id) ? "rgba(34,197,94,0.15)" : "#21262d",
                    borderColor: reviewed.has(modalFinding.id) ? "rgba(34,197,94,0.4)" : "#30363d",
                    color: reviewed.has(modalFinding.id) ? "#4ade80" : "#c9d1d9",
                  }}
                >
                  {reviewed.has(modalFinding.id) ? "✓ Reviewed" : "Mark as reviewed"}
                </button>
              </div>

              {/* Tab content */}
              <div className="min-h-0 flex-1 overflow-y-auto p-6" style={{ background: "#0d1117" }}>

                {/* Overview tab */}
                <div
                  style={{
                    display: !FEATURE_GUIDED_UI ? (modalTab === "details" ? "block" : "none") : (modalTab === "details" ? "block" : "none"),
                  }}
                  className="space-y-5"
                >
                  {/* Summary row */}
                  <div
                    className={`grid gap-3 ${
                      FEATURE_GUIDED_UI
                        ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                        : "grid-cols-2 sm:grid-cols-4"
                    }`}
                  >
                    {[
                      { label: "Algorithm", value: displayName(modalFinding), color: "#f0f6fc" },
                      { label: "Category", value: categoryLabel(modalFinding), color: "#f0f6fc" },
                      { label: "Quantum Status", value: quantumStatusText(modalFinding).text, color: quantumStatusText(modalFinding).color },
                      { label: "Reachability", value: reachabilityText(modalFinding).text, color: reachabilityText(modalFinding).color },
                      ...(FEATURE_GUIDED_UI
                        ? [{ label: "Replace With", value: modalRec.recommendedAlgorithm, color: "#f0f6fc" }]
                        : []),
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-xl border p-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
                        <div className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: "#6e7681" }}>{label}</div>
                        <div className="mt-1 text-sm font-bold truncate" style={{ color }}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Description */}
                  <div className="rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#161b22" }}>
                    <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "#8b949e" }}>Why it matters</div>
                    <p className="text-sm leading-relaxed" style={{ color: "#c9d1d9" }}>
                      {modalRec.vulnerabilityReason}
                    </p>
                    {modalRec.migrationNote && (
                      <p className="mt-2 text-xs leading-relaxed" style={{ color: "#8b949e" }}>
                        {modalRec.migrationNote}
                      </p>
                    )}
                  </div>

                  {/* Recommendation summary — Fix Stage when FEATURE_GUIDED_UI, or original block when disabled */}
                  {!FEATURE_GUIDED_UI ? (
                    <div className="rounded-xl border p-4" style={{ borderColor: "rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.06)" }}>
                      <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: "#22c55e" }}>Recommended Action</div>
                      <div className="flex items-center gap-3 text-sm">
                        <div>
                          <span className="text-[10px] uppercase tracking-wide block mb-0.5" style={{ color: "#8b949e" }}>Replace</span>
                          <span className="font-semibold text-white">{displayName(modalFinding)}</span>
                        </div>
                        <div style={{ color: "#8b949e" }}>→</div>
                        <div>
                          <span className="text-[10px] uppercase tracking-wide block mb-0.5" style={{ color: "#8b949e" }}>With</span>
                          <span className="font-bold" style={{ color: "#22c55e" }}>{modalRec.recommendedAlgorithm}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-xs" style={{ color: "#8b949e" }}>Standard: <span style={{ color: "#3b82f6" }}>{modalRec.standard}</span></div>
                    </div>
                  ) : (
                    <FixStage
                      finding={modalFinding}
                      rec={modalRec}
                      isFlipped={isFlipped}
                      isFlippingBack={isFlippingBack}
                      setIsFlipped={setIsFlipped}
                      slideTransition={slideTransition}
                      navDirection={navDirection}
                      showAuthorityRing={showAuthorityRing}
                      isDarkTheme={isDarkTheme}
                      reducedMotion={reducedMotion}
                      isCollapsed={isCollapsed}
                      setIsCollapsed={setIsCollapsed}
                    />
                  )}
                </div>

                {/* Suggested Fix tab */}
                <div
                  style={{
                    display: modalTab === "fix" ? "block" : "none",
                  }}
                  className="space-y-4"
                >
                  {/* Vulnerable snippet */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "#ef4444" }}>⚠ Vulnerable Code (Line {modalOcc?.line ?? "—"})</span>
                    </div>
                    <pre
                      className="rounded-xl border p-4 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap"
                      style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#fca5a5" }}
                    >
                      {modalOcc?.snippet ?? lines[(modalOcc?.line ?? 1) - 1] ?? "— snippet unavailable —"}
                    </pre>
                  </div>

                  {/* Replacement */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "#22c55e" }}>✓ Proposed Replacement — {modalRec.recommendedAlgorithm}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(modalRec.replacementCode, () => { setModalCopiedId(modalFinding.id); setTimeout(() => setModalCopiedId(null), 1800); })}
                        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-white/5"
                        style={{ borderColor: "#30363d", color: modalCopiedId === modalFinding.id ? "#22c55e" : "#c9d1d9" }}
                      >
                        {modalCopiedId === modalFinding.id ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Copy className="h-3 w-3" strokeWidth={2} />}
                        {modalCopiedId === modalFinding.id ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <pre
                      className="rounded-xl border p-4 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap"
                      style={{ borderColor: "rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.06)", color: "#86efac" }}
                    >
                      {modalRec.replacementCode}
                    </pre>
                    {modalRec.migrationNote && (
                      <p className="mt-2 text-xs leading-relaxed" style={{ color: "#8b949e" }}>{modalRec.migrationNote}</p>
                    )}
                  </div>

                  {/* Copy all button */}
                  <button
                    type="button"
                    onClick={() => copyToClipboard(modalRec.replacementCode, () => { setModalCopiedId(modalFinding.id + "_all"); setTimeout(() => setModalCopiedId(null), 1800); })}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:brightness-110 active:scale-[0.98]"
                    style={{ background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)", boxShadow: "0 4px 12px rgba(22,163,74,0.3)" }}
                  >
                    <Copy className="h-4 w-4" strokeWidth={2} />
                    {modalCopiedId === modalFinding.id + "_all" ? "Copied to clipboard!" : "Copy Replacement Code"}
                  </button>
                </div>

                {/* Call Chain tab */}
                <div
                  style={{
                    display: modalTab === "chain" ? "block" : "none",
                  }}
                  className="space-y-4 text-sm"
                >
                  {(modalFinding.callRelation?.callers?.length ?? 0) === 0 && (modalFinding.callRelation?.callees?.length ?? 0) === 0 ? (
                    <p className="text-sm" style={{ color: "#8b949e" }}>No call-graph relationships recorded for this finding.</p>
                  ) : (
                    <>
                      {(modalFinding.callRelation?.callers?.length ?? 0) > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "#6e7681" }}>Called by</div>
                          <div className="space-y-1.5">
                            {modalFinding.callRelation!.callers.map((id) => (
                              <div key={id} className="rounded-lg border px-3 py-2" style={{ borderColor: "#21262d", background: "#161b22", color: "#c9d1d9" }}>
                                {findingsById.get(id) ? displayName(findingsById.get(id)!) : id}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(modalFinding.callRelation?.callees?.length ?? 0) > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "#6e7681" }}>Calls</div>
                          <div className="space-y-1.5">
                            {modalFinding.callRelation!.callees.map((id) => (
                              <div key={id} className="rounded-lg border px-3 py-2" style={{ borderColor: "#21262d", background: "#161b22", color: "#c9d1d9" }}>
                                {findingsById.get(id) ? displayName(findingsById.get(id)!) : id}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* References tab */}
                <div
                  style={{
                    display: modalTab === "references" ? "block" : "none",
                  }}
                  className="space-y-3 text-sm"
                >
                  {modalFinding.shelfLife.length === 0 ? (
                    <p style={{ color: "#8b949e" }}>No statutory or shelf-life reference data for this finding.</p>
                  ) : (
                    modalFinding.shelfLife.map((s, i) => (
                      <div key={i} className="rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#161b22" }}>
                        <div className="font-bold text-white">{s.category}</div>
                        {s.shelfLifeYears !== undefined && <div className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>Shelf life: {s.shelfLifeYears} years</div>}
                        {s.statutoryBasis && <div className="text-xs" style={{ color: "#8b949e" }}>Basis: {s.statutoryBasis}</div>}
                        {s.confidence && <div className="text-xs" style={{ color: "#8b949e" }}>Confidence: {s.confidence}</div>}
                        {s.moscaNote && <div className="mt-1.5 text-xs leading-relaxed" style={{ color: "#c9d1d9" }}>{s.moscaNote}</div>}
                      </div>
                    ))
                  )}
                  <div className="rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#161b22" }}>
                    <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "#6e7681" }}>Standard</div>
                    <p style={{ color: "#c9d1d9" }}>{modalRec.standard}</p>
                  </div>
                </div>

              </div>

              {/* Modal footer */}
              <div
                className="flex shrink-0 items-center justify-between border-t px-6 py-3"
                style={{ borderColor: "#21262d", background: "#161b22" }}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigateToFinding(modalIndex - 1)}
                    disabled={modalIndex === 0}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-30 hover:bg-white/5 cursor-pointer"
                    style={{ borderColor: "#30363d", color: "#c9d1d9" }}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateToFinding(modalIndex + 1)}
                    disabled={modalIndex === total - 1}
                    className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-30 hover:bg-white/5 cursor-pointer"
                    style={{ borderColor: "#30363d", color: "#c9d1d9" }}
                  >
                    Next
                    <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/5"
                  style={{ borderColor: "#30363d" }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

      {FEATURE_GUIDED_UI && showGutterStep && gutterReady && (
        <Coachmark
          id={STEP_GUTTER}
          anchorRef={firstGutterRef}
          placement="right"
          title="Flagged lines"
          body={gutterBodyCopy}
          step={[1, 2]}
          nextLabel="Next →"
          skipLabel="Skip tour"
          onNext={() => tourStore.nextStep()}
          onSkip={() => {
            tourStore.markSeen(FILE_GUTTER_DOT_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}

      {FEATURE_GUIDED_UI && showAnalysisStep && (
        <Coachmark
          id={STEP_ANALYSIS}
          anchorRef={firstViewAnalysisRef}
          placement="left"
          title="Open the analysis"
          body="Why it's broken, what replaces it, and which standard says so."
          step={[2, 2]}
          nextLabel="Open"
          skipLabel="Skip tour"
          onNext={() => {
            firstViewAnalysisRef.current?.click();
            tourStore.handoffTour(FINDING_TABS_TOUR_ID, TAB_STEP_IDS);
          }}
          onSkip={() => {
            tourStore.markSeen(FILE_GUTTER_DOT_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}

      {FEATURE_GUIDED_UI && modalOpen && tourStore.getSnapshot().activeTour === FINDING_TABS_TOUR_ID && tabTourStepInfo && (
        <Coachmark
          id={tabTourStepInfo.stepId}
          anchorRef={tabTourStepInfo.anchorRef}
          placement="bottom"
          title={tabTourStepInfo.title}
          body={tabTourStepInfo.body}
          step={[tabTourStepInfo.stepN, 4]}
          nextLabel={tabTourStepInfo.stepN === 4 ? "Done" : "Next →"}
          skipLabel="Skip tour"
          onNext={() => {
            if (tabTourStepInfo.stepN === 4) {
              tourStore.markSeen(FINDING_TABS_TOUR_ID);
              tourStore.endTour();
            } else {
              setModalTab(tabTourStepInfo.nextTabId);
            }
          }}
          onSkip={() => {
            tourStore.markSeen(FINDING_TABS_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}
    </>
  );
}
