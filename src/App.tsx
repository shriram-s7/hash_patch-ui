import { useMemo, useState } from "react";
import type { Finding, ParsedCbom, ShelfLifeEntry } from "./cbom/types";
import { parsePlanDocument } from "./plan/parsePlan";
import type { ParsedPlan } from "./plan/types";
import { AppShell, type NavItem } from "./AppShell";
import { EntryScreen } from "./EntryScreen";
import { RepositoryView } from "./RepositoryView";
import { FindingsTable } from "./FindingsTable";
import { DetailPanel } from "./DetailPanel";
import { GraphMode } from "./GraphMode";
import { MigrationView } from "./MigrationView";
import { ReportView } from "./ReportView";
import { ShelfLifeModal } from "./ShelfLifeModal";
import { AskView } from "./AskView";
import { SERVICE_BASE_URL } from "./serviceUrl";

/** The ShelfLifeEntry backing a finding's longestShelfLifeYears value (same
 * pattern FindingsTable.tsx / FileCodeView.tsx use — the CBOM only stores
 * shelf-life per-category, so the "longest" one is looked up by value). */
function longestShelfLifeEntry(finding: Finding): ShelfLifeEntry | undefined {
  if (finding.longestShelfLifeYears === undefined) return undefined;
  return finding.shelfLife.find((s) => s.shelfLifeYears === finding.longestShelfLifeYears);
}

