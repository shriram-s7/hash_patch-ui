import { useMemo, useState } from "react";
import type { Finding, ParsedCbom } from "./cbom/types";
import { parseCbomDocument } from "./cbom/cbomToFindings";
import { parsePlanDocument } from "./plan/parsePlan";
import type { ParsedPlan } from "./plan/types";
import { AppShell, type NavItem } from "./AppShell";
import { EntryScreen } from "./EntryScreen";
import { HomeView } from "./HomeView";
import { RepositoryView } from "./RepositoryView";
import { FindingsTable } from "./FindingsTable";
import { DetailPanel } from "./DetailPanel";
import { UniqueFindingDetailPanel, groupUniqueFindings } from "./UniqueFindingsPanel";
import { GraphMode } from "./GraphMode";
import { BlastRadiusView } from "./BlastRadiusView";
import { MigrationView } from "./MigrationView";
import { ReportView } from "./ReportView";
import { AskView } from "./AskView";
import { SettingsView } from "./SettingsView";
import { FeedbackView } from "./FeedbackView";
import { ResizableDivider } from "./components/ResizableDivider";
import { SERVICE_BASE_URL } from "./serviceUrl";
import { addToHistory } from "./scanHistory";
import { FEATURE_GUIDED_UI } from "./tour/flags";
import { Layers, ListFilter } from "lucide-react";

const FINDINGS_DETAIL_WIDTH_KEY = "findings-detail-width";
const FINDINGS_DETAIL_WIDTH_DEFAULT = 380;
const FINDINGS_DETAIL_WIDTH_MIN = 320;
const FINDINGS_DETAIL_WIDTH_MAX = 560;

