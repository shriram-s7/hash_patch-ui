import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, type EvidenceOccurrence, type Finding } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { compareFindingsPriority, computePriorityScore } from "./priority";
import { buildRepositoryTree, normalizeLocation, type TreeNode } from "./repositoryTree";
import {
  FileWorkspace,
  renderSyntax,
  languageIcon,
  languageName,
  findRealFilePathForNode,
  reconstructSourceFromEvidence,
  getSeverityStyle,
} from "./FileWorkspace";
import { ResizableDivider } from "./components/ResizableDivider";
import { SERVICE_BASE_URL } from "./serviceUrl";
import type { NavItem } from "./AppShell";
import {
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Grid2x2,
  List as ListIcon,
  RotateCw,
  MoreHorizontal,
  History,
  Download,
  Clipboard,
  Trash2,
} from "lucide-react";
import { handleExportCBOM } from "./cbomExport";
import { ScanHistoryModal } from "./ScanHistoryModal";
import { Coachmark } from "./tour/Coachmark";
import { useTourStep } from "./tour/useTourStep";
import { tourStore } from "./tour/store";
import { DUR_FAST } from "./tour/motionTokens";

const OPEN_IN_EDITOR_TOUR_ID = "repo.open-in-editor";

const TREE_WIDTH_KEY = "repo-tree-width";
const TREE_WIDTH_DEFAULT = 260;
const TREE_WIDTH_MIN = 160;
const TREE_WIDTH_MAX = 400;

// The immersive full file view reuses this same tree panel (there's no
// separate file-tree component to duplicate), but gets its own persisted
// width -- it's a different layout mode (no sidebar, three even panels)
// from the folder browser, so a shared width would jump oddly when
// switching between browsing a folder and opening a file.
const FILE_VIEW_TREE_WIDTH_KEY = "file-view-tree-width";
const FILE_VIEW_TREE_WIDTH_DEFAULT = 220;
const FILE_VIEW_TREE_WIDTH_MIN = 160;
const FILE_VIEW_TREE_WIDTH_MAX = 360;

const OVERVIEW_SPLIT_KEY = "repo-overview-split";
const OVERVIEW_SPLIT_DEFAULT = 460;
const OVERVIEW_SPLIT_MIN = 300;

type FolderTab = "Overview" | "Files" | "Findings" | "Visualize" | "Dependencies";
const FOLDER_TABS: FolderTab[] = ["Overview", "Files", "Findings", "Visualize", "Dependencies"];

interface RepositoryViewProps {
  sourceName: string;
  findings: Finding[];
  scannedFiles?: string[];
  timestamp?: string;
  onNavigate?: (nav: NavItem) => void;
  onRescan?: () => void;
  isRescanning?: boolean;
  /** Fires whenever the full file view (FileWorkspace, i.e. a file rather
   * than a folder is selected) opens or closes, so App.tsx can hide the
   * global sidebar for the immersive layout. */
  onImmersiveChange?: (active: boolean) => void;
  rawCbomText?: string;
  onClearScan?: () => void;
  onLoadScan?: (target: string) => void;
}

/** All file (non-folder) descendants of a node, flattened depth-first. */
function collectFiles(node: TreeNode): TreeNode[] {
  if (!node.isFolder) return [node];
  return node.children.flatMap(collectFiles);
}

