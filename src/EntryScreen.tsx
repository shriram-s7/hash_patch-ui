import { useEffect, useRef, useState } from "react";
import {
  Folder,
  Terminal,
  Upload,
  Clock,
  Shield,
  Target,
  BookOpen,
  Zap,
  CircleCheck,
  ChevronRight,
  TriangleAlert,
} from "lucide-react";
import type { ParsedCbom } from "./cbom/types";
import { parseCbomDocument } from "./cbom/cbomToFindings";
import { SERVICE_BASE_URL } from "./serviceUrl";

import { WorkflowTourModal } from "./WorkflowTourModal";

interface EntryScreenProps {
  onScanSuccess: (rawJson: string, parsed: ParsedCbom, targetPath: string) => void;
  onFileLoaded: (rawJson: string, parsed: ParsedCbom, fileName: string) => void;
}

const QUICK_TARGETS = [
  { label: "testdata/python", path: "testdata/python", icon: "\u{1F40D}" },
  { label: "testdata/java", path: "testdata/java", icon: "\u2615" },
  { label: "testdata/c", path: "testdata/c", icon: "C" },
  { label: "testdata/go", path: "testdata/go", icon: "Go" },
  { label: "testdata/binary_crypto", path: "testdata/binary_crypto", icon: "01" },
  { label: "testdata/containers/mixed", path: "testdata/containers/mixed/container.tar", icon: "\u{1F433}" },
];

const RECENT_PATHS_KEY = "hash-patch-ui-recent-paths";

function loadRecentPaths(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PATHS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}

function saveRecentPath(path: string, current: string[]): string[] {
  const next = [path, ...current.filter((p) => p !== path)].slice(0, 3);
  try {
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(next));
  } catch {
    // ignore -- best-effort convenience only
  }
  return next;
}

const STEPS = ["Select Codebase", "Configure Scan", "Analysis", "Results"];

