import { useEffect, useRef, useState } from "react";
import type { ParsedCbom } from "./cbom/types";
import { parseCbomDocument } from "./cbom/cbomToFindings";
import { SERVICE_BASE_URL } from "./serviceUrl";

interface EntryScreenProps {
  onScanSuccess: (rawJson: string, parsed: ParsedCbom, targetPath: string) => void;
  onFileLoaded: (rawJson: string, parsed: ParsedCbom, fileName: string) => void;
}

const QUICK_TARGETS = [
  { label: "eval-target", path: "D:\\CBOM-SIH\\eval-target" },
  { label: "testdata/python", path: "testdata/python" },
  { label: "testdata/c", path: "testdata/c" },
  { label: "testdata/java", path: "testdata/java" },
  { label: "testdata/go", path: "testdata/go" },
  { label: "testdata/binary_crypto", path: "testdata/binary_crypto" },
  { label: "testdata/containers/mixed", path: "testdata/containers/mixed/container.tar" },
];

export function EntryScreen({ onScanSuccess, onFileLoaded }: EntryScreenProps) {
  const [sourcePath, setSourcePath] = useState("D:\\CBOM-SIH\\eval-target");
  const [serviceStatus, setServiceStatus] = useState<"checking" | "online" | "offline">("checking");
  const [isScanning, setIsScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          "Cannot connect to local engine at http://localhost:8000. Start it in a terminal using: hash-patch serve",
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-12 text-ink">
      <div className="w-full max-w-[560px] space-y-6">
        {/* Product Identity */}
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-3xl sm:text-[34px] font-bold tracking-tight text-ink">
              hash patch
            </h1>
            <span className="rounded-sm border border-line px-1.5 py-0.5 font-heading text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              UI
            </span>
          </div>
          <p className="font-sans text-[15px] text-ink-secondary leading-relaxed">
            Offline cryptographic discovery and post-quantum risk analysis engine.
          </p>
        </div>

        {/* Path Input & Analyze Action */}
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-heading uppercase tracking-wider text-ink-muted">Target Directory Path</span>
            <span className="font-sans text-ink-muted">Absolute or workspace-relative path</span>
          </div>
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isScanning) {
                    void handleAnalyze();
                  }
                }}
                placeholder="D:\CBOM-SIH\eval-target"
                disabled={isScanning}
                className="h-10 w-full rounded-sm border border-line bg-surface px-3 font-mono text-sm text-ink placeholder:text-ink-muted/40 focus:border-ink focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={isScanning || !sourcePath.trim()}
              className="flex h-10 items-center justify-center rounded-sm bg-ink px-5 font-heading text-xs font-semibold uppercase tracking-wider text-page transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isScanning ? "Analyzing..." : "Analyze"}
            </button>
          </div>

          {/* Inline Error Message */}
          {errorMessage && (
            <div className="rounded-sm border border-status-critical/40 bg-status-critical/10 p-2.5 text-xs text-status-critical">
              <span className="font-heading font-semibold">Error: </span>
              <span className="font-sans">{errorMessage}</span>
            </div>
          )}

          {/* Service Status */}
          <div className="pt-0.5">
            {serviceStatus === "online" ? (
              <div className="flex items-center gap-1.5 font-sans text-xs text-ink-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-status-good" aria-hidden="true" />
                <span>Local analysis engine connected on port <span className="font-mono text-ink">8000</span></span>
              </div>
            ) : serviceStatus === "checking" ? (
              <div className="flex items-center gap-1.5 font-sans text-xs text-ink-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ink-muted" aria-hidden="true" />
                <span>Probing local engine on port <span className="font-mono text-ink">8000</span>…</span>
              </div>
            ) : (
              <div className="space-y-1 font-sans text-xs">
                <div className="flex items-center gap-1.5 text-status-warning">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-warning" aria-hidden="true" />
                  <span>Local analysis engine offline on port <span className="font-mono">8000</span></span>
                </div>
                <div className="text-ink-muted leading-relaxed">
                  Start the local service in a terminal using: <code className="font-mono text-ink">hash-patch serve</code>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Targets & File Loader */}
        <div className="space-y-3 border-t border-line/60 pt-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-heading text-xs font-medium uppercase tracking-wider text-ink-muted">
                Quick test targets:
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

          {/* Subtle file upload link */}
          <div className="pt-1">
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
              className="font-sans text-xs text-ink-muted underline underline-offset-2 hover:text-ink transition-colors"
            >
              Load an existing CycloneDX 1.6 CBOM document instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