export function App() {
  const [cbom, setCbom] = useState<ParsedCbom | undefined>(undefined);
  const [rawCbomText, setRawCbomText] = useState<string | undefined>(undefined);
  const [sourceName, setSourceName] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [activeNav, setActiveNav] = useState<NavItem>("Repository");

  const [plan, setPlan] = useState<ParsedPlan | undefined>(undefined);
  const [isDemoPlan, setIsDemoPlan] = useState<boolean>(false);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [budgetDays, setBudgetDays] = useState<number>(5.0);
  const [planError, setPlanError] = useState<string | undefined>(undefined);
  const [shelfLifeModal, setShelfLifeModal] = useState<{ assetName: string; entry: ShelfLifeEntry } | undefined>(
    undefined,
  );

  async function optimizeScan(cbomObj: unknown, budget: number = 5.0) {
    if (!cbomObj) return;
    setIsOptimizing(true);
    setPlanError(undefined);
    try {
      const res = await fetch(`${SERVICE_BASE_URL}/api/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cbom: cbomObj,
          budget_days: budget,
          parallelism: 1,
        }),
      });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(errData.detail || `Optimization failed with status ${res.status}`);
      }
      const reportData = await res.json();
      setPlan(parsePlanDocument(reportData));
      setIsDemoPlan(false);
      setPlanError(undefined);
    } catch (err) {
      console.error("Optimization failed:", err);
      setPlanError(err instanceof Error ? err.message : "Failed to calculate migration plan.");
      setPlan(undefined);
    } finally {
      setIsOptimizing(false);
    }
  }

  function handleScanSuccess(rawJson: string, parsed: ParsedCbom, targetPath: string) {
    setCbom(parsed);
    setRawCbomText(rawJson);
    setSourceName(targetPath);
    setSelectedId(undefined);
    setActiveNav("Repository");
    setPlan(undefined);
    setIsDemoPlan(false);
    setPlanError(undefined);

    try {
      const parsedObj = JSON.parse(rawJson);
      void optimizeScan(parsedObj, budgetDays);
    } catch {
      // ignore
    }
  }

  function handleFileLoaded(rawJson: string, parsed: ParsedCbom, fileName: string) {
    setCbom(parsed);
    setRawCbomText(rawJson);
    setSourceName(fileName);
    setSelectedId(undefined);
    setActiveNav("Repository");
    setPlan(undefined);
    setIsDemoPlan(false);
    setPlanError(undefined);

    try {
      const parsedObj = JSON.parse(rawJson);
      void optimizeScan(parsedObj, budgetDays);
    } catch {
      // ignore
    }
  }

  function handleNewScan() {
    setCbom(undefined);
    setRawCbomText(undefined);
    setSourceName("");
    setSelectedId(undefined);
    setActiveNav("Repository");
    setPlan(undefined);
    setIsDemoPlan(false);
    setPlanError(undefined);
  }

  function loadDemoPlan() {
    setIsOptimizing(true);
    fetch("/fixtures/demo_plan.json")
      .then((res) => res.json())
      .then((raw: unknown) => {
        setPlan(parsePlanDocument(raw));
        setIsDemoPlan(true);
        setPlanError(undefined);
      })
      .catch((e: unknown) => {
        setPlanError(e instanceof Error ? e.message : "Failed to load demo plan.");
        setPlan(undefined);
      })
      .finally(() => setIsOptimizing(false));
  }

  function handleRecalculatePlan(newBudget: number) {
    setBudgetDays(newBudget);
    if (rawCbomText) {
      try {
        const parsedObj = JSON.parse(rawCbomText);
        void optimizeScan(parsedObj, newBudget);
      } catch {
        setPlanError("Cannot recalculate: invalid CBOM text.");
      }
    }
  }

  const metrics = useMemo(() => {
    const findings = cbom?.findings ?? [];
    // Only OPERATION findings (real crypto API calls / library invocations) count
    // toward TOTAL / BROKEN BY SHOR — a CRYPTO_REFERENCE (a string literal that
    // merely looks like an algorithm name, never passed to a crypto call) is a
    // structurally different kind of finding and must not inflate these counts.
    const operationFindings = findings.filter((f) => f.findingType !== "CRYPTO_REFERENCE");
    const referenceFindings = findings.filter((f) => f.findingType === "CRYPTO_REFERENCE");
    const brokenByShor = operationFindings.filter((f) => f.quantumStatus === "broken-by-shor").length;
    const longestShelfLifeFinding = findings.reduce<Finding | undefined>((longest, f) => {
      if (f.longestShelfLifeYears === undefined) return longest;
      if (longest?.longestShelfLifeYears === undefined || f.longestShelfLifeYears > longest.longestShelfLifeYears) {
        return f;
      }
      return longest;
    }, undefined);
    return {
      totalAssets: operationFindings.length,
      referenceAssets: referenceFindings.length,
      brokenByShor,
      contradictions: cbom?.contradictions.length ?? 0,
      // undefined (never 0) when no finding has a computed shelf-life at
      // all — a genuinely unknown shelf-life (no sensitive-data signal
      // found near any crypto call) must never be displayed as "0y", which
      // would claim "expires immediately", a different and misleading fact.
      longestShelfLife: longestShelfLifeFinding?.longestShelfLifeYears,
      longestShelfLifeFinding,
    };
  }, [cbom]);

  const selectedFinding = cbom?.findings.find((f) => f.id === selectedId);

  // Screen 0 - Entry state before any scan exists
  if (!cbom) {
    return <EntryScreen onScanSuccess={handleScanSuccess} onFileLoaded={handleFileLoaded} />;
  }

  return (
    <AppShell
      activeNav={activeNav}
      onNavChange={setActiveNav}
      sourceName={sourceName}
      onNewScan={handleNewScan}
      summary={{
        totalAssets: metrics.totalAssets,
        referenceAssets: metrics.referenceAssets,
        brokenByShor: metrics.brokenByShor,
        contradictions: metrics.contradictions,
        longestShelfLife: metrics.longestShelfLife,
        longestShelfLifeFindingName: metrics.longestShelfLifeFinding?.name,
        onLongestShelfLifeClick: () => {
          const finding = metrics.longestShelfLifeFinding;
          const entry = finding ? longestShelfLifeEntry(finding) : undefined;
          if (finding && entry) setShelfLifeModal({ assetName: finding.name, entry });
        },
      }}
    >
          {activeNav !== "Ask" && (
            <div key={activeNav} className="animate-mode-in h-full">
              {activeNav === "Repository" && (
                <RepositoryView
                  sourceName={sourceName}
                  findings={cbom.findings}
                  scannedFiles={cbom.scannedFiles}
                />
              )}

              {activeNav === "Findings" && (
                <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-4">
                  <div className="border-b border-line pb-3">
                    <h2 className="font-heading text-[26px] font-medium text-ink tracking-tight">
                      Cryptographic Findings
                    </h2>
                    <p className="mt-1 font-sans text-sm text-ink-muted leading-relaxed">
                      Complete inventory of detected cryptographic assets, ordered by combined algorithmic vulnerability and runtime reachability.
                    </p>
                  </div>
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
                </div>
              )}

              {activeNav === "Relationships" && (
                <div className="h-full overflow-hidden p-4 sm:p-6">
                  <GraphMode
                    findings={cbom.findings}
                    metrics={metrics}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                </div>
              )}

              {activeNav === "Migration" && (
                <MigrationView
                  findings={cbom.findings}
                  selectedId={selectedId}
                  onSelectId={setSelectedId}
                  plan={plan}
                  isDemoPlan={isDemoPlan}
                  isOptimizing={isOptimizing}
                  planError={planError}
                  onPlanLoaded={(p) => {
                    setPlan(p);
                    setIsDemoPlan(false);
                    setPlanError(undefined);
                  }}
                  onLoadDemoPlan={loadDemoPlan}
                  onRecalculatePlan={handleRecalculatePlan}
                  scannedFiles={cbom.scannedFiles}
                />
              )}

              {activeNav === "Report" && (
                <ReportView
                  rawText={rawCbomText}
                  sourceName={sourceName}
                  findings={cbom.findings}
                  timestamp={cbom.timestamp}
                  plan={plan}
                  isDemoPlan={isDemoPlan}
                  scannedFiles={cbom.scannedFiles}
                />
              )}
            </div>
          )}

      {/* AskView is preserved across tab navigation so in-flight queries and chat history remain intact */}
      <div className={activeNav === "Ask" ? "h-full" : "hidden"}>
        <AskView
          rawCbomText={rawCbomText}
          scanId={cbom.serialNumber}
          plan={plan}
        />
      </div>

      {shelfLifeModal && (
        <ShelfLifeModal
          assetName={shelfLifeModal.assetName}
          entry={shelfLifeModal.entry}
          onClose={() => setShelfLifeModal(undefined)}
        />
      )}
    </AppShell>
  );
}

export default App;
