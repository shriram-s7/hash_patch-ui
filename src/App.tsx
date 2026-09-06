import { useMemo, useState } from "react";
import type { Finding, ParsedCbom, ShelfLifeEntry } from "./cbom/types";
import { parsePlanDocument } from "./plan/parsePlan";
import type { ParsedPlan } from "./plan/types";
import { ThemeToggle } from "./ThemeToggle";
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

type NavItem = "Repository" | "Findings" | "Relationships" | "Migration" | "Report" | "Ask";

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

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    {
      id: "Repository",
      label: "Repository",
      icon: (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      ),
    },
    {
      id: "Findings",
      label: "Findings",
      icon: (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      ),
    },
    {
      id: "Relationships",
      label: "Relationships",
      icon: (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="8" r="2.5" />
          <circle cx="10" cy="18" r="2.5" />
          <path strokeLinecap="round" d="M8 7.5l7.5 4M16 10l-4.5 6" />
        </svg>
      ),
    },
    {
      id: "Migration",
      label: "Migration",
      icon: (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 3l4 4-4 4M21 7H3M7 21l-4-4 4-4M3 17h18" />
        </svg>
      ),
    },
    {
      id: "Report",
      label: "Report",
      icon: (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
      ),
    },
    {
      id: "Ask",
      label: "Ask",
      icon: (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-page text-ink animate-mode-in">
      {/* LEFT NAVIGATION RAIL (~200px / collapsible to icon-only below 1280px) */}
      <aside className="flex flex-col border-r border-line bg-surface w-14 xl:w-52 shrink-0 transition-all">
        {/* Rail Header / Brand */}
        <div className="flex h-11 items-center border-b border-line px-3.5 xl:px-4">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <img src="./favicon.ico" alt="Hash Patch Logo" className="h-4 w-4 shrink-0 rounded-xs object-contain" />
            <span className="font-heading text-sm font-bold tracking-[0.14em] text-ink">hash patch</span>
            <span className="hidden xl:inline rounded-sm border border-line px-1.5 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
              UI
            </span>
          </div>
        </div>

        {/* Nav Items List */}
        <nav className="flex-1 space-y-0.5 py-2">
          {navItems.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                title={item.label}
                className={`flex w-full items-center gap-3 px-3.5 xl:px-4 py-2 font-heading text-xs uppercase tracking-wider transition-colors ${
                  isActive
                    ? "border-l-2 border-ink bg-surface-2 font-semibold text-ink"
                    : "border-l-2 border-transparent font-medium text-ink-secondary hover:bg-surface-2/60 hover:text-ink"
                }`}
              >
                {item.icon}
                <span className="hidden xl:inline truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Rail Footer: Target Path & New Scan */}
        <div className="border-t border-line p-2 xl:p-3 space-y-2">
          <div className="hidden xl:block space-y-0.5">
            <div className="font-heading text-[11px] uppercase tracking-wider text-ink-muted">Target</div>
            <div className="truncate font-mono text-xs text-ink-secondary" title={sourceName}>
              {sourceName}
            </div>
          </div>
          <button
            type="button"
            onClick={handleNewScan}
            title="Return to entry screen"
            className="flex w-full items-center justify-center xl:justify-start gap-1.5 rounded-sm border border-line bg-page px-2 py-1 font-heading text-xs font-medium uppercase tracking-wider text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
          >
            <span>←</span>
            <span className="hidden xl:inline">New scan</span>
          </button>
        </div>
      </aside>

      {/* RIGHT WORKSPACE AREA */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* TOP BAR: Thin, persistent, above main content */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4 sm:px-6 bg-surface">
          {/* View Title */}
          <h1 className="font-heading text-xs font-semibold uppercase tracking-widest text-ink-muted">
            {activeNav}
          </h1>

          {/* Compact Inline Metrics Strip + Theme Toggle */}
          <div className="flex items-center gap-4 text-xs">
            <div className="hidden sm:flex items-center gap-3 font-heading">
              <div className="flex items-center gap-1.5 text-ink-muted">
                <span className="text-[10px] uppercase tracking-wider">TOTAL:</span>
                <span className="font-semibold text-xs text-ink tabular-nums">{metrics.totalAssets}</span>
              </div>
              <span className="text-line-strong">•</span>
              <div className="flex items-center gap-1.5 text-ink-muted">
                <span className="text-[10px] uppercase tracking-wider">REFERENCES:</span>
                <span className="font-semibold text-xs text-ink tabular-nums">{metrics.referenceAssets}</span>
              </div>
              <span className="text-line-strong">•</span>
              <div className="flex items-center gap-1.5 text-ink-muted">
                <span className="text-[10px] uppercase tracking-wider">BROKEN BY SHOR:</span>
                <span className="font-semibold text-xs text-status-critical tabular-nums">{metrics.brokenByShor}</span>
              </div>
              <span className="text-line-strong">•</span>
              <div className="flex items-center gap-1.5 text-ink-muted">
                <span className="text-[10px] uppercase tracking-wider">CONTRADICTIONS:</span>
                <span
                  className={`font-semibold text-xs tabular-nums ${
                    metrics.contradictions > 0 ? "text-status-critical" : "text-ink"
                  }`}
                >
                  {metrics.contradictions}
                </span>
              </div>
              <span className="text-line-strong">•</span>
              <div className="group relative flex items-center gap-1.5 text-ink-muted">
                <button
                  type="button"
                  onClick={() => {
                    const finding = metrics.longestShelfLifeFinding;
                    const entry = finding ? longestShelfLifeEntry(finding) : undefined;
                    if (finding && entry) setShelfLifeModal({ assetName: finding.name, entry });
                  }}
                  className="flex cursor-help items-center gap-1.5"
                >
                  <span className="text-[10px] uppercase tracking-wider">LONGEST SHELF-LIFE:</span>
                  <span className="font-semibold text-xs text-ink tabular-nums underline decoration-dotted underline-offset-2">
                    {metrics.longestShelfLife !== undefined ? `${metrics.longestShelfLife}y` : "—"}
                  </span>
                </button>
                <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-72 rounded-sm border border-line-strong bg-surface p-3 text-left normal-case text-[11px] leading-relaxed text-ink-secondary shadow-xl group-hover:block">
                  <p>
                    The longest data-retention period found across all findings in this scan — the{" "}
                    <span className="font-mono font-semibold text-ink">X</span> in Mosca&rsquo;s inequality (
                    <span className="font-mono font-semibold text-ink">X + Y &gt; Z</span>: data shelf-life plus
                    migration time must not exceed the years until a cryptographically-relevant quantum
                    computer arrives).
                  </p>
                  <p className="mt-1.5">
                    The single longest-lived sensitive data category in your codebase sets your most urgent
                    deadline.
                  </p>
                  {metrics.longestShelfLifeFinding !== undefined && (
                    <p className="mt-1.5 font-heading text-[10px] font-semibold uppercase tracking-wider text-ink">
                      Click to see which finding — {metrics.longestShelfLifeFinding.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <span className="hidden sm:inline-block h-3.5 w-px bg-line" />
            <a
              href="https://github.com/shriram-s7/hash_patch/releases/download/v0.1.0/HashPatch-Setup.exe"
              target="_blank"
              rel="noopener noreferrer"
              title="Download standalone HashPatch-Setup.exe (Windows)"
              className="hidden md:inline-flex items-center gap-1 rounded-sm border border-line bg-surface-2 px-2 py-1 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
            >
              <span>⬇</span>
              <span>Demo App (.exe)</span>
            </a>
            <ThemeToggle />
          </div>
        </header>

        {/* MAIN VIEWPORT */}
        <main className="min-h-0 flex-1 overflow-hidden bg-page">
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
        </main>
      </div>

      {shelfLifeModal && (
        <ShelfLifeModal
          assetName={shelfLifeModal.assetName}
          entry={shelfLifeModal.entry}
          onClose={() => setShelfLifeModal(undefined)}
        />
      )}
    </div>
  );
}

export default App;
