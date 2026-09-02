import { useEffect, useMemo, useState } from "react";
import { parseCbomDocument } from "./cbom/cbomToFindings";
import type { ParsedCbom } from "./cbom/types";
import { parsePlanDocument } from "./plan/parsePlan";
import type { ParsedPlan } from "./plan/types";
import { ThemeToggle } from "./ThemeToggle";
import { MetricCard } from "./MetricCard";
import { FindingsTable } from "./FindingsTable";
import { DetailPanel } from "./DetailPanel";
import { OptimizerBar } from "./OptimizerBar";
import { ModeSwitcher } from "./ModeSwitcher";
import { ScanIndicator } from "./ScanIndicator";
import { GraphMode } from "./GraphMode";
import { CodeMode } from "./CodeMode";
import { BlastRadiusMode } from "./BlastRadiusMode";
import { VerifyMode } from "./VerifyMode";

function App() {
  const [cbom, setCbom] = useState<ParsedCbom | undefined>(undefined);
  const [rawCbomText, setRawCbomText] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [sourceName, setSourceName] = useState<string>("demo.cbom.json");
  const [plan, setPlan] = useState<ParsedPlan | undefined>(undefined);
  const [planError, setPlanError] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState("overview");

  useEffect(() => {
    fetch("/fixtures/demo.cbom.json")
      .then((res) => res.text())
      .then((text) => {
        setRawCbomText(text);
        setCbom(parseCbomDocument(JSON.parse(text) as unknown));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load CBOM."));
  }, []);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file
      .text()
      .then((text) => {
        setCbom(parseCbomDocument(JSON.parse(text) as unknown));
        setRawCbomText(text);
        setSourceName(file.name);
        setSelectedId(undefined);
        setError(undefined);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? `Failed to load "${file.name}": ${err.message}` : "Failed to load file."),
      );
  }

  // Shared across all three modes — switching modes never reloads/reparses
  // the CBOM; every mode just renders the same parsed Finding[].
  const metrics = useMemo(() => {
    const findings = cbom?.findings ?? [];
    const brokenByShor = findings.filter((f) => f.quantumStatus === "broken-by-shor").length;
    const longestShelfLife = findings.reduce<number | undefined>((longest, f) => {
      if (f.longestShelfLifeYears === undefined) return longest;
      return longest === undefined || f.longestShelfLifeYears > longest ? f.longestShelfLifeYears : longest;
    }, undefined);
    return {
      totalAssets: findings.length,
      brokenByShor,
      contradictions: cbom?.contradictions.length ?? 0,
      longestShelfLife: longestShelfLife ?? 0,
    };
  }, [cbom]);

  const selectedFinding = cbom?.findings.find((f) => f.id === selectedId);

  const defaultScenario = plan?.scenarios.reduce<ParsedPlan["scenarios"][number] | undefined>(
    (best, s) =>
      best === undefined || (s.probabilityWeight ?? 0) > (best.probabilityWeight ?? 0) ? s : best,
    undefined,
  );

  function loadPlan() {
    fetch("/fixtures/demo_plan.json")
      .then((res) => res.json())
      .then((raw: unknown) => {
        setPlan(parsePlanDocument(raw));
        setPlanError(undefined);
      })
      .catch((e: unknown) => setPlanError(e instanceof Error ? e.message : "Failed to load plan."));
  }

  const isFullBleedMode = mode === "graph" || mode === "code" || mode === "blast-radius";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-page text-ink">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-semibold tracking-[0.15em] text-ink">PRATYAKSHA</span>
            <span className="rounded-sm border border-line px-1 py-0.5 font-mono text-[10px] text-ink-muted">
              UI
            </span>
          </div>
          <ModeSwitcher activeMode={mode} onChange={setMode} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ScanIndicator label="Scanning" />
          <span className="font-mono text-xs text-ink-muted">{sourceName}</span>
          <label className="cursor-pointer rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink">
            Load CBOM
            <input type="file" accept=".json,application/json" className="hidden" onChange={handleFileUpload} />
          </label>
          <button
            onClick={loadPlan}
            className="rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Load plan
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className={`min-h-0 flex-1 ${isFullBleedMode ? "overflow-hidden p-4 sm:p-6" : "overflow-y-auto"}`}>
        <div key={mode} className="animate-mode-in h-full">
        {mode === "overview" && (
          <div className="mx-auto max-w-6xl p-4 sm:p-6">
            {error && (
              <p className="mb-4 rounded-sm border border-status-critical bg-status-critical/10 px-4 py-2 text-sm text-status-critical">
                {error}
              </p>
            )}

            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Total assets" value={metrics.totalAssets} />
              <MetricCard label="Broken by Shor" value={metrics.brokenByShor} />
              <MetricCard label="Contradictions" value={metrics.contradictions} />
              <MetricCard label="Longest shelf-life (yrs)" value={metrics.longestShelfLife} />
            </div>

            {cbom && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className={selectedFinding ? "lg:col-span-2" : "lg:col-span-3"}>
                  <FindingsTable
                    findings={cbom.findings}
                    selectedId={selectedId}
                    onSelect={(f) => setSelectedId(f.id)}
                  />
                </div>
                {selectedFinding && (
                  <div className="lg:col-span-1">
                    <DetailPanel finding={selectedFinding} onClose={() => setSelectedId(undefined)} />
                  </div>
                )}
              </div>
            )}

            {planError && (
              <p className="mt-4 rounded-sm border border-status-critical bg-status-critical/10 px-4 py-2 text-sm text-status-critical">
                {planError}
              </p>
            )}

            {defaultScenario && (
              <div className="mt-6">
                <OptimizerBar scenario={defaultScenario} budgetDays={plan?.budgetDays} />
              </div>
            )}
          </div>
        )}

        {mode === "graph" && cbom && (
          <GraphMode
            findings={cbom.findings}
            metrics={metrics}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        {mode === "code" && cbom && (
          <CodeMode
            findings={cbom.findings}
            metrics={metrics}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        {mode === "blast-radius" && cbom && (
          <BlastRadiusMode findings={cbom.findings} selectedId={selectedId} onSelect={setSelectedId} />
        )}

        {mode === "verify" && (
          <div className="p-4 sm:p-6">
            <VerifyMode rawText={rawCbomText} sourceName={sourceName} />
          </div>
        )}
        </div>
      </main>
    </div>
  );
}

export default App;