/** Count of folder descendants (excluding the node itself). */
function countSubfolders(node: TreeNode): number {
  let count = 0;
  for (const child of node.children) {
    if (child.isFolder) count += 1 + countSubfolders(child);
  }
  return count;
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return "recently";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "recently";
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

/** Red/amber/blue severity badge matching the finding-count colors used
 * throughout the new file-tree panel: red when the subtree contains any
 * broken-by-shor finding, amber for weakened-by-grover, blue otherwise. */
function findingCountBadge(counts: TreeNode["counts"], total: number) {
  if (total === 0) return null;
  const color = counts.shor > 0 ? "#ef4444" : counts.grover > 0 || counts.classic > 0 ? "#f59e0b" : "#3b82f6";
  return (
    <span
      className="inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
      style={{ background: color }}
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

export function RepositoryView({
  sourceName,
  findings,
  scannedFiles,
  timestamp,
  onNavigate,
  onRescan,
  isRescanning,
  onImmersiveChange,
  rawCbomText,
  onClearScan,
  onLoadScan,
}: RepositoryViewProps) {
  const tree = useMemo(
    () => buildRepositoryTree(findings, sourceName, scannedFiles),
    [findings, sourceName, scannedFiles]
  );

  const [pathFilter, setPathFilter] = useState("");
  const [showOnlyFindings, setShowOnlyFindings] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  function confirmAndClearScan() {
    if (window.confirm(`Clear the current scan results for "${sourceName}"? This cannot be undone.`)) {
      onClearScan?.();
    }
  }

  const menuItems = [
    { label: "View scan history", icon: History, onClick: () => setHistoryOpen(true), danger: false },
    { label: "Export raw CBOM JSON", icon: Download, onClick: () => handleExportCBOM(rawCbomText), danger: false },
    { label: "Copy target path", icon: Clipboard, onClick: () => void navigator.clipboard.writeText(sourceName), danger: false },
    { label: "Delete scan / clear results", icon: Trash2, onClick: confirmAndClearScan, danger: true },
  ];

  const [treeWidth, setTreeWidth] = useState(() => {
    const saved = localStorage.getItem(TREE_WIDTH_KEY);
    return saved ? parseInt(saved) : TREE_WIDTH_DEFAULT;
  });

  const handleTreeResize = (delta: number) => {
    if (delta === 0) {
      setTreeWidth(TREE_WIDTH_DEFAULT);
      localStorage.removeItem(TREE_WIDTH_KEY);
      return;
    }
    setTreeWidth((w) => {
      const next = Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, w + delta));
      localStorage.setItem(TREE_WIDTH_KEY, String(next));
      return next;
    });
  };

  const [fileViewTreeWidth, setFileViewTreeWidth] = useState(() => {
    const saved = localStorage.getItem(FILE_VIEW_TREE_WIDTH_KEY);
    return saved ? parseInt(saved) : FILE_VIEW_TREE_WIDTH_DEFAULT;
  });

  const handleFileViewTreeResize = (delta: number) => {
    if (delta === 0) {
      setFileViewTreeWidth(FILE_VIEW_TREE_WIDTH_DEFAULT);
      localStorage.removeItem(FILE_VIEW_TREE_WIDTH_KEY);
      return;
    }
    setFileViewTreeWidth((w) => {
      const next = Math.min(FILE_VIEW_TREE_WIDTH_MAX, Math.max(FILE_VIEW_TREE_WIDTH_MIN, w + delta));
      localStorage.setItem(FILE_VIEW_TREE_WIDTH_KEY, String(next));
      return next;
    });
  };

  const [splitWidth, setSplitWidth] = useState(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(OVERVIEW_SPLIT_KEY) : null;
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : OVERVIEW_SPLIT_DEFAULT;
  });

  // Collapsed by default to depth 1: root (depth 0) expanded, its depth-1 children collapsed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set([tree.id]));
  const [selectedNode, setSelectedNode] = useState<TreeNode>(tree);
  const [folderTab, setFolderTab] = useState<FolderTab>("Overview");
  const [previewFile, setPreviewFile] = useState<TreeNode | null>(null);
  const [dirView, setDirView] = useState<"list" | "grid">("list");

  useEffect(() => {
    setFolderTab("Overview");
    setPreviewFile(null);
  }, [selectedNode.id]);

  useEffect(() => {
    onImmersiveChange?.(!selectedNode.isFolder);
    // Navigating away from Repository entirely is handled by App.tsx gating
    // on activeNav, but if this component itself unmounts while a file is
    // open, don't leave the sidebar hidden behind.
    return () => onImmersiveChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode.isFolder]);

  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!previewFile) {
      setPreviewSource(null);
      return;
    }
    let active = true;
    setPreviewLoading(true);

    async function load() {
      const file = previewFile!;
      const filePath = findRealFilePathForNode(file, file.findings);
      if (sourceName && filePath) {
        try {
          const url = `${SERVICE_BASE_URL}/api/file-content?path=${encodeURIComponent(filePath)}&root=${encodeURIComponent(sourceName)}`;
          const res = await fetch(url);
          if (res.ok) {
            const body = (await res.json()) as { content: string };
            if (active) {
              setPreviewSource(body.content);
              setPreviewLoading(false);
            }
            return;
          }
        } catch {
          // fall through
        }
      }
      if (active) {
        setPreviewSource(reconstructSourceFromEvidence(file.name, file.findings));
        setPreviewLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [previewFile, sourceName]);

  // Guided-discovery: the file-detail panel's "Open in Editor" button. New
  // ref + new listeners only -- the button's existing onClick/onMouseEnter/
  // onMouseLeave below are untouched.
  const openInEditorRef = useRef<HTMLButtonElement>(null);
  const showOpenInEditorTip = useTourStep(OPEN_IN_EDITOR_TOUR_ID);

  // First time a file is selected and this panel renders, auto-start the
  // one-step tip -- but only if it hasn't been seen and nothing else is
  // already running (never stomp another active tour).
  useEffect(() => {
    if (!previewFile) return;
    if (tourStore.hasSeen(OPEN_IN_EDITOR_TOUR_ID)) return;
    if (tourStore.getSnapshot().activeTour) return;
    tourStore.startTour(OPEN_IN_EDITOR_TOUR_ID, [OPEN_IN_EDITOR_TOUR_ID]);
  }, [previewFile]);

  // hasSeen must be set the moment the button is clicked by ANY path --
  // including a normal user click that never saw the tip -- so this listens
  // on the DOM node directly rather than going through the tip's onNext.
  useEffect(() => {
    const el = openInEditorRef.current;
    if (!el) return;
    const onRealClick = () => tourStore.markSeen(OPEN_IN_EDITOR_TOUR_ID);
    el.addEventListener("click", onRealClick);
    return () => el.removeEventListener("click", onRealClick);
  }, [previewFile]);

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

  const handleTreeNodeClick = (node: TreeNode) => {
    if (!node.isFolder && selectedNode.isFolder && folderTab === "Overview") {
      setPreviewFile(node);
      return;
    }
    handleSelectNode(node);
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

  const subtreeFiles = useMemo(() => collectFiles(selectedNode), [selectedNode]);
  const subtreeSubfolderCount = useMemo(() => countSubfolders(selectedNode), [selectedNode]);

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
    const isNodeSelected = selectedNode.id === node.id;
    const isPreviewSelected =
      selectedNode.isFolder && folderTab === "Overview" && !node.isFolder && previewFile?.id === node.id;
    const isSelected = isNodeSelected || isPreviewSelected;
    const isDimmed = node.totalFindings === 0;

    return (
      <div key={node.id} className="select-none">
        <div
          onClick={() => handleTreeNodeClick(node)}
          style={{
            paddingLeft: `${node.depth * 14 + 10}px`,
            borderLeft: isSelected ? "2px solid #3b82f6" : "2px solid transparent",
            background: isSelected ? "rgba(59,130,246,0.1)" : "transparent",
          }}
          className={`flex items-center gap-1.5 py-1.5 pr-3 text-xs transition-colors cursor-pointer ${isDimmed ? "opacity-50" : ""}`}
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "#161b22"; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
        >
          {node.isFolder ? (
            <button
              type="button"
              onClick={(e) => toggleExpand(node, e)}
              className="flex h-4 w-4 shrink-0 items-center justify-center"
              style={{ color: "#8b949e" }}
              aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
            >
              {isExpanded ? <ChevronDown className="h-3 w-3" strokeWidth={2.5} /> : <ChevronRight className="h-3 w-3" strokeWidth={2.5} />}
            </button>
          ) : (
            <span className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}

          {node.isFolder ? (
            <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
          ) : node.findings.some((f) => f.findingType === "COMPILED_CRYPTO_ARTEFACT") ? (
            <span
              className="shrink-0 font-mono text-[9px] font-bold px-1 py-0.5 rounded-xs"
              style={{ color: "#a78bfa", background: "rgba(139,92,246,0.15)" }}
              title="Compiled Binary"
            >
              01
            </span>
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
          )}

          <span className="truncate font-mono text-xs" style={{ color: isSelected ? "#ffffff" : "#c9d1d9" }}>
            {node.name}
          </span>

          <span className="flex-1" />

          {findingCountBadge(node.counts, node.totalFindings)}
        </div>

        {node.isFolder && isExpanded && node.children.map((child) => renderTreeNode(child, selfMatched))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden text-ink" style={{ background: "#0d1117" }}>
      {/* Breadcrumb */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b px-4 text-xs overflow-x-auto whitespace-nowrap" style={{ borderColor: "#21262d" }}>
        <button
          type="button"
          onClick={() => handleSelectNode(tree)}
          className="shrink-0 font-medium transition-colors"
          style={{ color: selectedNode.id === tree.id ? "#ffffff" : "#8b949e" }}
        >
          Repository
        </button>
        {breadcrumbNodes.slice(1).map((item) => {
          const isLast = item.id === selectedNode.id;
          return (
            <div key={item.id} className="flex items-center gap-1.5 shrink-0">
              <ChevronRight className="h-3 w-3" style={{ color: "#484f58" }} strokeWidth={2} aria-hidden="true" />
              <button
                type="button"
                onClick={() => handleSelectNode(item)}
                className="transition-colors"
                style={{ color: isLast ? "#ffffff" : "#8b949e", fontWeight: isLast ? 700 : 400 }}
              >
                {item.name}
              </button>
            </div>
          );
        })}
      </div>

      {/* SPLIT CONTENT: Files tree (Panel 1) + folder summary / file workspace */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* PANEL 1: Files tree */}
        {treeOpen && (
          <div className="flex shrink-0 flex-col overflow-hidden" style={{ width: selectedNode.isFolder ? treeWidth : fileViewTreeWidth, background: "#161b22" }}>
            <div className="flex shrink-0 items-center justify-between px-3 pt-3 pb-2">
              <span className="text-sm font-bold text-white">Files</span>
              <button type="button" onClick={() => setTreeOpen(false)} title="Close" style={{ color: "#8b949e" }}>
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>

            <div className="shrink-0 px-3 pb-2 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "#6e7681" }} strokeWidth={2} aria-hidden="true" />
                <input
                  type="text"
                  value={pathFilter}
                  onChange={(e) => setPathFilter(e.target.value)}
                  placeholder="Search files..."
                  className="w-full rounded-lg border py-1.5 pl-8 pr-6 text-xs text-white placeholder:text-[#6e7681] focus:outline-none"
                  style={{ background: "#0d1117", borderColor: "#30363d" }}
                />
                {pathFilter && (
                  <button
                    type="button"
                    onClick={() => setPathFilter("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
                    style={{ color: "#8b949e" }}
                    aria-label="Clear filter"
                  >
                    ×
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowOnlyFindings((v) => !v)}
                className="w-full rounded-lg border py-1 text-[11px] font-medium transition-colors"
                style={{
                  borderColor: showOnlyFindings ? "#3b82f6" : "#30363d",
                  color: showOnlyFindings ? "#3b82f6" : "#8b949e",
                }}
              >
                {showOnlyFindings ? "Showing files with findings" : "Show only files with findings"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pb-2">{renderTreeNode(tree)}</div>
          </div>
        )}
        {treeOpen && <ResizableDivider onResize={selectedNode.isFolder ? handleTreeResize : handleFileViewTreeResize} />}
        {!treeOpen && (
          <button
            type="button"
            onClick={() => setTreeOpen(true)}
            className="flex w-6 shrink-0 items-center justify-center border-r transition-colors hover:bg-white/5"
            style={{ background: "#161b22", borderColor: "#21262d", color: "#8b949e" }}
            title="Show files"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}

        {/* MAIN: file workspace for files, folder summary for folders */}
        <div className="min-w-0 flex-1 overflow-hidden" style={{ background: "#0d1117" }}>
          {!selectedNode.isFolder ? (
            <FileWorkspace
              node={selectedNode}
              findings={selectedNode.findings}
              allFindings={findings}
              sourceName={sourceName}
            />
          ) : (
            <div className="flex h-full flex-col overflow-hidden">
              {/* Header */}
              <div className="shrink-0 border-b px-5 py-4" style={{ borderColor: "#21262d" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl" style={{ background: "#1d2d44" }}>
                      📁
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-2xl font-bold" style={{ color: "#f0f6fc" }}>{selectedNode.name}</h2>
                      <p className="mt-0.5 truncate font-mono text-sm" style={{ color: "#8b949e" }} title={selectedNode.fullPath || selectedNode.path}>
                        {selectedNode.fullPath || selectedNode.path || "/"}
                      </p>
                      <p className="mt-1.5 text-xs" style={{ color: "#8b949e" }}>
                        {subtreeFiles.length} file{subtreeFiles.length === 1 ? "" : "s"} · {subtreeSubfolderCount} subfolder{subtreeSubfolderCount === 1 ? "" : "s"} · Scanned {timeAgo(timestamp)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className="whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium"
                      style={{ background: "#0d2b1a", borderColor: "rgba(34,197,94,0.3)", color: "#22c55e" }}
                    >
                      Scan complete · {selectedNode.totalFindings} finding{selectedNode.totalFindings === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRescan?.()}
                      disabled={!onRescan || isRescanning}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ borderColor: "#30363d" }}
                    >
                      <RotateCw className={`h-3.5 w-3.5 shrink-0 ${isRescanning ? "animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />
                      Re-scan
                    </button>
                    <div className="relative" ref={menuRef}>
                      <button
                        type="button"
                        title="More options"
                        onClick={() => setMenuOpen((v) => !v)}
                        aria-expanded={menuOpen}
                        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border text-white transition-colors hover:bg-white/5"
                        style={{ borderColor: "#30363d", color: "#8b949e" }}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      </button>
                      {menuOpen && (
                        <div
                          className="absolute right-0 top-full z-20 mt-1.5 w-56 overflow-hidden rounded-lg border py-1 shadow-xl"
                          style={{ background: "#161b22", borderColor: "#21262d" }}
                        >
                          {menuItems.map(({ label, icon: Icon, onClick, danger }) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => {
                                setMenuOpen(false);
                                onClick();
                              }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-white/5"
                              style={{ color: danger ? "#ef4444" : "#c9d1d9" }}
                            >
                              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                              <span>{label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-5 text-sm">
                  {FOLDER_TABS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFolderTab(tab)}
                      className="border-b-2 pb-2 font-medium transition-colors"
                      style={{ borderColor: folderTab === tab ? "#3b82f6" : "transparent", color: folderTab === tab ? "#ffffff" : "#8b949e" }}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="min-h-0 flex-1 overflow-hidden">
                {folderTab === "Overview" && (
                  <div className="flex h-full min-h-0 overflow-hidden">
                    {/* Directory Structure (left) */}
                    <div
                      style={{ width: splitWidth, minWidth: OVERVIEW_SPLIT_MIN, flexShrink: 0 }}
                      className="flex h-full min-w-0 flex-col overflow-hidden"
                    >
                      <div className="flex shrink-0 items-center justify-between px-4 py-3">
                        <span className="text-sm font-bold text-white">Directory Structure</span>
                        <div className="flex items-center gap-1 rounded-md border p-0.5" style={{ borderColor: "#30363d" }}>
                          <button
                            type="button"
                            onClick={() => setDirView("list")}
                            title="List view"
                            className="flex h-5 w-5 items-center justify-center rounded"
                            style={{ background: dirView === "list" ? "#21262d" : "transparent", color: dirView === "list" ? "#ffffff" : "#8b949e" }}
                          >
                            <ListIcon className="h-3 w-3" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDirView("grid")}
                            title="Grid view"
                            className="flex h-5 w-5 items-center justify-center rounded"
                            style={{ background: dirView === "grid" ? "#21262d" : "transparent", color: dirView === "grid" ? "#ffffff" : "#8b949e" }}
                          >
                            <Grid2x2 className="h-3 w-3" strokeWidth={2} />
                          </button>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                        {subtreeFiles.length === 0 ? (
                          <p className="px-2 py-4 text-xs" style={{ color: "#6e7681" }}>No files in this directory.</p>
                        ) : dirView === "list" ? (
                          <div className="space-y-0.5">
                            {subtreeFiles.map((file) => (
                              <button
                                key={file.id}
                                type="button"
                                onClick={() => setPreviewFile(file)}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                                style={{ background: previewFile?.id === file.id ? "rgba(59,130,246,0.1)" : "transparent" }}
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate font-mono text-xs" style={{ color: "#c9d1d9" }}>
                                  {file.path.replace(selectedNode.path ? `${selectedNode.path}/` : "", "")}
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {file.counts.shor > 0 && (
                                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
                                      {file.counts.shor}
                                    </span>
                                  )}
                                  {file.counts.grover > 0 && (
                                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                                      {file.counts.grover}
                                    </span>
                                  )}
                                  {file.counts.classic > 0 && (
                                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(107,114,128,0.2)", color: "#6b7280" }}>
                                      {file.counts.classic}
                                    </span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-2 p-1">
                            {subtreeFiles.map((file) => (
                              <button
                                key={file.id}
                                type="button"
                                onClick={() => setPreviewFile(file)}
                                className="flex flex-col items-start gap-1.5 rounded-lg border p-2.5 text-left transition-colors hover:bg-white/5"
                                style={{ borderColor: "#21262d", background: previewFile?.id === file.id ? "rgba(59,130,246,0.1)" : "transparent" }}
                              >
                                <FileText className="h-4 w-4 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                                <span className="w-full truncate font-mono text-[11px]" style={{ color: "#c9d1d9" }}>{file.name}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  {file.counts.shor > 0 && (
                                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444" }}>
                                      {file.counts.shor}
                                    </span>
                                  )}
                                  {file.counts.grover > 0 && (
                                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b" }}>
                                      {file.counts.grover}
                                    </span>
                                  )}
                                  {file.counts.classic > 0 && (
                                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(107,114,128,0.2)", color: "#6b7280" }}>
                                      {file.counts.classic}
                                    </span>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t px-4 py-2.5 text-[11px]" style={{ borderColor: "#21262d", color: "#8b949e" }}>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#ef4444" }} />Broken by Shor</span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#f59e0b" }} />Weakened by Grover</span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#6b7280" }} />Broken Classically</span>
                        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} />No issues</span>
                      </div>
                    </div>

                    <ResizableDivider
                      onResize={(delta) => {
                        if (delta === 0) {
                          setSplitWidth(OVERVIEW_SPLIT_DEFAULT);
                          localStorage.removeItem(OVERVIEW_SPLIT_KEY);
                          return;
                        }
                        setSplitWidth((w) => {
                          const maxSplit = typeof window !== "undefined" ? Math.floor(window.innerWidth * 0.55) : 800;
                          const next = Math.min(maxSplit, Math.max(OVERVIEW_SPLIT_MIN, w + delta));
                          localStorage.setItem(OVERVIEW_SPLIT_KEY, String(next));
                          return next;
                        });
                      }}
                    />

                    {/* File Preview (right) */}
                    <div className="flex h-full flex-1 min-w-[300px] flex-col overflow-y-auto">
                      {!previewFile ? (
                        <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center" style={{ color: "#6e7681" }}>
                          <FileText className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
                          <p className="text-sm">Select a file to preview</p>
                        </div>
                      ) : (
                        (() => {
                          const vulnCount = previewFile.counts.shor + previewFile.counts.classic;
                          const weakenedCount = previewFile.counts.grover;
                          const safeCount = previewFile.counts.safe;
                          const riskTotal = previewFile.counts.operations || 1;
                          const riskPct = Math.round(((previewFile.counts.shor + previewFile.counts.classic) / riskTotal) * 100);
                          const algos = Array.from(new Set(previewFile.findings.filter((f) => f.findingType !== "CRYPTO_REFERENCE").map((f) => displayName(f))));
                          const previewLines = previewSource === null ? [] : previewSource.split(/\r?\n/);
                          const highlightLines = new Set(
                            previewFile.findings.flatMap((f) => f.evidence.map((e) => e.line).filter((l): l is number => l !== undefined))
                          );
                          const topFindings = [...previewFile.findings].sort(compareFindingsPriority).slice(0, 3);

                          return (
                            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                              <div className="flex shrink-0 items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="shrink-0">{languageIcon(previewFile.name)}</span>
                                  <span className="truncate text-sm font-bold text-white">{previewFile.name}</span>
                                  <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: "#30363d", color: "#8b949e" }}>
                                    {languageName(previewFile.name)}
                                  </span>
                                </div>
                                <button
                                  ref={openInEditorRef}
                                  type="button"
                                  onClick={() => handleSelectNode(previewFile)}
                                  className="group flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold shadow-md transition-all duration-150"
                                  style={{ background: "#1d2d44", borderColor: "#3b82f6", color: "#3b82f6" }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "#3b82f6"; e.currentTarget.style.color = "#ffffff"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "#1d2d44"; e.currentTarget.style.color = "#3b82f6"; }}
                                >
                                  <span>Open in Editor</span>
                                  <span
                                    className="oie-arrow inline-block text-base transition-transform group-hover:translate-x-[2px] group-hover:-translate-y-[2px]"
                                    style={{ transitionDuration: `${DUR_FAST}ms` }}
                                    aria-hidden="true"
                                  >
                                    ↗
                                  </span>
                                </button>
                              </div>

                              {showOpenInEditorTip && (
                                <Coachmark
                                  id={OPEN_IN_EDITOR_TOUR_ID}
                                  anchorRef={openInEditorRef}
                                  placement="left-start"
                                  title="Open the file"
                                  body="See the flagged lines in context, with every finding mapped to its exact line number."
                                  nextLabel="Show me"
                                  skipLabel="Not now"
                                  onNext={() => {
                                    openInEditorRef.current?.click();
                                    tourStore.endTour();
                                  }}
                                  onSkip={() => {
                                    tourStore.markSeen(OPEN_IN_EDITOR_TOUR_ID);
                                    tourStore.endTour();
                                  }}
                                />
                              )}

                              <div className="mt-3 grid shrink-0 grid-cols-4 gap-2">
                                {[
                                  ["Vulnerabilities", vulnCount, "#ef4444"],
                                  ["Weakened", weakenedCount, "#f59e0b"],
                                  ["Quantum-safe", safeCount, "#22c55e"],
                                  ["Lines of code", previewLines.length, "#8b949e"],
                                ].map(([label, value, color]) => (
                                  <div key={label as string} className="rounded-lg border p-2.5 text-center" style={{ borderColor: "#21262d", background: "#161b22" }}>
                                    <div className="text-lg font-bold tabular-nums" style={{ color: color as string }}>{value}</div>
                                    <div className="mt-0.5 text-[10px]" style={{ color: "#8b949e" }}>{label as string}</div>
                                  </div>
                                ))}
                              </div>

                              {algos.length > 0 && (
                                <div className="mt-3 shrink-0">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#6e7681" }}>Key Algorithms</div>
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {algos.map((name) => (
                                      <span key={name} className="rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: "#30363d", color: "#c9d1d9" }}>
                                        {name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="mt-3 shrink-0">
                                <div className="flex items-center justify-between text-[10px]" style={{ color: "#6e7681" }}>
                                  <span className="font-semibold uppercase tracking-wide">File Health</span>
                                  <span>{riskPct}% at risk</span>
                                </div>
                                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#21262d" }}>
                                  <div className="h-full rounded-full" style={{ width: `${riskPct}%`, background: "#ef4444" }} />
                                </div>
                              </div>

                              <div className="mt-3 shrink-0">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#6e7681" }}>Code Preview</span>
                                  {/* Secondary next to the header's "Open in Editor" -- ghost/outline so
                                      the two don't compete for primary weight in this panel. */}
                                  <button
                                    type="button"
                                    onClick={() => handleSelectNode(previewFile)}
                                    className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
                                    style={{ borderColor: "#30363d", color: "#c9d1d9" }}
                                  >
                                    Open Full View ↗
                                  </button>
                                </div>
                                <div className="mt-1.5 max-h-[220px] overflow-hidden rounded-lg border font-mono text-[11px]" style={{ borderColor: "#21262d", background: "#0d1117" }}>
                                  {previewLoading ? (
                                    <div className="p-3" style={{ color: "#6e7681" }}>Loading…</div>
                                  ) : (
                                    previewLines.slice(0, 15).map((line, idx) => (
                                      <div
                                        key={idx}
                                        className="flex whitespace-pre px-2 leading-5"
                                        style={{ background: highlightLines.has(idx + 1) ? "rgba(239,68,68,0.12)" : undefined }}
                                      >
                                        <span className="w-8 shrink-0 select-none text-right pr-2" style={{ color: "#484f58" }}>{idx + 1}</span>
                                        <span className="min-w-0 flex-1" style={{ color: "#c9d1d9" }}>{renderSyntax(line)}</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              {topFindings.length > 0 && (
                                <div className="mt-3 shrink-0">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#6e7681" }}>Findings</div>
                                  <div className="mt-1.5 space-y-1">
                                    {topFindings.map((f) => (
                                      <div key={f.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "#21262d" }}>
                                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${getSeverityStyle(f.quantumStatus)}`}>
                                          {f.quantumStatus ?? "unknown"}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-xs text-white">{displayName(f)}</span>
                                      </div>
                                    ))}
                                  </div>
                                  {previewFile.findings.length > 3 && (
                                    <button type="button" onClick={() => setFolderTab("Findings")} className="mt-1.5 text-xs font-medium" style={{ color: "#3b82f6" }}>
                                      View all →
                                    </button>
                                  )}
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => setFolderTab("Dependencies")}
                                className="mt-3 flex shrink-0 items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5"
                                style={{ borderColor: "#21262d", color: "#3b82f6" }}
                              >
                                View file dependency graph
                                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                              </button>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                )}

                {folderTab === "Files" && (
                  <div className="h-full overflow-y-auto p-4">
                    {subtreeFiles.length === 0 ? (
                      <p className="text-xs" style={{ color: "#6e7681" }}>No files in this directory.</p>
                    ) : (
                      <div className="space-y-1">
                        {subtreeFiles.map((file) => (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => handleSelectNode(file)}
                            className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-white/5"
                            style={{ borderColor: "#21262d" }}
                          >
                            <FileText className="h-4 w-4 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate font-mono text-xs" style={{ color: "#c9d1d9" }}>{file.path}</span>
                            {findingCountBadge(file.counts, file.totalFindings)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {folderTab === "Findings" && (
                  <div className="h-full overflow-y-auto p-5 space-y-2">
                    {selectedNode.totalFindings === 0 ? (
                      <div className="rounded-xl border p-6 text-center space-y-1" style={{ borderColor: "#21262d", background: "#161b22" }}>
                        <p className="text-base font-medium text-white">Zero findings in this directory</p>
                        <p className="text-sm" style={{ color: "#8b949e" }}>
                          Present in the filesystem hierarchy for structural context, but no cryptographic assets were detected in this path.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs uppercase tracking-wider pb-1" style={{ color: "#8b949e" }}>
                          <span>Findings in subtree (sorted by priority model):</span>
                          <span className="font-mono lowercase tracking-normal">{visibleFindingsWithEvidence.length} assets</span>
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
                          className={`rounded-xl border p-3 space-y-2 transition-colors ${isInert ? "opacity-60 hover:opacity-100" : ""}`}
                          style={{ borderColor: "#21262d", background: "#161b22" }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white">{displayName(finding)}</span>
                              {isReference && (
                                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full" style={{ background: "#21262d", color: "#8b949e" }}>
                                  Reference
                                </span>
                              )}
                              {isCertificate && (
                                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full" style={{ background: "#21262d", color: "#8b949e" }}>
                                  Certificate
                                </span>
                              )}
                              {isCloudKey && (
                                <>
                                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full" style={{ background: "#8b5cf6", color: "#fff" }}>
                                    Cloud KMS
                                  </span>
                                  {finding.cloudKey?.operation && (
                                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded-full" style={{ background: "#21262d", color: "#8b949e" }}>
                                      {finding.cloudKey.operation}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>

                            {!isReference && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "#21262d", color: "#c9d1d9" }}>
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
                                <div className="flex items-center justify-between font-mono text-xs" style={{ color: "#8b949e" }}>
                                  <span>
                                    {rel}
                                    {occ.line !== undefined && <span style={{ color: "#6e7681" }}>:{occ.line}</span>}
                                  </span>
                                  {occ.reachability && (
                                    <ReachabilityBadge reachability={occ.reachability} status={finding.quantumStatus} />
                                  )}
                                </div>
                                {occ.snippet && (
                                  <pre className="overflow-x-auto rounded-lg p-2 font-mono text-xs whitespace-pre" style={{ background: "#0d1117", color: "#c9d1d9" }}>
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
                      </>
                    )}
                  </div>
                )}

                {folderTab === "Visualize" && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm" style={{ color: "#8b949e" }}>
                      Visualize this folder's crypto risk in the dedicated graph and blast-radius views.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onNavigate?.("BlastRadius")}
                        className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                        style={{ background: "#3b82f6" }}
                      >
                        Open Blast Radius view →
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate?.("Relationships")}
                        className="rounded-lg border px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/5"
                        style={{ borderColor: "#30363d" }}
                      >
                        Open Relationships view →
                      </button>
                    </div>
                  </div>
                )}

                {folderTab === "Dependencies" && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm" style={{ color: "#8b949e" }}>
                      Per-folder dependency graphs aren't available yet — explore call-graph relationships between findings in the Relationships view.
                    </p>
                    <button
                      type="button"
                      onClick={() => onNavigate?.("Relationships")}
                      className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: "#3b82f6" }}
                    >
                      Open Relationships view →
                    </button>
                  </div>
                )}
              </div>

              {/* Pinned bottom bar */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 text-lg">💡</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">Want to understand this file better?</p>
                    <p className="truncate text-xs" style={{ color: "#8b949e" }}>
                      Ask Patch AI about vulnerabilities, migration paths, or code in this folder.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate?.("Ask")}
                  className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-colors"
                  style={{ background: "#3b82f6" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#2563eb")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#3b82f6")}
                >
                  Ask about this file →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <ScanHistoryModal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onLoadScan={(target) => onLoadScan?.(target)}
      />
    </div>
  );
}
