import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  ShieldAlert,
  TriangleAlert,
  Target,
  CircleCheck,
  FileText,
  ListChecks,
  Clock,
  Download,
  Share2,
  Check,
} from "lucide-react";
import { displayName, type Finding } from "./cbom/types";
import type { ParsedPlan, PlanScenario } from "./plan/types";
import type { NavItem } from "./AppShell";
import { buildRepositoryTree } from "./repositoryTree";
import { compareFindingsPriority } from "./priority";
import { getRecommendationForFinding } from "./pqcRecommendations";
import { OverflowBar, BlastRadiusEmptyState } from "./charts";
import { ShockwaveDiagram } from "./BlastRadiusView";

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip);

interface ReportViewProps {
  rawText: string | undefined;
  sourceName: string;
  findings: Finding[];
  timestamp: string | undefined;
  plan: ParsedPlan | undefined;
  isDemoPlan?: boolean;
  scannedFiles?: string[];
  onNavigate?: (nav: NavItem) => void;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "Unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown time";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function reachabilityLabel(f: Finding): { text: string; color: string } {
  if (f.mixedReachability) return { text: "Mixed", color: "#f59e0b" };
  switch (f.reachability) {
    case "live-external":
      return { text: "Live (entry)", color: "#ef4444" };
    case "live-internal":
      return { text: "Live (internal)", color: "#f59e0b" };
    case "inert":
      return { text: "Inert", color: "#6b7280" };
    default:
      return { text: "Unknown", color: "#6b7280" };
  }
}

const QUANTUM_PILL: Record<string, { label: string; bg: string }> = {
  "broken-by-shor": { label: "Broken by Shor", bg: "#ef4444" },
  "weakened-by-grover": { label: "Weakened by Grover", bg: "#f59e0b" },
  "broken-classically": { label: "Broken classically", bg: "#6b7280" },
  "quantum-safe": { label: "Quantum-safe", bg: "#22c55e" },
  unknown: { label: "Unknown", bg: "#6b7280" },
  "algorithm-opaque-provider-managed": { label: "Algorithm opaque", bg: "#8b5cf6" },
};

function shelfLifeLabel(years: number | undefined): string {
  if (years === undefined) return "—";
  return `${years} ${years === 1 ? "yr" : "yrs"}`;
}

/** Short "what happened here" phrase built from the finding's evidence
 * snippet, so the report reads like a real triage list rather than a bare
 * algorithm name. */
function issueLabel(f: Finding): string {
  const snippet = (f.evidence[0]?.snippet ?? "").toLowerCase();
  const name = displayName(f);
  if (snippet.includes("generate")) return `${name} key generation`;
  if (f.primitive === "key-agreement") return `${name} key exchange`;
  if (f.primitive === "signature") return `${name} signature`;
  if (f.primitive === "hash") return `${name} hash computation`;
  return `${name} usage`;
}

/** Status pill: a filled badge on screen, but PLAIN COLORED TEXT (no fill)
 * in the PDF export — background-color fidelity varies across PDF
 * renderers/printers, text color does not. */
function QuantumPill({ status, pdfMode }: { status: string | undefined; pdfMode: boolean }) {
  const pill = status ? QUANTUM_PILL[status] : undefined;
  if (!pill) return <span style={{ color: "#6e7681" }}>—</span>;
  if (pdfMode) {
    return (
      <span className="text-[11px] font-semibold" style={{ color: pill.bg }}>
        {pill.label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: pill.bg }}>
      {pill.label}
    </span>
  );
}

const SECTIONS: { id: string; label: string }[] = [
  { id: "executive-summary", label: "Executive Summary" },
  { id: "algorithm-analysis", label: "Algorithm Analysis" },
  { id: "migration-plan", label: "Migration Plan" },
  { id: "blast-radius", label: "Blast Radius" },
  { id: "recommendations", label: "Recommendations" },
];

/** Jump-to-interactive-view card, closing every static report section — a
 * real in-app NavItem switch (this app has no router/URL routes), not an
 * `<a href>`. */
function LinkCard({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors"
      style={{ background: "#0d1a2e", borderLeft: "4px solid #3b82f6" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(13,26,46,0.7)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "#0d1a2e")}
    >
      <span className="shrink-0" style={{ color: "#3b82f6" }}>↗</span>
      <span className="text-sm" style={{ color: "#94b4d4" }}>{label}</span>
    </button>
  );
}

function SectionCard({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 rounded-xl border p-5" style={{ borderColor: "#21262d", background: "#161b22" }}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PdfPageHeader({ sourceName, timestamp }: { sourceName: string; timestamp: string | undefined }) {
  return (
    <div className="flex items-center justify-between border-b pb-2.5 mb-3" style={{ borderColor: "#21262d" }}>
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded" style={{ background: "#3b82f6" }}>
          <ShieldAlert className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-xs font-bold tracking-wider text-white">HASH PATCH</span>
        <span className="text-[10px]" style={{ color: "#484f58" }}>|</span>
        <span className="text-[11px] font-semibold" style={{ color: "#8b949e" }}>Post-Quantum Readiness Assessment</span>
      </div>
      <div className="text-right">
        <div className="text-[10px] font-mono truncate max-w-[320px] text-white">{sourceName}</div>
        <div className="text-[9px]" style={{ color: "#8b949e" }}>{formatTimestamp(timestamp)}</div>
      </div>
    </div>
  );
}

function PdfPageFooter({ pageNum, totalPages }: { pageNum: number; totalPages: number }) {
  return (
    <div className="flex items-center justify-between border-t pt-2 mt-auto text-[10px]" style={{ borderColor: "#21262d", color: "#6e7681" }}>
      <span>Hash Patch · Post-Quantum Cryptographic Assessment Report</span>
      <span className="font-medium text-white">Page {pageNum} of {totalPages}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Migration Plan — static (no scrubber, no budget input): scenario summary
// line, a plain segments bar, and the full scheduled-tasks table.
// ---------------------------------------------------------------------------

const SCHEDULE_BAR_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4"];

function MigrationPlanSection({
  scenario,
  budgetDays,
  findings,
  pdfMode,
}: {
  scenario: PlanScenario | undefined;
  budgetDays: number | undefined;
  findings: Finding[];
  pdfMode: boolean;
}) {
  if (!scenario) {
    return <p className="text-sm" style={{ color: "#8b949e" }}>No migration plan has been calculated for this scan yet.</p>;
  }
  const totalDays = budgetDays ?? Math.max(1, ...scenario.schedule.map((s) => s.endDay));

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-white">
        Scenario &ldquo;{scenario.name}&rdquo;{scenario.estimatedYear !== undefined ? ` (~${scenario.estimatedYear})` : ""}:{" "}
        {scenario.schedule.length} asset{scenario.schedule.length === 1 ? "" : "s"} scheduled over {totalDays} day
        {totalDays === 1 ? "" : "s"}.
      </p>
      {scenario.headline !== undefined && <p className="text-sm" style={{ color: "#c9d1d9" }}>{scenario.headline}</p>}

      <div className="flex h-6 w-full overflow-hidden rounded-lg border" style={{ borderColor: "#21262d", background: "#0d1117" }}>
        {scenario.schedule.map((item, i) => {
          const widthPct = totalDays > 0 ? ((item.endDay - item.startDay) / totalDays) * 100 : 0;
          return (
            <div
              key={i}
              style={{ width: `${widthPct}%`, background: SCHEDULE_BAR_COLORS[i % SCHEDULE_BAR_COLORS.length] }}
              className="border-r last:border-r-0"
            />
          );
        })}
      </div>

      {scenario.unmigratedFindingIds.length > 0 && (
        <p className="text-xs" style={{ color: "#f59e0b" }}>
          {scenario.unmigratedFindingIds.length} finding{scenario.unmigratedFindingIds.length === 1 ? "" : "s"} deferred due to
          budget limit.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-xs">
          <thead>
            <tr>
              {["#", "Asset", "Quantum Status", "Reachability", "Priority Score", "Day Window", "Effort"].map((h, i) => (
                <th
                  key={h}
                  className={`border-b pb-2 pr-3 font-medium uppercase tracking-wide ${i === 0 || i >= 4 ? "text-right" : "text-left"}`}
                  style={{ borderColor: "#21262d", color: "#6e7681", fontSize: 10 }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenario.schedule.map((item, i) => {
              const correlated = findings.find(
                (f) =>
                  f.id === item.findingId ||
                  f.name.toLowerCase() === item.name.toLowerCase() ||
                  item.name.toLowerCase().includes(f.name.toLowerCase()),
              );
              const reach = correlated ? reachabilityLabel(correlated) : undefined;
              return (
                <tr key={i} className="border-b" style={{ borderColor: "#21262d" }}>
                  <td className="py-2 pr-3 text-right tabular-nums" style={{ color: "#8b949e" }}>{i + 1}</td>
                  <td className="py-2 pr-3 font-semibold text-white">{item.name}</td>
                  <td className="py-2 pr-3">
                    <QuantumPill status={correlated?.quantumStatus} pdfMode={pdfMode} />
                  </td>
                  <td className="py-2 pr-3">
                    {reach ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: reach.color }} />
                        <span style={{ color: "#c9d1d9" }}>{reach.text}</span>
                      </span>
                    ) : (
                      <span style={{ color: "#6e7681" }}>—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums" style={{ color: "#c9d1d9" }}>
                    {item.riskScore !== undefined ? item.riskScore.toFixed(1) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums" style={{ color: "#c9d1d9" }}>
                    {item.startDay}–{item.endDay}
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums text-white">
                    {item.costDays !== undefined ? `${item.costDays}d` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blast Radius — total impact card across every qualifying asset, then one
// buffer-card group + static shockwave diagram per asset. No simulate
// button anywhere (OverflowBar and ShockwaveDiagram are both already
// non-interactive, built for exactly this report use).
// ---------------------------------------------------------------------------

function BlastRadiusSection({
  findings,
  scannedFiles,
}: {
  findings: Finding[];
  scannedFiles?: string[];
}) {
  const qualifying = findings.filter((f) => f.blastRadius.length > 0);
  if (qualifying.length === 0) {
    return <BlastRadiusEmptyState scannedFiles={scannedFiles} findings={findings} />;
  }

  const allEntries = qualifying.flatMap((f) => f.blastRadius);
  const maxBytes = allEntries.reduce((m, e) => Math.max(m, e.declaredBytes ?? 0, e.pqcBytes ?? 0), 1);
  const totalDeclared = allEntries.reduce((s, e) => s + (e.declaredBytes ?? 0), 0);
  const totalRequired = allEntries.reduce((s, e) => s + (e.pqcBytes ?? 0), 0);
  const totalOverflow = totalRequired - totalDeclared;
  const declaredPct = Math.min(100, (totalDeclared / Math.max(totalRequired, 1)) * 100);

  return (
    <div className="space-y-4">
      {totalDeclared > 0 && (
        <div className="rounded-xl border p-4" style={{ background: "#0d1117", borderColor: "#21262d" }}>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#8b949e" }}>
            Total Buffer Impact — all scanned assets
          </h4>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs" style={{ color: "#8b949e" }}>Declared total</p>
              <p className="text-sm font-bold" style={{ color: "#f0f6fc" }}>{totalDeclared.toLocaleString()} bytes</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "#8b949e" }}>PQC required</p>
              <p className="text-sm font-bold" style={{ color: "#f59e0b" }}>{totalRequired.toLocaleString()} bytes</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: "#8b949e" }}>Total overflow</p>
              <p className="text-sm font-bold" style={{ color: "#ef4444" }}>
                {totalOverflow > 0 ? "+" : ""}
                {totalOverflow.toLocaleString()} bytes
              </p>
            </div>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full" style={{ background: "#21262d" }}>
            <div className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: `${declaredPct}%`, background: "#3b82f6" }} />
            {declaredPct < 100 && (
              <div className="absolute inset-y-0 rounded-r-full" style={{ left: `${declaredPct}%`, right: 0, background: "#ef4444" }} />
            )}
          </div>
        </div>
      )}

      {qualifying.map((f) => (
        <div key={f.id} className="rounded-xl border p-4" style={{ borderColor: "#21262d" }}>
          <h4 className="text-sm font-bold text-white">{displayName(f)}</h4>
          <div className="mt-2 space-y-2">
            {f.blastRadius.map((entry, i) => (
              <OverflowBar key={i} entry={entry} maxBytes={maxBytes} />
            ))}
          </div>
          <ShockwaveDiagram findings={findings} center={f} />
        </div>
      ))}
    </div>
  );
}

export function ReportView({ rawText, sourceName, findings, timestamp, plan, scannedFiles, onNavigate }: ReportViewProps) {
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [contentHash, setContentHash] = useState<string | undefined>(undefined);
  const [activeSection, setActiveSection] = useState(SECTIONS[0]!.id);
  const scrollRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rawText === undefined) {
      setContentHash(undefined);
      return;
    }
    sha256Hex(rawText).then(setContentHash);
  }, [rawText]);

  // Scrollspy: highlight whichever section's heading is nearest the top of
  // the viewport, under the sticky nav.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveSection(visible[0]!.target.id);
      },
      { rootMargin: "-96px 0px -70% 0px", threshold: 0 },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const operationFindings = useMemo(() => findings.filter((f) => f.findingType !== "CRYPTO_REFERENCE"), [findings]);

  const statusCounts = useMemo(() => {
    const c = { shor: 0, grover: 0, classic: 0, safe: 0 };
    for (const f of operationFindings) {
      if (f.quantumStatus === "broken-by-shor") c.shor++;
      else if (f.quantumStatus === "weakened-by-grover") c.grover++;
      else if (f.quantumStatus === "broken-classically") c.classic++;
      else if (f.quantumStatus === "quantum-safe") c.safe++;
    }
    return c;
  }, [operationFindings]);
  const donutTotal = statusCounts.shor + statusCounts.grover + statusCounts.classic + statusCounts.safe;

  const filesScanned = scannedFiles?.length ?? new Set(operationFindings.flatMap((f) => f.evidence.map((e) => e.locator).filter(Boolean))).size;
  const algorithmsDetected = new Set(operationFindings.map((f) => displayName(f))).size;

  const totalEffortDays = useMemo(() => {
    let total = 0;
    for (const f of findings) {
      for (const b of f.blastRadius) {
        if (b.estimatedEffortDays !== undefined) total += b.estimatedEffortDays;
      }
    }
    return total;
  }, [findings]);

  const topAlgorithms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of operationFindings) counts.set(displayName(f), (counts.get(displayName(f)) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((sum, [, n]) => sum + n, 0);
    const rows = top.map(([name, count]) => ({ name, count }));
    if (rest > 0) rows.push({ name: "Others", count: rest });
    return rows;
  }, [operationFindings]);
  const maxAlgoCount = Math.max(1, ...topAlgorithms.map((r) => r.count));
  const ALGO_COLORS = ["#ef4444", "#f59e0b", "#eab308", "#6b7280", "#6b7280", "#4b5563"];

  const findingsByDirectory = useMemo(() => {
    const tree = buildRepositoryTree(findings, sourceName, scannedFiles);
    return tree.children
      .filter((n) => n.isFolder)
      .map((n) => ({ name: `${n.name}/`, count: n.totalFindings }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [findings, sourceName, scannedFiles]);
  const maxDirCount = Math.max(1, ...findingsByDirectory.map((r) => r.count));
  const DIR_COLORS = ["#8b5cf6", "#a78bfa", "#a78bfa", "#c4b5fd", "#c4b5fd", "#c4b5fd"];

  const shelfLifeBuckets = useMemo(() => {
    const b = { under1: 0, oneToFive: 0, fiveToTen: 0, overTen: 0 };
    for (const f of operationFindings) {
      const y = f.longestShelfLifeYears;
      if (y === undefined) continue;
      if (y < 1) b.under1++;
      else if (y <= 5) b.oneToFive++;
      else if (y <= 10) b.fiveToTen++;
      else b.overTen++;
    }
    return b;
  }, [operationFindings]);

  const sortedFindings = useMemo(() => [...operationFindings].sort(compareFindingsPriority), [operationFindings]);
  const keyFindings = sortedFindings.slice(0, 10);

  const recommendations = useMemo(() => {
    const seen = new Set<string>();
    const rows: { algorithm: string; rec: ReturnType<typeof getRecommendationForFinding> }[] = [];
    for (const f of sortedFindings) {
      const name = displayName(f);
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push({ algorithm: name, rec: getRecommendationForFinding(f, f.evidence[0]?.snippet ?? "") });
    }
    return rows;
  }, [sortedFindings]);

  const defaultScenario = useMemo(
    () =>
      plan?.scenarios.reduce<PlanScenario | undefined>(
        (best, s) => (best === undefined || (s.probabilityWeight ?? 0) > (best.probabilityWeight ?? 0) ? s : best),
        undefined,
      ),
    [plan],
  );

  const pdfHasSecondFindingsPage = sortedFindings.length > 18;
  const pdfTotalPages = sortedFindings.length === 0 ? 3 : pdfHasSecondFindingsPage ? 5 : 4;

  const handleExportPdf = async () => {
    setPdfExporting(true);
    setPdfStatus("Preparing PDF…");
    try {
      const [{ default: html2canvas }, jsPdfModule] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const JsPDF =
        (jsPdfModule as unknown as { jsPDF?: new (opts: unknown) => any }).jsPDF ??
        (jsPdfModule as unknown as { default: new (opts: unknown) => any }).default;

      const container = document.getElementById("pdf-pages-container");
      if (!container) throw new Error("report pages container not found");

      const pageElements = Array.from(container.querySelectorAll<HTMLElement>(".pdf-page"));
      if (pageElements.length === 0) throw new Error("No report pages found");

      const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = 210;
      const pageHeight = 297;

      for (let i = 0; i < pageElements.length; i++) {
        setPdfStatus(`Rendering page ${i + 1} of ${pageElements.length}…`);

        // Isolate each page during capture so there is zero overlap or coordinate confusion
        pageElements.forEach((el, idx) => {
          el.style.display = idx === i ? "flex" : "none";
        });

        if (i === 0) {
          // Give browser layout and Chart.js canvases 80ms to settle
          await new Promise((resolve) => setTimeout(resolve, 80));
        }

        const pageEl = pageElements[i];
        const canvas = await html2canvas(pageEl, {
          scale: 2,
          backgroundColor: "#0d1117",
          useCORS: true,
          logging: false,
          windowWidth: 800,
          windowHeight: 1130,
          scrollX: 0,
          scrollY: 0,
        });

        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "FAST");
      }

      const safeName = sourceName.replace(/[^a-zA-Z0-9_-]/g, "_");
      pdf.save(`hash_patch_report_${safeName}.pdf`);
    } catch (err) {
      console.error("PDF export failed, falling back to print:", err);
      window.print();
    } finally {
      // Restore all page elements to display: flex
      const container = document.getElementById("pdf-pages-container");
      if (container) {
        const pageElements = Array.from(container.querySelectorAll<HTMLElement>(".pdf-page"));
        pageElements.forEach((el) => {
          el.style.display = "flex";
        });
      }
      setPdfExporting(false);
      setPdfStatus(null);
    }
  };

  const handleShare = () => {
    const summary = [
      `Hash Patch — Post-Quantum Readiness Assessment`,
      `Target: ${sourceName}`,
      `Generated: ${formatTimestamp(timestamp)}`,
      `Findings: ${operationFindings.length} (${statusCounts.shor} broken by Shor, ${statusCounts.grover} weakened by Grover)`,
      contentHash ? `CBOM SHA-256: ${contentHash}` : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard
      ?.writeText(summary)
      .then(() => {
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div ref={scrollRootRef} className="h-full overflow-y-auto" style={{ background: "#0d1117" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6" style={{ borderColor: "#21262d" }}>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(139,92,246,0.15)" }}>
              <ShieldAlert className="h-7 w-7 shrink-0" style={{ color: "#a78bfa" }} strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#22c55e" }}>
                Report
              </div>
              <h1 className="text-2xl font-bold text-white">Post-Quantum Readiness Assessment</h1>
              <p className="mt-1 max-w-xl text-sm" style={{ color: "#8b949e" }}>
                A comprehensive analysis of your codebase, cryptographic assets, vulnerabilities, and migration effort.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleExportPdf()}
                disabled={pdfExporting}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: "#30363d" }}
              >
                <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                {pdfStatus ?? (pdfExporting ? "Generating…" : "Export PDF")}
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "#3b82f6" }}
              >
                {shared ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> : <Share2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />}
                {shared ? "Copied!" : "Share Report"}
              </button>
            </div>
            <span className="text-[11px]" style={{ color: "#8b949e" }}>
              Generated on {formatTimestamp(timestamp)}
            </span>
          </div>
        </div>

        {/* Severity tiles */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: ShieldAlert, iconColor: "#ef4444", tint: "rgba(239,68,68,0.06)", value: statusCounts.shor, label: "Critical Findings", labelColor: "#ef4444", sub: "Require immediate migration" },
            { icon: TriangleAlert, iconColor: "#f59e0b", tint: "rgba(245,158,11,0.06)", value: statusCounts.grover, label: "High / Medium", labelColor: "#f59e0b", sub: "Plan migration" },
            { icon: Target, iconColor: "#3b82f6", tint: "rgba(59,130,246,0.06)", value: statusCounts.classic, label: "Broken Classically", labelColor: "#ffffff", sub: "Fix in regular cycle" },
            { icon: CircleCheck, iconColor: "#22c55e", tint: "rgba(34,197,94,0.06)", value: statusCounts.safe, label: "Quantum-safe", labelColor: "#22c55e", sub: "No action needed" },
          ].map(({ icon: Icon, iconColor, tint, value, label, labelColor, sub }) => (
            <div key={label} className="rounded-xl border p-5" style={{ borderColor: "#21262d", background: tint }}>
              <Icon className="h-9 w-9 shrink-0" style={{ color: iconColor }} strokeWidth={1.75} aria-hidden="true" />
              <div className="mt-3 text-2xl font-bold text-white tabular-nums">{value}</div>
              <div className="text-sm font-semibold" style={{ color: labelColor }}>
                {label}
              </div>
              <div className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>
                {sub}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky section nav */}
      <nav
        className="sticky top-0 z-20 flex gap-6 overflow-x-auto px-6 py-3"
        style={{ background: "rgba(13,17,23,0.95)", borderBottom: "1px solid #21262d", backdropFilter: "blur(8px)" }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="shrink-0 whitespace-nowrap border-b-2 pb-1 text-sm transition-colors"
            style={{
              color: activeSection === s.id ? "#f0f6fc" : "#8b949e",
              fontWeight: activeSection === s.id ? 500 : 400,
              borderColor: activeSection === s.id ? "#3b82f6" : "transparent",
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-5">
        {/* Executive Summary */}
        <section id="executive-summary" className="scroll-mt-16 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[55%_1fr]">
            <div className="rounded-xl border-l-4 border p-5" style={{ borderColor: "#21262d", borderLeftColor: "#3b82f6", background: "#161b22" }}>
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: "rgba(59,130,246,0.15)" }}>
                  <FileText className="h-4 w-4 shrink-0" style={{ color: "#3b82f6" }} strokeWidth={2} aria-hidden="true" />
                </div>
                <span className="text-sm font-bold text-white">Executive Summary</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "#c9d1d9" }}>
                Hash Patch scanned {filesScanned} files in {sourceName} and identified {operationFindings.length} cryptographic
                findings across {algorithmsDetected} algorithms.{" "}
                <span style={{ color: "#ef4444", fontWeight: 600 }}>{statusCounts.shor} findings</span> are vulnerable to quantum
                attacks (broken by Shor's algorithm) and require immediate migration.
                {totalEffortDays > 0 && ` An estimated ${totalEffortDays}d is needed for migration.`}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-3" style={{ borderColor: "#21262d" }}>
                <div>
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                    <span className="text-lg font-bold text-white tabular-nums">{filesScanned}</span>
                  </div>
                  <div className="text-xs" style={{ color: "#8b949e" }}>Files Scanned</div>
                  <div className="text-[11px]" style={{ color: "#6e7681" }}>Local scan</div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                    <span className="text-lg font-bold text-white tabular-nums">{operationFindings.length}</span>
                  </div>
                  <div className="text-xs" style={{ color: "#8b949e" }}>Total Findings</div>
                  <div className="text-[11px]" style={{ color: "#ef4444" }}>{statusCounts.shor} critical</div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                    <span className="text-lg font-bold text-white tabular-nums">{totalEffortDays}d</span>
                  </div>
                  <div className="text-xs" style={{ color: "#8b949e" }}>Estimated Effort</div>
                  <div className="text-[11px]" style={{ color: "#6e7681" }}>For full migration</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-5" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <h3 className="text-sm font-semibold text-white">Risk Distribution</h3>
              {donutTotal === 0 ? (
                <div className="flex h-[180px] items-center justify-center text-xs" style={{ color: "#6e7681" }}>
                  No findings to chart.
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-4">
                  <div className="relative h-[150px] w-[150px] shrink-0">
                    <Doughnut
                      data={{
                        labels: ["Broken by Shor", "Weakened by Grover", "Broken classically", "Quantum-safe"],
                        datasets: [{ data: [statusCounts.shor, statusCounts.grover, statusCounts.classic, statusCounts.safe], backgroundColor: ["#ef4444", "#f59e0b", "#6b7280", "#22c55e"], borderColor: "#161b22", borderWidth: 2 }],
                      }}
                      options={{ responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false }, tooltip: { enabled: true } } }}
                    />
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-bold text-white tabular-nums">{donutTotal}</span>
                      <span className="text-[10px]" style={{ color: "#8b949e" }}>Findings</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {[
                      { label: "Broken by Shor", value: statusCounts.shor, color: "#ef4444" },
                      { label: "Weakened by Grover", value: statusCounts.grover, color: "#f59e0b" },
                      { label: "Broken classically", value: statusCounts.classic, color: "#6b7280" },
                      { label: "Quantum-safe", value: statusCounts.safe, color: "#22c55e" },
                    ].map((s) => (
                      <div key={s.label} className="flex items-center gap-2 text-xs">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate" style={{ color: "#c9d1d9" }}>{s.label}</span>
                        <span className="shrink-0 font-medium text-white tabular-nums">
                          {s.value} ({donutTotal > 0 ? Math.round((s.value / donutTotal) * 100) : 0}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border p-5" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <h3 className="text-sm font-semibold text-white">Top Affected Algorithms</h3>
              {topAlgorithms.length === 0 ? (
                <div className="flex h-[160px] items-center justify-center text-xs" style={{ color: "#6e7681" }}>No findings.</div>
              ) : (
                <div className="mt-4 space-y-3">
                  {topAlgorithms.map((row, i) => (
                    <div key={row.name} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 truncate text-xs font-medium text-white" title={row.name}>{row.name}</span>
                      <div className="h-2.5 flex-1 rounded-full" style={{ background: "#21262d" }}>
                        <div className="h-2.5 rounded-full" style={{ width: `${(row.count / maxAlgoCount) * 100}%`, background: ALGO_COLORS[i] ?? "#4b5563" }} />
                      </div>
                      <span className="w-5 shrink-0 text-right text-xs font-semibold text-white tabular-nums">{row.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border p-5" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <h3 className="text-sm font-semibold text-white">Findings by Directory</h3>
              {findingsByDirectory.length === 0 ? (
                <div className="flex h-[160px] items-center justify-center text-xs" style={{ color: "#6e7681" }}>No subdirectories.</div>
              ) : (
                <div className="mt-4 space-y-3">
                  {findingsByDirectory.map((row, i) => (
                    <div key={row.name} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 truncate text-xs font-medium text-white" title={row.name}>{row.name}</span>
                      <div className="h-2.5 flex-1 rounded-full" style={{ background: "#21262d" }}>
                        {row.count > 0 && <div className="h-2.5 rounded-full" style={{ width: `${(row.count / maxDirCount) * 100}%`, background: DIR_COLORS[i] ?? "#8b5cf6" }} />}
                      </div>
                      <span className="w-5 shrink-0 text-right text-xs font-semibold text-white tabular-nums">{row.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border p-5" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <h3 className="text-sm font-semibold text-white">Shelf Life Distribution</h3>
              <div className="mt-3" style={{ height: 180 }}>
                <Bar
                  data={{
                    labels: ["< 1 yr", "1–5 yrs", "5–10 yrs", "> 10 yrs"],
                    datasets: [{ data: [shelfLifeBuckets.under1, shelfLifeBuckets.oneToFive, shelfLifeBuckets.fiveToTen, shelfLifeBuckets.overTen], backgroundColor: ["#ef4444", "#f59e0b", "#eab308", "#3b82f6"], borderRadius: 4, barPercentage: 0.6 }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { enabled: true } },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: "#8b949e", font: { size: 10 } } },
                      y: { beginAtZero: true, grid: { color: "#21262d" }, ticks: { color: "#8b949e", font: { size: 10 }, stepSize: 5 } },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-5" style={{ borderColor: "#21262d", background: "#161b22" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Key Findings (top {keyFindings.length} by priority)</h3>
            </div>
            {keyFindings.length === 0 ? (
              <div className="flex h-16 items-center justify-center text-xs" style={{ color: "#6e7681" }}>No findings.</div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {["#", "Algorithm / Issue", "Location", "Quantum Status", "Reachability", "Shelf Life"].map((h) => (
                        <th key={h} className="border-b pb-2 pr-3 font-medium uppercase tracking-wide" style={{ borderColor: "#21262d", color: "#6e7681", fontSize: 10 }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {keyFindings.map((f, i) => {
                      const ev = f.evidence[0];
                      const reach = reachabilityLabel(f);
                      return (
                        <tr key={f.id} className="border-b" style={{ borderColor: "#21262d" }}>
                          <td className="py-2.5 pr-3" style={{ color: "#8b949e" }}>{i + 1}</td>
                          <td className="py-2.5 pr-3 font-semibold text-white">{issueLabel(f)}</td>
                          <td className="py-2.5 pr-3 font-mono" style={{ color: "#8b949e" }}>
                            {ev?.locator ?? "—"}
                            {ev?.line !== undefined ? `:${ev.line}` : ""}
                          </td>
                          <td className="py-2.5 pr-3">
                            <QuantumPill status={f.quantumStatus} pdfMode={false} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: reach.color }} />
                              <span style={{ color: "#c9d1d9" }}>{reach.text}</span>
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-white">{shelfLifeLabel(f.longestShelfLifeYears)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <LinkCard label={`Open interactive Findings view to see all ${sortedFindings.length} findings`} onClick={() => onNavigate?.("Findings")} />
          </div>
        </section>

        {/* Algorithm Analysis */}
        <SectionCard id="algorithm-analysis" title="Algorithm Analysis">
          {topAlgorithms.length === 0 ? (
            <p className="text-xs" style={{ color: "#6e7681" }}>No findings.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {topAlgorithms.map((row) => (
                <div key={row.name} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "#21262d" }}>
                  <span className="text-sm font-semibold text-white">{row.name}</span>
                  <span className="text-xs tabular-nums" style={{ color: "#8b949e" }}>{row.count} finding{row.count === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Migration Plan */}
        <SectionCard id="migration-plan" title="Migration Plan">
          <MigrationPlanSection scenario={defaultScenario} budgetDays={plan?.budgetDays} findings={findings} pdfMode={false} />
          <LinkCard label="Open interactive Migration view for timeline scrubber and budget controls" onClick={() => onNavigate?.("Migration")} />
        </SectionCard>

        {/* Blast Radius */}
        <SectionCard id="blast-radius" title="Blast Radius">
          <p className="mb-3 text-xs" style={{ color: "#8b949e" }}>
            Physical buffer and schema allocation overflow risk when switching to larger post-quantum primitives.
          </p>
          <BlastRadiusSection findings={findings} scannedFiles={scannedFiles} />
          <LinkCard label="Open interactive Blast Radius view for per-asset simulation" onClick={() => onNavigate?.("BlastRadius")} />
        </SectionCard>

        {/* Recommendations */}
        <SectionCard id="recommendations" title="Recommendations">
          {recommendations.length === 0 ? (
            <p className="text-xs" style={{ color: "#8b949e" }}>No findings to recommend replacements for.</p>
          ) : (
            <div className="space-y-3">
              {recommendations.map(({ algorithm, rec }) => (
                <div key={algorithm} className="rounded-lg border p-3" style={{ borderColor: "#21262d" }}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-white">{algorithm}</span>
                    <span style={{ color: "#8b949e" }}>→</span>
                    <span className="text-sm font-semibold" style={{ color: "#22c55e" }}>{rec.recommendedAlgorithm}</span>
                    <span className="text-[11px]" style={{ color: "#6e7681" }}>({rec.standard})</span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "#8b949e" }}>{rec.migrationNote}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* -----------------------------------------------------------------
          Hidden PDF export tree (Part B). Rendered off-screen (not
          display:none, so html2canvas can still lay it out and paint it),
          fixed wide desktop width for consistent PDF layout, and fed the
          SAME live `findings`/`plan` props as the screen above — no cached
          or separately-fetched copy, so "Export PDF" always reflects
          whatever is on screen at click time. The only difference from the
          screen: findings tables are uncapped (all, not top 10) and status
          pills render as plain colored text (no fill) for PDF-safe color
          fidelity.
      ----------------------------------------------------------------- */}
      {/* -----------------------------------------------------------------
          Discrete A4 multi-page PDF export tree.
          Positioned fixed at (0, 0) with z-index -9999 behind the main opaque
          view so html2canvas renders with normal coordinates without clipping
          or canvas memory exhaustion.
      ----------------------------------------------------------------- */}
      <div
        id="pdf-pages-container"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "800px",
          height: "1130px",
          overflow: "hidden",
          zIndex: -9999,
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        {/* PAGE 1: Executive Summary & Cryptographic Risk Posture */}
        <div
          className="pdf-page"
          style={{
            width: "800px",
            height: "1130px",
            background: "#0d1117",
            color: "#c9d1d9",
            padding: "28px 32px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <div>
            <PdfPageHeader sourceName={sourceName} timestamp={timestamp} />
            <div className="mt-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Security Assessment Report</div>
              <h1 className="text-xl font-bold text-white mt-0.5">Post-Quantum Cryptographic Readiness Assessment</h1>
              <div className="mt-1 flex items-center justify-between text-xs" style={{ color: "#8b949e" }}>
                <span>Target: <span className="font-mono text-white">{sourceName}</span></span>
                <span>Generated {formatTimestamp(timestamp)}</span>
              </div>
              {contentHash && (
                <div className="mt-1 font-mono text-[10px]" style={{ color: "#6e7681" }}>
                  CBOM SHA-256: {contentHash}
                </div>
              )}
            </div>

            {/* 4 Risk Tiles */}
            <div className="mt-3 grid grid-cols-4 gap-2.5">
              {[
                { value: statusCounts.shor, label: "Critical Findings", color: "#ef4444", sub: "Broken by Shor (Action now)" },
                { value: statusCounts.grover, label: "High / Medium", color: "#f59e0b", sub: "Weakened by Grover" },
                { value: statusCounts.classic, label: "Classically Broken", color: "#f0f6fc", sub: "Fix in regular cycle" },
                { value: statusCounts.safe, label: "Quantum-safe", color: "#22c55e", sub: "Compliant with NIST PQC" },
              ].map((t) => (
                <div key={t.label} className="rounded-lg border p-2.5" style={{ borderColor: "#21262d", background: "#161b22" }}>
                  <div className="text-xl font-bold tabular-nums" style={{ color: "#f0f6fc" }}>{t.value}</div>
                  <div className="text-xs font-semibold" style={{ color: t.color }}>{t.label}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "#8b949e" }}>{t.sub}</div>
                </div>
              ))}
            </div>

            {/* Executive Summary Box */}
            <div className="mt-3 rounded-lg border p-3.5" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <div className="text-xs font-bold uppercase tracking-wider text-white">Executive Summary</div>
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "#c9d1d9" }}>
                Hash Patch scanned <span className="font-semibold text-white">{filesScanned} files</span> in <span className="font-semibold text-white">{sourceName}</span> and identified <span className="font-semibold text-white">{operationFindings.length} cryptographic findings</span> across <span className="font-semibold text-white">{algorithmsDetected} algorithms</span>. <span style={{ color: "#ef4444", fontWeight: 600 }}>{statusCounts.shor} findings</span> are vulnerable to quantum attacks (broken by Shor&apos;s algorithm) and require prioritized post-quantum migration.
                {totalEffortDays > 0 && ` An estimated ${totalEffortDays}d of engineering effort is required for complete migration.`}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-2.5 text-center" style={{ borderColor: "#21262d" }}>
                <div>
                  <div className="text-sm font-bold text-white tabular-nums">{filesScanned}</div>
                  <div className="text-[10px]" style={{ color: "#8b949e" }}>Files Scanned</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white tabular-nums">{operationFindings.length}</div>
                  <div className="text-[10px]" style={{ color: "#ef4444" }}>{statusCounts.shor} critical (Shor)</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-white tabular-nums">{totalEffortDays}d</div>
                  <div className="text-[10px]" style={{ color: "#8b949e" }}>Estimated Migration Effort</div>
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
                <div className="mb-2 text-xs font-semibold text-white">Risk Distribution</div>
                <div style={{ height: 180 }}>
                  <Doughnut
                    data={{
                      labels: ["Broken by Shor", "Weakened by Grover", "Broken classically", "Quantum-safe"],
                      datasets: [{
                        data: [statusCounts.shor, statusCounts.grover, statusCounts.classic, statusCounts.safe],
                        backgroundColor: ["#ef4444", "#f59e0b", "#6b7280", "#22c55e"],
                        borderColor: "#0d1117",
                        borderWidth: 2,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: false,
                      plugins: {
                        legend: { position: "bottom", labels: { color: "#c9d1d9", font: { size: 10 }, boxWidth: 12 } },
                      },
                    }}
                  />
                </div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
                <div className="mb-2 text-xs font-semibold text-white">Shelf Life Distribution</div>
                <div style={{ height: 180 }}>
                  <Bar
                    data={{
                      labels: ["< 1 yr", "1–5 yrs", "5–10 yrs", "> 10 yrs"],
                      datasets: [{
                        data: [shelfLifeBuckets.under1, shelfLifeBuckets.oneToFive, shelfLifeBuckets.fiveToTen, shelfLifeBuckets.overTen],
                        backgroundColor: ["#ef4444", "#f59e0b", "#eab308", "#3b82f6"],
                        borderRadius: 4,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { ticks: { color: "#8b949e", font: { size: 10 } }, grid: { display: false } },
                        y: { ticks: { color: "#8b949e", font: { size: 10 } }, grid: { color: "#21262d" } },
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <PdfPageFooter pageNum={1} totalPages={pdfTotalPages} />
        </div>

        {/* PAGE 2: Top Prioritized Critical Findings (1–18) */}
        {sortedFindings.length > 0 && (
          <div
            className="pdf-page"
            style={{
              width: "800px",
              height: "1130px",
              background: "#0d1117",
              color: "#c9d1d9",
              padding: "28px 32px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <div>
              <PdfPageHeader sourceName={sourceName} timestamp={timestamp} />
              <div>
                <h2 className="text-base font-bold text-white">Prioritized Critical Cryptographic Findings</h2>
                <p className="text-xs" style={{ color: "#8b949e" }}>
                  Displaying priority 1–{Math.min(18, sortedFindings.length)} of {sortedFindings.length} findings, ranked by quantum vulnerability, reachability, and migration urgency.
                </p>
              </div>

              <table className="mt-3 w-full border-collapse text-left text-xs">
                <thead>
                  <tr>
                    {["#", "Algorithm / Primitive", "Location", "Quantum Status", "Reachability", "Shelf Life"].map((h) => (
                      <th key={h} className="border-b pb-2 pr-2 font-medium uppercase tracking-wide" style={{ borderColor: "#21262d", color: "#6e7681", fontSize: 10 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedFindings.slice(0, 18).map((f, i) => {
                    const ev = f.evidence[0];
                    const reach = reachabilityLabel(f);
                    return (
                      <tr key={f.id} className="border-b" style={{ borderColor: "#21262d" }}>
                        <td className="py-2 pr-2" style={{ color: "#8b949e" }}>{i + 1}</td>
                        <td className="py-2 pr-2 font-semibold text-white max-w-[170px] truncate">{issueLabel(f)}</td>
                        <td className="py-2 pr-2 font-mono text-[11px] max-w-[210px] truncate" style={{ color: "#8b949e" }}>
                          {ev?.locator ?? "—"}{ev?.line !== undefined ? `:${ev.line}` : ""}
                        </td>
                        <td className="py-2 pr-2">
                          <QuantumPill status={f.quantumStatus} pdfMode />
                        </td>
                        <td className="py-2 pr-2">
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: reach.color }} />
                            <span style={{ color: reach.color, fontSize: 11 }}>{reach.text}</span>
                          </span>
                        </td>
                        <td className="py-2 text-[11px]" style={{ color: "#f0f6fc" }}>{shelfLifeLabel(f.longestShelfLifeYears)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!pdfHasSecondFindingsPage && sortedFindings.length > 0 && (
                <div className="mt-3 rounded border p-2.5 text-xs text-center" style={{ borderColor: "#21262d", background: "#161b22", color: "#8b949e" }}>
                  All {sortedFindings.length} findings from this scan are displayed above.
                </div>
              )}
            </div>
            <PdfPageFooter pageNum={2} totalPages={pdfTotalPages} />
          </div>
        )}

        {/* PAGE 3: Prioritized Critical Findings Continued (19–36) */}
        {pdfHasSecondFindingsPage && (
          <div
            className="pdf-page"
            style={{
              width: "800px",
              height: "1130px",
              background: "#0d1117",
              color: "#c9d1d9",
              padding: "28px 32px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              position: "absolute",
              top: 0,
              left: 0,
            }}
          >
            <div>
              <PdfPageHeader sourceName={sourceName} timestamp={timestamp} />
              <div>
                <h2 className="text-base font-bold text-white">Prioritized Critical Cryptographic Findings (Continued)</h2>
                <p className="text-xs" style={{ color: "#8b949e" }}>
                  Displaying priority 19–{Math.min(36, sortedFindings.length)} of {sortedFindings.length} findings.
                </p>
              </div>

              <table className="mt-3 w-full border-collapse text-left text-xs">
                <thead>
                  <tr>
                    {["#", "Algorithm / Primitive", "Location", "Quantum Status", "Reachability", "Shelf Life"].map((h) => (
                      <th key={h} className="border-b pb-2 pr-2 font-medium uppercase tracking-wide" style={{ borderColor: "#21262d", color: "#6e7681", fontSize: 10 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedFindings.slice(18, 36).map((f, i) => {
                    const ev = f.evidence[0];
                    const reach = reachabilityLabel(f);
                    return (
                      <tr key={f.id} className="border-b" style={{ borderColor: "#21262d" }}>
                        <td className="py-2 pr-2" style={{ color: "#8b949e" }}>{i + 19}</td>
                        <td className="py-2 pr-2 font-semibold text-white max-w-[170px] truncate">{issueLabel(f)}</td>
                        <td className="py-2 pr-2 font-mono text-[11px] max-w-[210px] truncate" style={{ color: "#8b949e" }}>
                          {ev?.locator ?? "—"}{ev?.line !== undefined ? `:${ev.line}` : ""}
                        </td>
                        <td className="py-2 pr-2">
                          <QuantumPill status={f.quantumStatus} pdfMode />
                        </td>
                        <td className="py-2 pr-2">
                          <span className="flex items-center gap-1">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: reach.color }} />
                            <span style={{ color: reach.color, fontSize: 11 }}>{reach.text}</span>
                          </span>
                        </td>
                        <td className="py-2 text-[11px]" style={{ color: "#f0f6fc" }}>{shelfLifeLabel(f.longestShelfLifeYears)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {sortedFindings.length > 36 && (
                <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <FileText className="h-4 w-4 text-blue-400" />
                    Complete Cryptographic Bill of Materials (CBOM) Summary
                  </div>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "#8b949e" }}>
                    Displaying top 36 prioritized critical findings. A total of <span style={{ color: "#f0f6fc", fontWeight: 600 }}>{sortedFindings.length} findings</span> across <span style={{ color: "#f0f6fc", fontWeight: 600 }}>{algorithmsDetected} algorithms</span> were detected in this scan. To inspect every individual call site with full AST evidence, line numbers, and dependency shockwave graphs, please export the complete CBOM JSON (CycloneDX-compatible) or use the interactive Findings view in Hash Patch.
                  </p>
                </div>
              )}
            </div>
            <PdfPageFooter pageNum={3} totalPages={pdfTotalPages} />
          </div>
        )}

        {/* PAGE 4 (or 3): Algorithm Analysis & Migration Guidance */}
        <div
          className="pdf-page"
          style={{
            width: "800px",
            height: "1130px",
            background: "#0d1117",
            color: "#c9d1d9",
            padding: "28px 32px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <div>
            <PdfPageHeader sourceName={sourceName} timestamp={timestamp} />
            <div>
              <h2 className="text-base font-bold text-white">Algorithm Analysis & Inventory</h2>
              <p className="text-xs" style={{ color: "#8b949e" }}>Breakdown of detected cryptographic algorithms and implementation frequency across the codebase.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {topAlgorithms.map((row) => (
                  <div key={row.name} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: "#21262d", background: "#161b22" }}>
                    <span className="text-xs font-semibold text-white truncate max-w-[130px]">{row.name}</span>
                    <span className="text-xs font-mono font-semibold" style={{ color: "#3b82f6" }}>{row.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <h2 className="text-base font-bold text-white">NIST Post-Quantum Cryptography Migration Guidance</h2>
              <p className="text-xs" style={{ color: "#8b949e" }}>
                Recommended replacement algorithms standardized under NIST FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), and FIPS 205 (SLH-DSA).
              </p>
              <div className="mt-3 space-y-2.5">
                {recommendations.slice(0, 5).map(({ algorithm, rec }) => (
                  <div key={algorithm} className="rounded-lg border p-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{algorithm}</span>
                        <span style={{ color: "#8b949e" }}>→</span>
                        <span className="text-xs font-bold" style={{ color: "#22c55e" }}>{rec.recommendedAlgorithm}</span>
                      </div>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                        {rec.standard}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "#8b949e" }}>{rec.migrationNote}</p>
                  </div>
                ))}
                {recommendations.length === 0 && (
                  <p className="text-xs" style={{ color: "#6e7681" }}>No algorithm migrations required.</p>
                )}
              </div>
            </div>
          </div>
          <PdfPageFooter pageNum={pdfHasSecondFindingsPage ? 4 : sortedFindings.length > 0 ? 3 : 2} totalPages={pdfTotalPages} />
        </div>

        {/* PAGE 5 (or 4): Migration Roadmap & Blast Radius */}
        <div
          className="pdf-page"
          style={{
            width: "800px",
            height: "1130px",
            background: "#0d1117",
            color: "#c9d1d9",
            padding: "28px 32px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        >
          <div>
            <PdfPageHeader sourceName={sourceName} timestamp={timestamp} />
            <div>
              <h2 className="text-base font-bold text-white">Migration Plan & Phased Roadmap</h2>
              {defaultScenario ? (
                <div className="mt-2 space-y-2.5">
                  <p className="text-xs font-semibold text-white">
                    Scenario &ldquo;{defaultScenario.name}&rdquo;{defaultScenario.estimatedYear !== undefined ? ` (~${defaultScenario.estimatedYear})` : ""}:{" "}
                    {defaultScenario.schedule.length} asset{defaultScenario.schedule.length === 1 ? "" : "s"} scheduled over {plan?.budgetDays ?? Math.max(1, ...defaultScenario.schedule.map((s) => s.endDay))} days.
                  </p>
                  {defaultScenario.headline && <p className="text-xs" style={{ color: "#8b949e" }}>{defaultScenario.headline}</p>}
                  <div className="flex h-5 w-full overflow-hidden rounded border" style={{ borderColor: "#21262d", background: "#0d1117" }}>
                    {defaultScenario.schedule.map((item, i) => {
                      const totalD = plan?.budgetDays ?? Math.max(1, ...defaultScenario.schedule.map((s) => s.endDay));
                      const widthPct = totalD > 0 ? ((item.endDay - item.startDay) / totalD) * 100 : 0;
                      return (
                        <div
                          key={i}
                          style={{ width: `${widthPct}%`, background: SCHEDULE_BAR_COLORS[i % SCHEDULE_BAR_COLORS.length] }}
                          className="border-r last:border-r-0"
                        />
                      );
                    })}
                  </div>
                  <table className="mt-2 w-full border-collapse text-left text-xs">
                    <thead>
                      <tr>
                        {["#", "Asset", "Status", "Day Window", "Effort"].map((h, i) => (
                          <th key={h} className={`border-b pb-1.5 pr-2 font-medium uppercase tracking-wide ${i >= 3 ? "text-right" : "text-left"}`} style={{ borderColor: "#21262d", color: "#6e7681", fontSize: 10 }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {defaultScenario.schedule.slice(0, 6).map((item, i) => (
                        <tr key={i} className="border-b" style={{ borderColor: "#21262d" }}>
                          <td className="py-1.5 pr-2" style={{ color: "#8b949e" }}>{i + 1}</td>
                          <td className="py-1.5 pr-2 font-semibold text-white">{item.name}</td>
                          <td className="py-1.5 pr-2"><QuantumPill status={findings.find((f) => f.id === item.findingId || f.name === item.name)?.quantumStatus} pdfMode /></td>
                          <td className="py-1.5 pr-2 text-right font-mono text-[11px]" style={{ color: "#c9d1d9" }}>{item.startDay}–{item.endDay}d</td>
                          <td className="py-1.5 text-right font-semibold text-white">{item.costDays !== undefined ? `${item.costDays}d` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-xs" style={{ color: "#8b949e" }}>No migration scenario has been generated yet.</p>
              )}
            </div>

            <div className="mt-4">
              <h2 className="text-base font-bold text-white">Blast Radius & Memory Buffer Impact</h2>
              <p className="text-xs" style={{ color: "#8b949e" }}>
                Physical buffer, schema serialization, and network packet expansion risk when switching to post-quantum primitives.
              </p>
              {(() => {
                const qualifying = findings.filter((f) => f.blastRadius.length > 0);
                const allEntries = qualifying.flatMap((f) => f.blastRadius);
                const totalDeclared = allEntries.reduce((s, e) => s + (e.declaredBytes ?? 0), 0);
                const totalRequired = allEntries.reduce((s, e) => s + (e.pqcBytes ?? 0), 0);
                const totalOverflow = totalRequired - totalDeclared;
                const declaredPct = Math.min(100, (totalDeclared / Math.max(totalRequired, 1)) * 100);

                return (
                  <div className="mt-2 space-y-2.5">
                    {totalDeclared > 0 ? (
                      <div className="rounded-lg border p-3" style={{ background: "#161b22", borderColor: "#21262d" }}>
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span style={{ color: "#8b949e" }}>Declared Buffer: </span>
                            <span className="font-bold text-white">{totalDeclared.toLocaleString()} B</span>
                          </div>
                          <div>
                            <span style={{ color: "#8b949e" }}>PQC Required: </span>
                            <span className="font-bold" style={{ color: "#f59e0b" }}>{totalRequired.toLocaleString()} B</span>
                          </div>
                          <div>
                            <span style={{ color: "#8b949e" }}>Total Expansion: </span>
                            <span className="font-bold" style={{ color: "#ef4444" }}>+{totalOverflow.toLocaleString()} B</span>
                          </div>
                        </div>
                        <div className="relative mt-2 h-2.5 overflow-hidden rounded-full" style={{ background: "#21262d" }}>
                          <div className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: `${declaredPct}%`, background: "#3b82f6" }} />
                          {declaredPct < 100 && (
                            <div className="absolute inset-y-0 rounded-r-full" style={{ left: `${declaredPct}%`, right: 0, background: "#ef4444" }} />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "#21262d", background: "#161b22", color: "#8b949e" }}>
                        No buffer allocations or schema fields were detected overflowing in this scan.
                      </div>
                    )}
                    <div className="rounded-lg border p-3 text-xs leading-relaxed" style={{ borderColor: "#21262d", background: "#161b22", color: "#8b949e" }}>
                      <span className="font-semibold text-white">Migration Advisory: </span>
                      Post-quantum algorithms require significantly larger key and signature payloads (e.g. ML-KEM-768 public keys require 1,184 bytes vs RSA-2048&apos;s 256 bytes; ML-DSA-65 signatures require 3,293 bytes). Ensure network packet framing, database column lengths, and serialization schemas are updated to accommodate expanded payload sizes before deployment.
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          <PdfPageFooter pageNum={pdfTotalPages} totalPages={pdfTotalPages} />
        </div>
      </div>
    </div>
  );
}
