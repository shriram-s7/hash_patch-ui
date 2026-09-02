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

function App() {
  const [cbom, setCbom] = useState<ParsedCbom | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [sourceName, setSourceName] = useState<string>("demo.cbom.json");
  const [plan, setPlan] = useState<ParsedPlan | undefined>(undefined);
  const [planError, setPlanError] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch("/fixtures/demo.cbom.json")
      .then((res) => res.json())
      .then((raw: unknown) => setCbom(parseCbomDocument(raw)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load CBOM."));
  }, []);

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file
      .text()
      .then((text) => JSON.parse(text) as unknown)
      .then((raw) => {
        setCbom(parseCbomDocument(raw));
        setSourceName(file.name);
        setSelectedId(undefined);
        setError(undefined);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? `Failed to load "${file.name}": ${err.message}` : "Failed to load file."),
      );
  }

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

  return (
    <div className="min-h-screen bg-page text-ink">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <h1 className="text-lg font-semibold">PRATYAKSHA-UI</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-muted">{sourceName}</span>
          <label className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface">
            Load CBOM file
            <input type="file" accept=".json,application/json" className="hidden" onChange={handleFileUpload} />
          </label>
          <button
            onClick={loadPlan}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface"
          >
            Load migration plan
          </button>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        {error && (
          <p className="mb-4 rounded-md border border-status-critical bg-status-critical/10 px-4 py-2 text-status-critical">
            {error}
          </p>
        )}

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
          <p className="mt-4 rounded-md border border-status-critical bg-status-critical/10 px-4 py-2 text-status-critical">
            {planError}
          </p>
        )}

        {defaultScenario && (
          <div className="mt-6">
            <OptimizerBar scenario={defaultScenario} budgetDays={plan?.budgetDays} />
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
