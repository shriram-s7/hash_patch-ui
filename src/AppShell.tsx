import { useState, type ReactNode } from "react";
import {
  FolderTree,
  ListChecks,
  Share2,
  ArrowLeftRight,
  ShieldCheck,
  MessageSquare,
  ArrowLeft,
  PanelsTopLeft,
  ChevronDown,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export type NavItem = "Repository" | "Findings" | "Relationships" | "Migration" | "Report" | "Ask";

const NAV_ITEMS: { id: NavItem; label: string; icon: typeof FolderTree }[] = [
  { id: "Repository", label: "Repository", icon: FolderTree },
  { id: "Findings", label: "Findings", icon: ListChecks },
  { id: "Relationships", label: "Relationships", icon: Share2 },
  { id: "Migration", label: "Migration", icon: ArrowLeftRight },
  { id: "Report", label: "Report", icon: ShieldCheck },
  { id: "Ask", label: "Ask", icon: MessageSquare },
];

export interface ShellSummary {
  totalAssets: number;
  referenceAssets: number;
  brokenByShor: number;
  contradictions: number;
  longestShelfLife: number | undefined;
  longestShelfLifeFindingName: string | undefined;
  onLongestShelfLifeClick: () => void;
}

/** Global application shell: navigation rail + top bar. Replaces the old
 * always-visible metrics strip with an on-demand summary panel (a button
 * that opens it, closed by default) -- the scan totals are useful
 * reference information, not something that needs to occupy screen real
 * estate on every view where they aren't the point (Findings, Relationships,
 * Migration already show their own, more specific counts inline). */
export function AppShell({
  activeNav,
  onNavChange,
  sourceName,
  onNewScan,
  summary,
  children,
}: {
  activeNav: NavItem;
  onNavChange: (id: NavItem) => void;
  sourceName: string;
  onNewScan: () => void;
  summary: ShellSummary;
  children: ReactNode;
}) {
  const [summaryOpen, setSummaryOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-page text-ink animate-mode-in">
      <aside className="flex flex-col border-r border-line bg-surface w-14 xl:w-52 shrink-0 transition-all">
        <div className="flex h-11 items-center border-b border-line px-3.5 xl:px-4">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <img src="./favicon.ico" alt="Hash Patch" className="h-4 w-4 shrink-0 rounded-xs object-contain" />
            <span className="font-heading text-sm font-bold tracking-[0.14em] text-ink">hash patch</span>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 py-2">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavChange(item.id)}
                title={item.label}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-full items-center gap-3 px-3.5 xl:px-4 py-2 font-heading text-xs uppercase tracking-wider transition-colors ${
                  isActive
                    ? "border-l-2 border-ink bg-surface-2 font-semibold text-ink"
                    : "border-l-2 border-transparent font-medium text-ink-secondary hover:bg-surface-2/60 hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                <span className="hidden xl:inline truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-line p-2 xl:p-3 space-y-2">
          <div className="hidden xl:block space-y-0.5">
            <div className="font-heading text-[11px] uppercase tracking-wider text-ink-muted">Target</div>
            <div className="truncate font-mono text-xs text-ink-secondary" title={sourceName}>
              {sourceName}
            </div>
          </div>
          <button
            type="button"
            onClick={onNewScan}
            title="Return to entry screen"
            className="flex w-full items-center justify-center xl:justify-start gap-1.5 rounded-sm border border-line bg-page px-2 py-1 font-heading text-xs font-medium uppercase tracking-wider text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="hidden xl:inline">New scan</span>
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative flex h-11 shrink-0 items-center justify-between border-b border-line px-4 sm:px-6 bg-surface">
          <h1 className="font-heading text-xs font-semibold uppercase tracking-widest text-ink-muted">
            {activeNav}
          </h1>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSummaryOpen((v) => !v)}
              aria-expanded={summaryOpen}
              aria-label="Scan summary"
              title="Scan summary"
              className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 font-heading text-[11px] font-medium uppercase tracking-wide transition-colors ${
                summaryOpen
                  ? "border-line-strong bg-surface-2 text-ink"
                  : "border-line text-ink-secondary hover:border-line-strong hover:text-ink"
              }`}
            >
              <PanelsTopLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="hidden sm:inline">Summary</span>
              <ChevronDown
                className={`h-3 w-3 shrink-0 transition-transform ${summaryOpen ? "rotate-180" : ""}`}
                strokeWidth={2}
                aria-hidden="true"
              />
            </button>
            <ThemeToggle />
          </div>

          {summaryOpen && (
            <div className="absolute right-4 sm:right-6 top-full z-40 mt-1.5 w-[min(92vw,420px)] rounded-sm border border-line-strong bg-surface p-3 shadow-xl">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 font-heading text-[11px]">
                <div>
                  <dt className="uppercase tracking-wider text-ink-muted">Total findings</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold text-ink tabular-nums">
                    {summary.totalAssets}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wider text-ink-muted">References</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold text-ink tabular-nums">
                    {summary.referenceAssets}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wider text-ink-muted">Broken by Shor</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold text-status-critical-text tabular-nums">
                    {summary.brokenByShor}
                  </dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wider text-ink-muted">Contradictions</dt>
                  <dd
                    className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                      summary.contradictions > 0 ? "text-status-critical-text" : "text-ink"
                    }`}
                  >
                    {summary.contradictions}
                  </dd>
                </div>
                <div className="col-span-2 border-t border-line pt-2">
                  <dt className="uppercase tracking-wider text-ink-muted">Longest shelf-life</dt>
                  <dd>
                    <button
                      type="button"
                      onClick={summary.onLongestShelfLifeClick}
                      disabled={summary.longestShelfLife === undefined}
                      className="mt-0.5 font-mono text-sm font-semibold text-ink tabular-nums underline decoration-dotted underline-offset-2 disabled:no-underline disabled:cursor-default"
                    >
                      {summary.longestShelfLife !== undefined ? `${summary.longestShelfLife}y` : "—"}
                      {summary.longestShelfLifeFindingName !== undefined && (
                        <span className="ml-1.5 font-sans text-[11px] font-normal normal-case text-ink-muted">
                          ({summary.longestShelfLifeFindingName})
                        </span>
                      )}
                    </button>
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-hidden bg-page">{children}</main>
      </div>
    </div>
  );
}
