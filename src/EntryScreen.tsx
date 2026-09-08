import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Upload,
  Terminal,
  CircleCheck,
  CircleDashed,
  TriangleAlert,
  Download,
  Cpu,
  Zap,
} from "lucide-react";
import type { ParsedCbom } from "./cbom/types";
import { parseCbomDocument } from "./cbom/cbomToFindings";
import { SERVICE_BASE_URL } from "./serviceUrl";
import { ThemeToggle } from "./ThemeToggle";
import { detectFolderPickerMode, pickDirectoryBrowser, pickDirectoryElectron } from "./folderPicker";

interface EntryScreenProps {
  onScanSuccess: (rawJson: string, parsed: ParsedCbom, targetPath: string) => void;
  onFileLoaded: (rawJson: string, parsed: ParsedCbom, fileName: string) => void;
}

const QUICK_TARGETS = [
  { label: "testdata/python", path: "testdata/python" },
  { label: "testdata/c", path: "testdata/c" },
  { label: "testdata/java", path: "testdata/java" },
  { label: "testdata/go", path: "testdata/go" },
  { label: "testdata/binary_crypto", path: "testdata/binary_crypto" },
  { label: "testdata/containers/mixed", path: "testdata/containers/mixed/container.tar" },
];

export function EntryScreen({ onScanSuccess, onFileLoaded }: EntryScreenProps) {
  const [sourcePath, setSourcePath] = useState("");
  const [serviceStatus, setServiceStatus] = useState<"checking" | "online" | "offline">("checking");
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detected once on mount -- the environment doesn't change mid-session.
  const [pickerMode] = useState(() => detectFolderPickerMode());

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
    const trimmed = pathToScan.trim();
    if (!trimmed) {
      setErrorMessage("Please enter an absolute or relative directory path.");
      return;
    }

    setIsScanning(true);
    setErrorMessage(undefined);

    try {
      const response = await fetch(`${SERVICE_BASE_URL}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { detail?: string };
        const detail = errorData.detail || `Scan failed with HTTP status ${response.status}`;
        throw new Error(detail);
      }

      const cbomJson = (await response.json()) as Record<string, unknown>;
      const parsed = parseCbomDocument(cbomJson);
      const rawText = JSON.stringify(cbomJson, null, 2);

      onScanSuccess(rawText, parsed, trimmed);
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message.includes("Failed to fetch")) {
        setServiceStatus("offline");
        setErrorMessage(
          "Cannot connect to the local analysis engine. If this persists, close and reopen Hash Patch.",
        );
      } else if (err instanceof Error) {
        setErrorMessage(err.message);
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

  const handleBrowse = async () => {
    if (pickerMode === "electron") {
      const picked = await pickDirectoryElectron();
      if (picked) setSourcePath(picked);
      return;
    }
    if (pickerMode === "file-system-access") {
      const name = await pickDirectoryBrowser();
      if (name) setSourcePath(name);
    }
  };

  return (
    <div
      className="relative flex min-h-screen flex-col bg-page px-4 py-10 text-ink sm:px-8"
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
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed border-ink bg-page/90">
          <div className="flex items-center gap-3 font-heading text-sm font-semibold uppercase tracking-widest text-ink">
            <Upload className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            Drop CBOM JSON to load
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center gap-8">
        {/* Product identity */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <img src="./favicon.ico" alt="Hash Patch" className="h-7 w-7 shrink-0 rounded-sm object-contain" />
              <h1 className="font-heading text-2xl font-bold tracking-tight text-ink sm:text-[28px]">hash patch</h1>
            </div>
            <p className="font-sans text-sm text-ink-secondary leading-relaxed">
              Offline cryptographic discovery and post-quantum risk analysis engine.
            </p>
          </div>
          <ThemeToggle />
        </div>

        {/* Target selection */}
        <div className="space-y-2.5 rounded-sm border border-line bg-surface p-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-heading font-semibold uppercase tracking-wider text-ink">Target directory</span>
            <span className="font-mono text-[11px] text-ink-muted">
              {pickerMode === "electron" && "native folder dialog"}
              {pickerMode === "file-system-access" && "browser folder picker"}
              {pickerMode === "manual" && "manual path entry"}
            </span>
          </div>

          <div className="flex items-stretch gap-2">
            {pickerMode !== "manual" && (
              <button
                type="button"
                onClick={() => void handleBrowse()}
                disabled={isScanning}
                title={
                  pickerMode === "electron"
                    ? "Open a native OS folder picker"
                    : "Open your browser's folder picker (File System Access API)"
                }
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-3 font-heading text-xs font-medium uppercase tracking-wider text-ink-secondary transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="hidden sm:inline">Browse</span>
              </button>
            )}
            <input
              type="text"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isScanning) {
                  void handleAnalyze();
                }
              }}
              placeholder="C:\path\to\your\repository"
              disabled={isScanning}
              className="h-10 min-w-0 flex-1 rounded-sm border border-line bg-page px-3 font-mono text-sm text-ink placeholder:text-ink-muted/50 focus:border-ink focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={isScanning || !sourcePath.trim()}
              className="flex h-10 shrink-0 items-center justify-center rounded-sm bg-ink px-5 font-heading text-xs font-semibold uppercase tracking-wider text-page transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isScanning ? "Analyzing…" : "Analyze"}
            </button>
          </div>

          {pickerMode === "file-system-access" && (
            <p className="font-sans text-[11px] leading-relaxed text-ink-muted">
              Your browser can't disclose the full system path of a picked folder (a Web platform security
              boundary, not a limitation of this tool) — Browse fills in the folder's name; confirm or complete
              the full path above before analyzing.
            </p>
          )}
          {pickerMode === "manual" && (
            <p className="font-sans text-[11px] leading-relaxed text-ink-muted">
              Your browser doesn't support folder browsing (Chrome, Edge, or Brave enable it) — paste the full
              path instead.
            </p>
          )}

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-sm border border-status-critical-fill/40 bg-status-critical-fill/10 p-2.5 text-xs text-status-critical-text">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="font-sans">{errorMessage}</span>
            </div>
          )}

          <div className="pt-0.5 font-sans text-xs">
            {serviceStatus === "online" ? (
              <div className="flex items-center gap-1.5 text-ink-muted">
                <CircleCheck className="h-3.5 w-3.5 shrink-0 text-status-good-text" strokeWidth={2} aria-hidden="true" />
                <span>
                  Local analysis engine connected on port <span className="font-mono text-ink">8000</span>
                </span>
              </div>
            ) : serviceStatus === "checking" ? (
              <div className="flex items-center gap-1.5 text-ink-muted">
                <CircleDashed className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span>
                  Probing local engine on port <span className="font-mono text-ink">8000</span>…
                </span>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-status-warning-text">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span>
                    Local analysis engine offline on port <span className="font-mono">8000</span>
                  </span>
                </div>
                <div className="pl-5 text-ink-muted leading-relaxed">
                  If this persists, close and reopen Hash Patch to restart the local analysis engine.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick targets */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Quick test targets
            </span>
            {QUICK_TARGETS.map((target) => (
              <button
                key={target.path}
                type="button"
                onClick={() => {
                  setSourcePath(target.path);
                  if (serviceStatus === "online") {
                    void handleAnalyze(target.path);
                  }
                }}
                disabled={isScanning}
                className={`rounded-sm border px-2.5 py-1 font-mono text-xs transition-colors ${
                  sourcePath === target.path
                    ? "border-ink bg-surface-2 font-semibold text-ink"
                    : "border-line text-ink-secondary hover:border-line-strong hover:text-ink font-normal"
                }`}
              >
                {target.label}
              </button>
            ))}
          </div>
          <p className="font-sans text-xs text-ink-muted leading-relaxed">
            Launch an instant evaluation scan across pre-configured test fixtures in Python, Go, C, or Java.
          </p>
        </div>

        {/* CBOM file load */}
        <div className="flex items-center gap-2 border-t border-line/60 pt-4">
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
            className="flex items-center gap-1.5 font-sans text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink transition-colors"
          >
            <Upload className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            Load an existing CycloneDX 1.6 CBOM document instead
          </button>
          <span className="font-sans text-[11px] text-ink-muted">(or drag a .json file anywhere on this page)</span>
        </div>

        {/* Desktop application */}
        <div className="rounded-sm border border-line bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden="true" />
              <span className="font-heading text-xs font-semibold uppercase tracking-wider text-ink">
                Desktop application (Windows)
              </span>
            </div>
            <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              v0.1.0 · ~122 MB
            </span>
          </div>

          <p className="font-sans text-xs text-ink-secondary leading-relaxed">
            Download the offline Windows desktop build to run local scanning, AST cryptographic call-graph
            reachability, and CycloneDX 1.6 CBOM export directly against your own repository.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <a
              href="https://github.com/shriram-s7/hash_patch/releases/download/v0.1.0/HashPatch-Setup.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm bg-ink px-3 py-1.5 font-heading text-xs font-semibold uppercase tracking-wider text-page transition-opacity hover:opacity-90"
            >
              <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>Download HashPatch-Setup.exe</span>
            </a>
            <a
              href="https://github.com/shriram-s7/hash_patch/releases/download/v0.1.0/HashPatch-Portable.exe"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface-2 px-3 py-1.5 font-heading text-xs font-medium uppercase tracking-wider text-ink-secondary transition-colors hover:border-line-strong hover:text-ink"
            >
              <span>Portable .exe</span>
            </a>
          </div>

          <div className="border-t border-line/60 pt-2.5 space-y-1.5">
            <div className="font-heading text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Hardware compatibility
            </div>
            <div className="grid grid-cols-1 gap-2 font-sans text-xs sm:grid-cols-2">
              <div className="space-y-1 rounded-sm border border-line/50 bg-page p-2">
                <div className="flex items-center gap-1.5 font-medium text-status-good-text">
                  <Zap className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span className="font-heading text-[11px] uppercase tracking-wide">Core scans &amp; reports</span>
                </div>
                <p className="text-[11px] leading-snug text-ink-secondary">
                  Runs on <strong>any PC</strong> (even low-spec 2–4 GB RAM). Full AST multi-language scanning,
                  CBOM 1.6 export, reachability &amp; migration planning.
                </p>
              </div>
              <div className="space-y-1 rounded-sm border border-line/50 bg-page p-2">
                <div className="flex items-center gap-1.5 font-medium text-ink">
                  <Cpu className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span className="font-heading text-[11px] uppercase tracking-wide">Local AI "Ask" feature</span>
                </div>
                <p className="text-[11px] leading-snug text-ink-secondary">
                  <strong>6 GB (preferably 8 GB+) RAM</strong> recommended for hosting the offline Ollama{" "}
                  <code className="font-mono text-[10px]">llama3.2:3b</code> LLM in memory.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
