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
  Folder,
  Clock,
  MoreHorizontal,
  TriangleAlert,
  Layers,
  Shield,
  Search,
  Link2,
  ArrowLeftRight,
  FileText,
  ChevronRight,
  Bot,
  Info,
  History,
  Download,
  Clipboard,
  Trash2,
} from "lucide-react";
import { displayName, type Finding } from "./cbom/types";
import { FEATURE_GUIDED_UI } from "./tour/flags";
import { compareFindingsPriority } from "./priority";
import type { NavItem } from "./AppShell";
import { handleExportCBOM } from "./cbomExport";
import { ScanHistoryModal } from "./ScanHistoryModal";

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, Tooltip);

interface HomeViewProps {
  sourceName: string;
  timestamp: string | undefined;
  findings: Finding[];
  scannedFiles: string[] | undefined;
  onNavigate: (nav: NavItem) => void;
  onRescan: () => void;
  isRescanning: boolean;
  onClearScan: () => void;
  rawCbomText?: string;
  onLoadScan?: (target: string) => void;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "Unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown time";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

const ACTIONS: { nav: NavItem; icon: typeof Search; color: string; title: string; subtitle: string }[] = [
  { nav: "Findings", icon: Search, color: "#3b82f6", title: "Explore Findings", subtitle: "Browse and filter all detected issues" },
  { nav: "Relationships", icon: Link2, color: "#3b82f6", title: "View Relationships", subtitle: "See how findings are connected" },
  { nav: "Migration", icon: ArrowLeftRight, color: "#22c55e", title: "Plan Migration", subtitle: "Get a step-by-step migration plan" },
  { nav: "Report", icon: FileText, color: "#f59e0b", title: "Generate Report", subtitle: "Export detailed analysis" },
];

export function HomeView({
  sourceName,
  timestamp,
  findings,
  scannedFiles,
  onNavigate,
  onRescan,
  isRescanning,
  onClearScan,
  rawCbomText,
  onLoadScan,
}: HomeViewProps) {
  const operationFindings = useMemo(() => findings.filter((f) => f.findingType !== "CRYPTO_REFERENCE"), [findings]);

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
      onClearScan();
    }
  }

  const menuItems = [
    { label: "View scan history", icon: History, onClick: () => setHistoryOpen(true), danger: false },
    { label: "Export raw CBOM JSON", icon: Download, onClick: () => handleExportCBOM(rawCbomText), danger: false },
    { label: "Copy target path", icon: Clipboard, onClick: () => void navigator.clipboard.writeText(sourceName), danger: false },
    { label: "Delete scan / clear results", icon: Trash2, onClick: confirmAndClearScan, danger: true },
  ];

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

  const topAlgorithms = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of operationFindings) {
      const name = displayName(f);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((sum, [, n]) => sum + n, 0);
    const rows = top.map(([name, count]) => ({ name, count }));
    if (rest > 0) rows.push({ name: "Others", count: rest });
    return rows;
  }, [operationFindings]);

  const maxAlgoCount = Math.max(1, ...topAlgorithms.map((r) => r.count));
  const ALGO_COLORS = ["#ef4444", "#f59e0b", "#eab308", "#6b7280", "#6b7280", "#4b5563"];

  const shelfLifeBuckets = useMemo(() => {
    const buckets = { under1: 0, oneToFive: 0, fiveToTen: 0, overTen: 0 };
    for (const f of operationFindings) {
      const y = f.longestShelfLifeYears;
      if (y === undefined) continue;
      if (y < 1) buckets.under1++;
      else if (y <= 5) buckets.oneToFive++;
      else if (y <= 10) buckets.fiveToTen++;
      else buckets.overTen++;
    }
    return buckets;
  }, [operationFindings]);

  const hasShelfLifeData =
    shelfLifeBuckets.under1 > 0 || shelfLifeBuckets.oneToFive > 0 || shelfLifeBuckets.fiveToTen > 0 || shelfLifeBuckets.overTen > 0;

  const topFindings = useMemo(
    () => [...operationFindings].sort(compareFindingsPriority).slice(0, 5),
    [operationFindings],
  );

  const filesScanned = scannedFiles?.length ?? new Set(operationFindings.flatMap((f) => f.evidence.map((e) => e.locator).filter(Boolean))).size;
  const algorithmsDetected = new Set(operationFindings.map((f) => displayName(f))).size;
  const requireMigration = operationFindings.filter(
    (f) => f.quantumStatus === "broken-by-shor" || f.quantumStatus === "weakened-by-grover",
  ).length;

  // Hero banner capability strip. Mirrors two selectors that already exist
  // elsewhere in the app rather than inventing new business logic:
  //  - "live-reachable" excludes mixedReachability findings from the
  //    live-external/live-internal buckets, same carve-out FindingsTable.tsx
  //    already applies (a Mixed finding belongs only to its own bucket, or
  //    counting it here too would double-count it against that view).
  //  - "constraints found" is the exact qualifying-findings filter
  //    BlastRadiusView.tsx already uses for its own empty-state check.
  const liveReachableCount = useMemo(
    () =>
      findings.filter(
        (f) =>
          f.findingType !== "CRYPTO_REFERENCE" &&
          f.findingType !== "CERTIFICATE" &&
          f.findingType !== "CERTIFICATE_UNPARSEABLE" &&
          !f.mixedReachability &&
          (f.reachability === "live-external" || f.reachability === "live-internal"),
      ).length,
    [findings],
  );
  const blastRadiusConstraints = useMemo(() => findings.filter((f) => f.blastRadius.length > 0).length, [findings]);

  const capabilityNodes: { key: string; label: string; value: number | undefined; color: string }[] = [
    { key: "discover", label: "Discover", value: filesScanned, color: "#6b7280" },
    { key: "classify", label: "Classify", value: algorithmsDetected, color: "#6b7280" },
    { key: "reach", label: "Reach", value: liveReachableCount, color: "#f59e0b" },
    { key: "blast", label: "Blast Radius", value: blastRadiusConstraints, color: "#ef4444" },
    { key: "migrate", label: "Migrate", value: requireMigration, color: "#22c55e" },
  ];

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#0d1117" }}>
      {/* Scan header bar */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ background: "#161b22", borderColor: "#21262d" }}>
        <div>
          <div className="flex items-center gap-2.5">
            <Folder className="h-6 w-6 shrink-0" style={{ color: "#3b82f6" }} strokeWidth={2} aria-hidden="true" />
            <span className="text-lg font-bold text-white">{sourceName}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: "rgba(63,185,80,0.15)", color: "#3fb950" }}
            >
              Scanned
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>
            Scanned on {formatTimestamp(timestamp)} · {filesScanned} files · Local scan
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRescan}
            disabled={isRescanning}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: "#30363d" }}
          >
            <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {isRescanning ? "Re-scanning…" : "Re-scan"}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              title="More options"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors hover:bg-white/5"
              style={{ borderColor: "#30363d", color: "#8b949e" }}
            >
              <MoreHorizontal className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
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
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        {/* Hero banner */}
        <div
          className="relative flex min-h-[140px] items-center justify-between overflow-hidden rounded-xl px-8 py-6"
          style={{ background: "#0a0d12" }}
        >
          <div className="relative z-10 max-w-[280px]">
            <h2 className="text-2xl font-bold text-white">Scan complete!</h2>
            <p className="mt-1 text-sm font-medium" style={{ color: "#3b82f6" }}>
              Here&apos;s what we found in your codebase.
            </p>
          </div>

          {!FEATURE_GUIDED_UI ? (
            <>
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 800 140" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="terrain1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="terrain2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.5" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M280,140 L380,40 L450,100 L520,20 L600,90 L680,55 L760,140 Z" fill="url(#terrain1)" />
                <path d="M340,140 L420,80 L500,130 L560,60 L650,120 L720,80 L800,140 Z" fill="url(#terrain2)" />
              </svg>

              <div className="relative z-10 max-w-[220px] text-right">
                <p className="text-sm italic leading-snug" style={{ color: "#c9d1d9" }}>
                  &ldquo;Small steps today.
                  <br />
                  A quantum-safe tomorrow.&rdquo;
                </p>
                <div className="ml-auto mt-2 h-0.5 w-16" style={{ background: "#22c55e" }} />
              </div>
            </>
          ) : (
            <>
              <div className="relative z-10 hidden shrink-0 items-center md:flex" style={{ minWidth: 340 }}>
                {capabilityNodes.map((node, i) => (
                  <div key={node.key} className="flex items-center">
                    {i > 0 && (
                      <div
                        className="h-px w-8 animate-capability-line lg:w-12"
                        style={{ background: "#30363d", animationDelay: `${i * 60}ms` }}
                      />
                    )}
                    <div
                      className="flex flex-col items-center gap-1.5 px-1.5 animate-row-in"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <span
                        className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "#8b949e" }}
                      >
                        {node.label}
                      </span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: node.color }} aria-hidden="true" />
                      <span className="text-lg font-bold tabular-nums text-white">{node.value ?? "—"}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="relative z-10 max-w-[220px] shrink-0 text-right">
                <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "#8b949e" }}>
                  Smart India Hackathon 2026 · Problem Statement 26164 · NTRO
                </p>
                <p className="mt-1 text-[13px] font-medium" style={{ color: "#c9d1d9" }}>
                  Enterprise Cryptographic Discovery &amp; Analysis Tool
                </p>
              </div>
            </>
          )}
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { icon: TriangleAlert, color: "#ef4444", value: operationFindings.length, label: "Total Findings", nav: "Findings" as NavItem },
            { icon: Layers, color: "#3b82f6", value: filesScanned, label: "Files Scanned", nav: "Repository" as NavItem },
            { icon: Folder, color: "#f59e0b", value: algorithmsDetected, label: "Algorithms Detected", nav: "Findings" as NavItem },
            { icon: Shield, color: "#3b82f6", value: requireMigration, label: "Require Migration", nav: "Migration" as NavItem },
          ].map(({ icon: Icon, color, value, label, nav }) => (
            <button
              key={label}
              type="button"
              onClick={() => onNavigate(nav)}
              className="flex items-center justify-between rounded-xl border p-4 text-left transition-colors hover:bg-white/5"
              style={{ background: "#161b22", borderColor: "#21262d" }}
            >
              <div>
                <Icon className="h-5 w-5 shrink-0" style={{ color }} strokeWidth={2} aria-hidden="true" />
                <div className="mt-2 text-2xl font-bold text-white tabular-nums">{value}</div>
                <div className="text-xs" style={{ color: "#8b949e" }}>
                  {label}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "#484f58" }} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
            <h3 className="text-sm font-semibold text-white">Findings by Quantum Status</h3>
            {donutTotal === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-xs" style={{ color: "#6e7681" }}>
                No findings to chart.
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-4">
                <div className="relative h-[160px] w-[160px] shrink-0">
                  <Doughnut
                    data={{
                      labels: ["Broken by Shor", "Weakened by Grover", "Broken classically", "Quantum-safe"],
                      datasets: [
                        {
                          data: [statusCounts.shor, statusCounts.grover, statusCounts.classic, statusCounts.safe],
                          backgroundColor: ["#ef4444", "#f59e0b", "#6b7280", "#22c55e"],
                          borderColor: "#161b22",
                          borderWidth: 2,
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      cutout: "68%",
                      plugins: { legend: { display: false }, tooltip: { enabled: true } },
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-white tabular-nums">{donutTotal}</span>
                    <span className="text-[10px]" style={{ color: "#8b949e" }}>
                      Findings
                    </span>
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
                      <span className="min-w-0 flex-1 truncate" style={{ color: "#c9d1d9" }}>
                        {s.label}
                      </span>
                      <span className="shrink-0 font-medium text-white tabular-nums">
                        {s.value} ({donutTotal > 0 ? Math.round((s.value / donutTotal) * 100) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
            <h3 className="text-sm font-semibold text-white">Top Algorithms</h3>
            {topAlgorithms.length === 0 ? (
              <div className="flex h-[220px] items-center justify-center text-xs" style={{ color: "#6e7681" }}>
                No findings to chart.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {topAlgorithms.map((row, i) => (
                  <div key={row.name} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs font-medium text-white" title={row.name}>
                      {row.name}
                    </span>
                    <div className="h-2.5 flex-1 rounded-full" style={{ background: "#21262d" }}>
                      <div
                        className="h-2.5 rounded-full"
                        style={{ width: `${(row.count / maxAlgoCount) * 100}%`, background: ALGO_COLORS[i] ?? "#4b5563" }}
                      />
                    </div>
                    <span className="w-5 shrink-0 text-right text-xs font-semibold text-white tabular-nums">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
            <h3 className="text-sm font-semibold text-white">Shelf Life Distribution</h3>
            {!hasShelfLifeData ? (
              <div className="flex h-[200px] flex-col items-center justify-center gap-3 p-4 text-center">
                <div className="text-3xl">📊</div>
                <p className="text-sm font-medium" style={{ color: "#f0f6fc" }}>
                  Shelf life unavailable
                </p>
                <p className="max-w-[200px] text-xs" style={{ color: "#8b949e" }}>
                  Shelf life requires named variables or scopes with sensitivity context. Try scanning a
                  codebase with data-handling code.
                </p>
              </div>
            ) : (
              <div className="mt-3" style={{ height: 200 }}>
                <Bar
                  data={{
                    labels: ["< 1 yr", "1–5 yrs", "5–10 yrs", "> 10 yrs"],
                    datasets: [
                      {
                        data: [shelfLifeBuckets.under1, shelfLifeBuckets.oneToFive, shelfLifeBuckets.fiveToTen, shelfLifeBuckets.overTen],
                        backgroundColor: ["#ef4444", "#f59e0b", "#eab308", "#3b82f6"],
                        borderRadius: 4,
                        barPercentage: 0.6,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { enabled: true } },
                    scales: {
                      x: {
                        grid: { display: false },
                        ticks: { color: "#8b949e", font: { size: 10 } },
                      },
                      y: {
                        beginAtZero: true,
                        grid: { color: "#21262d" },
                        ticks: { color: "#8b949e", font: { size: 10 }, stepSize: 5 },
                      },
                    },
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Recent findings + what to do next */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border p-5 lg:col-span-2" style={{ background: "#161b22", borderColor: "#21262d" }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Recent High-Priority Findings</h3>
              <button type="button" onClick={() => onNavigate("Findings")} className="text-xs font-medium" style={{ color: "#3b82f6" }}>
                View all findings →
              </button>
            </div>

            {topFindings.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-xs" style={{ color: "#6e7681" }}>
                No findings.
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {["Algorithm", "File", "Line", "Quantum Status", "Reachability", "Shelf Life"].map((h) => (
                        <th
                          key={h}
                          className="border-b pb-2 pr-3 font-medium uppercase tracking-wide"
                          style={{ borderColor: "#21262d", color: "#6e7681", fontSize: 10 }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topFindings.map((f) => {
                      const ev = f.evidence[0];
                      const pill = f.quantumStatus ? QUANTUM_PILL[f.quantumStatus] : undefined;
                      const reach = reachabilityLabel(f);
                      return (
                        <tr key={f.id} className="border-b" style={{ borderColor: "#21262d" }}>
                          <td className="py-2.5 pr-3 font-semibold text-white">{displayName(f)}</td>
                          <td className="py-2.5 pr-3">
                            <button
                              type="button"
                              onClick={() => onNavigate("Repository")}
                              className="truncate font-mono hover:underline"
                              style={{ color: "#3b82f6" }}
                              title={ev?.locator}
                            >
                              {ev?.locator ?? "—"}
                            </button>
                          </td>
                          <td className="py-2.5 pr-3" style={{ color: "#8b949e" }}>
                            {ev?.line ?? "—"}
                          </td>
                          <td className="py-2.5 pr-3">
                            {pill ? (
                              <span
                                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                                style={{ background: pill.bg }}
                              >
                                {pill.label}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: reach.color }} />
                              <span style={{ color: "#c9d1d9" }}>{reach.text}</span>
                            </span>
                          </td>
                          <td className="py-2.5 text-white">{shelfLifeLabel(f.longestShelfLifeYears)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white">What would you like to do next?</h3>
            {ACTIONS.map(({ nav, icon: Icon, color, title, subtitle }) => (
              <button
                key={nav}
                type="button"
                onClick={() => onNavigate(nav)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-white/5"
                style={{ background: "#1a2332", borderColor: "#21262d" }}
              >
                <Icon className="h-5 w-5 shrink-0" style={{ color }} strokeWidth={2} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white">{title}</div>
                  <div className="truncate text-xs" style={{ color: "#8b949e" }}>
                    {subtitle}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "#484f58" }} strokeWidth={2} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        {/* Ask Patch AI banner */}
        <div
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl px-6 py-5"
          style={{ background: "linear-gradient(135deg, #2e1065 0%, #1e293b 100%)" }}
        >
          <div className="flex items-center gap-4">
            <Bot className="h-14 w-14 shrink-0" style={{ color: "#a78bfa" }} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">Ask Patch AI</h3>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: "rgba(63,185,80,0.15)", color: "#3fb950" }}
                >
                  Beta
                </span>
              </div>
              <p className="mt-0.5 text-xs" style={{ color: "#9ca3af" }}>
                Get instant answers about your findings, migration options, and post-quantum security.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "#9ca3af" }}>
              <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              For best performance: 8 GB RAM recommended
            </div>
            <button
              type="button"
              onClick={() => onNavigate("Ask")}
              className="shrink-0 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "#3b82f6" }}
            >
              Start a conversation →
            </button>
          </div>
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