export function App() {
  const [cbom, setCbom] = useState<ParsedCbom | undefined>(undefined);
  const [rawCbomText, setRawCbomText] = useState<string | undefined>(undefined);
  const [sourceName, setSourceName] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [findingsViewMode, setFindingsViewMode] = useState<"all" | "unique">("all");
  const [selectedUniqueKey, setSelectedUniqueKey] = useState<string | undefined>(undefined);
  const [activeNav, setActiveNav] = useState<NavItem>("Home");
  // Full file view (inside Repository) wants the whole viewport width, so
  // the global sidebar hides while it's open -- set by RepositoryView via
  // onImmersiveChange, gated by activeNav so navigating away always shows
  // the sidebar again even if that internal state is stale.
  const [fileViewActive, setFileViewActive] = useState(false);
  const [findingsDetailWidth, setFindingsDetailWidth] = useState(() => {
    const saved = localStorage.getItem(FINDINGS_DETAIL_WIDTH_KEY);
    return saved ? parseInt(saved) : FINDINGS_DETAIL_WIDTH_DEFAULT;
  });

  const handleFindingsDetailResize = (delta: number) => {
    if (delta === 0) {
      setFindingsDetailWidth(FINDINGS_DETAIL_WIDTH_DEFAULT);
      localStorage.removeItem(FINDINGS_DETAIL_WIDTH_KEY);
      return;
    }
    setFindingsDetailWidth((w) => {
      // The divider sits to the LEFT of this panel, so dragging it right
      // (positive delta) should shrink the panel, not grow it.
      const next = Math.min(FINDINGS_DETAIL_WIDTH_MAX, Math.max(FINDINGS_DETAIL_WIDTH_MIN, w - delta));
      localStorage.setItem(FINDINGS_DETAIL_WIDTH_KEY, String(next));
      return next;
    });
  };

  const [plan, setPlan] = useState<ParsedPlan | undefined>(undefined);
  const [isDemoPlan, setIsDemoPlan] = useState<boolean>(false);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [budgetDays, setBudgetDays] = useState<number>(5.0);
  const [planError, setPlanError] = useState<string | undefined>(undefined);
  const [isRescanning, setIsRescanning] = useState(false);

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
    setActiveNav("Home");
    setPlan(undefined);
    setIsDemoPlan(false);
    setPlanError(undefined);

    addToHistory({
      target: targetPath,
      timestamp: Date.now(),
      findingCount: parsed.findings.length,
    });

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
    setActiveNav("Home");
    setPlan(undefined);
    setIsDemoPlan(false);
    setPlanError(undefined);

    addToHistory({
      target: fileName,
      timestamp: Date.now(),
      findingCount: parsed.findings.length,
    });

    try {
      const parsedObj = JSON.parse(rawJson);
      void optimizeScan(parsedObj, budgetDays);
    } catch {
      // ignore
    }
  }

  async function handleScanPath(pathToScan = sourceName) {
    const target = pathToScan.trim().replace(/^["']|["']$/g, "");
    if (!target || isRescanning) return;
    setIsRescanning(true);
    try {
      const response = await fetch(`${SERVICE_BASE_URL}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      if (!response.ok) {
        const errData = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(errData.detail || `Scan failed with HTTP status ${response.status}`);
      }
      const cbomJson = (await response.json()) as Record<string, unknown>;
      handleScanSuccess(JSON.stringify(cbomJson, null, 2), parseCbomDocument(cbomJson), target);
    } catch (err) {
      console.error("Scan failed:", err);
    } finally {
      setIsRescanning(false);
    }
  }

  const handleRescan = () => void handleScanPath(sourceName);

  function handleNewScan() {
    setCbom(undefined);
    setRawCbomText(undefined);
    setSourceName("");
    setSelectedId(undefined);
    setActiveNav("Home");
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

  const uniqueGroups = useMemo(
    () => (cbom?.findings ? groupUniqueFindings(cbom.findings) : []),
    [cbom?.findings],
  );
  const selectedUniqueGroup = useMemo(
    () => uniqueGroups.find((g) => g.key === selectedUniqueKey),
    [uniqueGroups, selectedUniqueKey],
  );

  // Screen 0 - Entry state before any scan exists. Settings and Feedback
  // are app-level (not scan-dependent), so they're reachable here too --
  // everything else in the sidebar has nothing to navigate to yet.
  if (!cbom) {
    return (
      <AppShell
        activeNav={activeNav}
        onNavChange={setActiveNav}
        sourceName=""
        onNewScan={() => {}}
        hasScan={false}
        findingsCount={0}
      >
        {activeNav === "Settings" ? (
          <SettingsView />
        ) : activeNav === "Feedback" ? (
          <FeedbackView />
        ) : (
          <EntryScreen onScanSuccess={handleScanSuccess} onFileLoaded={handleFileLoaded} />
        )}
      </AppShell>
    );
  }

  return (
    <AppShell
      activeNav={activeNav}
      onNavChange={setActiveNav}
      sourceName={sourceName}
      onNewScan={handleNewScan}
      hasScan={true}
      findingsCount={cbom.findings.length}
      immersive={activeNav === "Repository" && fileViewActive}
    >
          {activeNav !== "Ask" && (
            <div key={activeNav} className="animate-mode-in h-full">
              {activeNav === "Home" && (
                <HomeView
                  sourceName={sourceName}
                  timestamp={cbom.timestamp}
                  findings={cbom.findings}
                  scannedFiles={cbom.scannedFiles}
                  onNavigate={setActiveNav}
                  onRescan={() => void handleRescan()}
                  isRescanning={isRescanning}
                  onClearScan={handleNewScan}
                  rawCbomText={rawCbomText}
                  onLoadScan={(target) => void handleScanPath(target)}
                />
              )}

              {activeNav === "Repository" && (
                <RepositoryView
                  sourceName={sourceName}
                  findings={cbom.findings}
                  scannedFiles={cbom.scannedFiles}
                  timestamp={cbom.timestamp}
                  onNavigate={setActiveNav}
                  onRescan={() => void handleRescan()}
                  isRescanning={isRescanning}
                  onImmersiveChange={setFileViewActive}
                  rawCbomText={rawCbomText}
                  onClearScan={handleNewScan}
                  onLoadScan={(target) => void handleScanPath(target)}
                />
              )}

              {activeNav === "Findings" && (
                <div className="flex h-full flex-col overflow-hidden p-4 sm:p-6" style={{ background: "#0d1117" }}>
                  <div className="shrink-0 border-b pb-3" style={{ borderColor: "#21262d" }}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <h1 className="text-2xl font-bold text-white">Cryptographic Findings</h1>
                        <p className="mt-1 text-sm" style={{ color: "#8b949e" }}>
                          {findingsViewMode === "all"
                            ? (FEATURE_GUIDED_UI
                                ? "Complete inventory of detected cryptographic assets, ordered by combined algorithmic vulnerability and runtime reachability. #1 is the highest-priority fix."
                                : "Complete inventory of detected cryptographic assets, ordered by combined algorithmic vulnerability and runtime reachability.")
                            : "Consolidated inventory of unique cryptographic algorithms, grouped across all scan occurrences."}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: "#30363d", background: "#161b22" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setFindingsViewMode("all");
                            setSelectedUniqueKey(undefined);
                          }}
                          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                            findingsViewMode === "all"
                              ? "bg-[#3b82f6] text-white shadow-sm"
                              : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc]"
                          }`}
                        >
                          <ListFilter className="h-3.5 w-3.5" />
                          <span>All Findings</span>
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                            style={{
                              background: findingsViewMode === "all" ? "rgba(255,255,255,0.2)" : "#21262d",
                              color: findingsViewMode === "all" ? "#ffffff" : "#8b949e",
                            }}
                          >
                            {cbom.findings.length}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFindingsViewMode("unique");
                            setSelectedId(undefined);
                          }}
                          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                            findingsViewMode === "unique"
                              ? "bg-[#3b82f6] text-white shadow-sm"
                              : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc]"
                          }`}
                        >
                          <Layers className="h-3.5 w-3.5" />
                          <span>Unique Only</span>
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                            style={{
                              background: findingsViewMode === "unique" ? "rgba(255,255,255,0.2)" : "#21262d",
                              color: findingsViewMode === "unique" ? "#ffffff" : "#8b949e",
                            }}
                          >
                            {uniqueGroups.length}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 gap-0 pt-4">
                    <div className="min-w-0 flex-1 overflow-y-auto">
                      <FindingsTable
                        findings={cbom.findings}
                        selectedId={selectedId}
                        onSelect={(f) => setSelectedId(f.id)}
                        viewMode={findingsViewMode}
                        onViewModeChange={(m) => {
                          setFindingsViewMode(m);
                          if (m === "all") setSelectedUniqueKey(undefined);
                          else setSelectedId(undefined);
                        }}
                        selectedUniqueKey={selectedUniqueKey}
                        onSelectUniqueGroup={(g) => setSelectedUniqueKey(g.key)}
                      />
                    </div>
                    {findingsViewMode === "all" && selectedFinding && (
                      <>
                        <ResizableDivider onResize={handleFindingsDetailResize} />
                        <div className="shrink-0 overflow-hidden" style={{ width: findingsDetailWidth, minWidth: 320 }}>
                          <DetailPanel finding={selectedFinding} onClose={() => setSelectedId(undefined)} />
                        </div>
                      </>
                    )}
                    {findingsViewMode === "unique" && selectedUniqueGroup && (
                      <>
                        <ResizableDivider onResize={handleFindingsDetailResize} />
                        <div className="shrink-0 overflow-hidden" style={{ width: findingsDetailWidth, minWidth: 360 }}>
                          <UniqueFindingDetailPanel
                            group={selectedUniqueGroup}
                            onClose={() => setSelectedUniqueKey(undefined)}
                            onSelectFinding={(f) => {
                              setSelectedId(f.id);
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {activeNav === "Relationships" && (
                <div className="h-full overflow-hidden p-4 sm:p-6" style={{ background: "#0d1117" }}>
                  <GraphMode
                    findings={cbom.findings}
                    metrics={metrics}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                </div>
              )}

              {activeNav === "BlastRadius" && (
                <BlastRadiusView findings={cbom.findings} selectedId={selectedId} onSelect={setSelectedId} />
              )}

              {activeNav === "Migration" && (
                <MigrationView
                  findings={cbom.findings}
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
                  onNavigate={setActiveNav}
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
                  onNavigate={setActiveNav}
                />
              )}

              {activeNav === "Settings" && <SettingsView />}

              {activeNav === "Feedback" && <FeedbackView />}
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
    </AppShell>
  );
}

export default App;