export function EntryScreen({ onScanSuccess, onFileLoaded }: EntryScreenProps) {
  const [sourcePath, setSourcePath] = useState("");
  const [serviceStatus, setServiceStatus] = useState<"checking" | "online" | "offline">("checking");
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [errorPath, setErrorPath] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // When using the browser's showDirectoryPicker (non-Electron), only the
  // leaf folder NAME is available — never the full absolute path.
  // We track this so we can warn the user to complete the path before scanning.
  const [browserPickedLeaf, setBrowserPickedLeaf] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [recentPaths, setRecentPaths] = useState<string[]>(() => loadRecentPaths());

  const checkHealth = async () => {
    try {
      const res = await fetch(`${SERVICE_BASE_URL}/api/health`, { method: "GET" });
      if (res.ok) {
        const data = (await res.json()) as { status: string };
        if (data.status === "ok") {
          setServiceStatus("online");
          return;
        }
      }
      setServiceStatus("offline");
    } catch {
      setServiceStatus("offline");
    }
  };

  useEffect(() => {
    void checkHealth();
    const interval = setInterval(() => {
      void checkHealth();
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleAnalyze = async (pathToScan = sourcePath) => {
    const trimmed = pathToScan.trim().replace(/^["']|["']$/g, "");
    if (!trimmed) {
      setErrorPath(null);
      setErrorMessage("Please enter an absolute or relative directory path.");
      return;
    }

    setIsScanning(true);
    setErrorMessage(undefined);
    setErrorPath(null);

    try {
      const response = await fetch(`${SERVICE_BASE_URL}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
        const detail = errorData.detail || errorData.error || `Scan failed with HTTP status ${response.status}`;
        if (
          response.status === 400 &&
          (detail.toLowerCase().includes("path does not exist") ||
            detail.toLowerCase().includes("path not found") ||
            detail.toLowerCase().includes("does not exist"))
        ) {
          setErrorPath(trimmed);
          return;
        }
        throw new Error(detail);
      }

      const cbomJson = (await response.json()) as Record<string, unknown>;
      const parsed = parseCbomDocument(cbomJson);
      const rawText = JSON.stringify(cbomJson, null, 2);

      setRecentPaths(saveRecentPath(trimmed, recentPaths));
      onScanSuccess(rawText, parsed, trimmed);
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
        setServiceStatus("offline");
        setErrorMessage(
          "Cannot connect to the local analysis engine. If this persists, close and reopen Hash Patch.",
        );
      } else if (err instanceof Error) {
        if (
          err.message.toLowerCase().includes("path does not exist") ||
          err.message.toLowerCase().includes("path not found") ||
          err.message.toLowerCase().includes("does not exist")
        ) {
          setErrorPath(trimmed);
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage("An unexpected error occurred while scanning.");
      }
    } finally {
      setIsScanning(false);
    }
  };

  const loadCbomFile = (file: File) => {
    file
      .text()
      .then((text) => {
        const parsedJson = JSON.parse(text) as unknown;
        const parsed = parseCbomDocument(parsedJson);
        onFileLoaded(text, parsed, file.name);
      })
      .catch((err: unknown) => {
        setErrorMessage(
          err instanceof Error ? `Failed to load "${file.name}": ${err.message}` : "Failed to load CBOM file.",
        );
      });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    loadCbomFile(file);
  };

  const clearRecent = () => {
    setRecentPaths([]);
    try {
      localStorage.removeItem(RECENT_PATHS_KEY);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="relative h-full overflow-y-auto"
      style={{ background: "#0d1117", color: "#ffffff" }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setIsDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file) loadCbomFile(file);
      }}
    >
      {isDraggingFile && (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed"
          style={{ borderColor: "#3b82f6", background: "rgba(13,17,23,0.92)" }}
        >
          <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-white">
            <Upload className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            Drop CBOM JSON to load
          </div>
        </div>
      )}

      <div className="mx-auto max-w-[1200px] px-6 py-8 sm:px-10">
        {/* Stepper */}
        <div className="flex items-center">
          {STEPS.map((label, i) => (
            <div key={label} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={
                    i === 0
                      ? { background: "#3b82f6", color: "#ffffff" }
                      : { background: "transparent", color: "#8b949e", border: "1px solid #30363d" }
                  }
                >
                  {i + 1}
                </div>
                <span className="text-[11px] font-medium" style={{ color: i === 0 ? "#ffffff" : "#8b949e" }}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="mx-2 mb-5 h-px flex-1" style={{ background: i === 0 ? "#3b82f6" : "#30363d" }} />
              )}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left column */}
          <div className="space-y-5 lg:col-span-2">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight sm:text-[32px]">
                Select Your <span style={{ color: "#3b82f6" }}>Codebase</span>
              </h1>
              <p className="text-sm leading-relaxed">
                <span className="font-semibold text-white">
                  Choose a folder to scan for cryptographic vulnerabilities.
                </span>{" "}
                <span style={{ color: "#8b949e" }}>
                  Your code stays on your machine — no files are uploaded.
                </span>
              </p>
            </div>

            {/* Always-visible path input — no method toggle needed */}
            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "#21262d", background: "#0d1117" }}>
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 shrink-0" style={{ color: "#3b82f6" }} strokeWidth={2} aria-hidden="true" />
                <span className="text-sm font-semibold text-white">Enter Directory Path</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "#8b949e" }}>
                Paste or type the <span className="font-medium text-white">full absolute path</span> to your codebase folder.
                Your code never leaves your machine — all analysis runs locally.
              </p>
              {browserPickedLeaf && (
                <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5" style={{ borderColor: "rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.08)" }}>
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#f59e0b" }} strokeWidth={2} aria-hidden="true" />
                  <div className="min-w-0 text-xs leading-relaxed" style={{ color: "#f0d070" }}>
                    <span className="font-semibold">Your browser can only see the folder name, not its full path.</span>
                    {" "}Pre-filled with <code className="rounded bg-black/30 px-1 font-mono">{browserPickedLeaf}</code> — please
                    type the <span className="font-semibold">complete absolute path</span> before scanning.
                    <br />
                    <span className="text-[11px]" style={{ color: "#d29922" }}>
                      Example: <code className="font-mono">C:\Users\you\projects\{browserPickedLeaf}</code>
                    </span>
                  </div>
                </div>
              )}
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  autoFocus
                  value={sourcePath}
                  onChange={(e) => {
                    setSourcePath(e.target.value);
                    if (browserPickedLeaf) setBrowserPickedLeaf(null);
                    if (errorPath) setErrorPath(null);
                    if (errorMessage) setErrorMessage(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isScanning) void handleAnalyze();
                  }}
                  placeholder="C:\path\to\your\repository  or  /home/user/project"
                  disabled={isScanning}
                  className="h-11 min-w-0 flex-1 rounded-lg border px-3 font-mono text-sm text-white placeholder:text-[#6e7681] focus:outline-none focus:border-[#3b82f6]"
                  style={{ background: "#161b22", borderColor: browserPickedLeaf ? "rgba(245,158,11,0.5)" : "#30363d", transition: "border-color 0.15s" }}
                />
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={isScanning || !sourcePath.trim() || !!browserPickedLeaf}
                  className="flex h-11 shrink-0 items-center justify-center rounded-lg px-6 text-sm font-bold uppercase tracking-wider text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: "#3b82f6" }}
                  title={browserPickedLeaf ? "Complete the full path first" : undefined}
                >
                  {isScanning ? "Analyzing…" : "Analyze"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "#484f58" }}>
                <span>📁 Windows: <code className="font-mono">C:\Users\name\project</code></span>
                <span>🐧 macOS/Linux: <code className="font-mono">/home/name/project</code></span>
              </div>
            </div>

            {errorPath ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-[#1a0808] border border-[#ef4444]/50 text-[#fca5a5] text-sm">
                <span>⚠</span>
                <span>Path not found: <code className="font-mono">{errorPath}</code>. Check the path exists and is accessible.</span>
              </div>
            ) : errorMessage ? (
              <div
                className="flex items-start gap-2 rounded-lg border p-2.5 text-xs"
                style={{ borderColor: "#ef4444", background: "#1a0808", color: "#fca5a5" }}
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            ) : null}

            {serviceStatus === "offline" && (
              <div
                className="flex items-start gap-2 rounded-lg border p-2.5 text-xs"
                style={{ borderColor: "rgba(210,153,34,0.4)", background: "rgba(210,153,34,0.08)", color: "#d29922" }}
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span>
                  Local analysis engine offline on port <span className="font-mono">8000</span>. If this persists,
                  close and reopen Hash Patch.
                </span>
              </div>
            )}

            {/* Recently used */}
            <div className="rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#0d1117" }}>
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
                  Recently Used
                </span>
                {recentPaths.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecent}
                    className="ml-auto text-xs font-medium"
                    style={{ color: "#3b82f6" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="mt-2 divide-y" style={{ borderColor: "#21262d" }}>
                {recentPaths.length === 0 ? (
                  <p className="py-2 text-xs" style={{ color: "#6e7681" }}>
                    Paths you scan will show up here for quick access.
                  </p>
                ) : (
                  recentPaths.map((path) => (
                    <div key={path} className="flex items-center gap-2 py-2" style={{ borderColor: "#21262d" }}>
                      <Folder className="h-4 w-4 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-white">{path}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setSourcePath(path);
                          void handleAnalyze(path);
                        }}
                        disabled={isScanning}
                        className="shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ borderColor: "#30363d" }}
                      >
                        Select
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* CBOM file load -- kept as an unobtrusive secondary path */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs underline decoration-dotted underline-offset-2 transition-colors hover:text-white"
                style={{ color: "#8b949e" }}
              >
                <Upload className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                Load an existing CycloneDX 1.6 CBOM document instead
              </button>
            </div>

            {/* System requirements */}
            <div className="rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#0d1117" }}>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 shrink-0" style={{ color: "#d29922" }} strokeWidth={2} aria-hidden="true" />
                <span className="text-sm font-semibold text-white">System Requirements for Local AI Features</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "#8b949e" }}>
                For the best experience with the Ask Patch AI feature:
              </p>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4">
                  {["8 GB RAM (recommended)", "6 GB minimum", "Works on Windows, macOS, Linux"].map((item) => (
                    <div key={item} className="flex items-center gap-1.5">
                      <CircleCheck className="h-3.5 w-3.5 shrink-0" style={{ color: "#3fb950" }} strokeWidth={2} aria-hidden="true" />
                      <span className="text-xs" style={{ color: "#c9d1d9" }}>
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
                <a
                  href="https://github.com/shriram-s7/hash_patch"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs font-medium"
                  style={{ color: "#3b82f6" }}
                >
                  Learn more →
                </a>
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(139,92,246,0.15)" }}>
                <Shield className="h-4.5 w-4.5 shrink-0" style={{ color: "#a78bfa" }} strokeWidth={2} aria-hidden="true" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Your Code. Your Control.</div>
                <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "#8b949e" }}>
                  Hash Patch runs entirely on your machine. No code is uploaded or shared.
                </p>
              </div>
            </div>

            {/* Need Help — moved above Quick Test Targets */}
            <div className="rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(59,130,246,0.15)" }}>
                <BookOpen className="h-4.5 w-4.5 shrink-0" style={{ color: "#3b82f6" }} strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="mt-2 text-sm font-semibold text-white">Need Help?</div>
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "#8b949e" }}>
                Check our documentation or take a quick tour to get started.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <a
                  href="https://github.com/shriram-s7/hash_patch"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-lg border px-3 py-1.5 text-center text-xs font-medium text-white transition-colors hover:bg-white/5"
                  style={{ borderColor: "#30363d" }}
                >
                  View Documentation
                </a>
                <button
                  type="button"
                  onClick={() => setTourOpen(true)}
                  className="flex-1 rounded-lg px-3 py-1.5 text-center text-xs font-semibold text-white transition-colors hover:opacity-90"
                  style={{ background: "#3b82f6" }}
                >
                  Take a Tour
                </button>
              </div>
            </div>

            {/* Quick Test Targets — moved below Need Help */}
            <div className="rounded-xl border p-4" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 shrink-0" style={{ color: "#3b82f6" }} strokeWidth={2} aria-hidden="true" />
                <span className="text-sm font-semibold text-white">Quick Test Targets</span>
              </div>
              <p className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>
                Try one of these sample projects to explore the features.
              </p>
              <div className="mt-3 divide-y" style={{ borderColor: "#21262d" }}>
                {QUICK_TARGETS.map((target) => (
                  <button
                    key={target.path}
                    type="button"
                    onClick={() => {
                      setSourcePath(target.path);
                      if (serviceStatus === "online") void handleAnalyze(target.path);
                    }}
                    disabled={isScanning}
                    className="flex w-full items-center gap-2.5 py-2.5 text-left transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ borderColor: "#21262d" }}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
                      style={{ background: "#0d1117", color: "#c9d1d9" }}
                    >
                      {target.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-white">{target.label}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 pb-4 text-center text-[11px] tracking-widest uppercase" style={{ color: "#484f58" }}>
          Detect — Understand — Plan — A Quantum-Safe Tomorrow
        </footer>
      </div>

      <WorkflowTourModal isOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
