import { useRef, useState, type ReactNode } from "react";
import logoIcon from "./assets/icon.png";
import {
  Home,
  FileText,
  Search,
  Link2,
  Radar,
  ArrowLeftRight,
  ClipboardList,
  Sparkles,
  Settings,
  HelpCircle,
  MessageCircle,
} from "lucide-react";
// ThemeToggle (./ThemeToggle.tsx, ./theme.ts) toggles the `.dark` class and
// still works for the handful of components that read theme CSS variables
// (DetailPanel sections, the Quantum/Reachability/Exposure badges,
// ClusterGraph/TreeGraph). But every other view in the app (Home, Entry,
// Repository, Report, Migration, Blast Radius, Ask) now renders with fixed
// hex colors regardless of that class, so an actual "light mode" isn't a
// real, complete experience yet -- flipping it just breaks a few pieces
// while leaving the rest dark. Shown as a non-interactive "Dark" indicator
// until a real light theme covers the whole app; the toggle component and
// theme.ts logic are left intact for when that happens.

export type NavItem =
  | "Home"
  | "Repository"
  | "Findings"
  | "Relationships"
  | "BlastRadius"
  | "Migration"
  | "Report"
  | "Ask"
  | "Settings"
  | "Feedback";

// Same GitHub URL every other "Docs" / "Learn more" link in the app already
// points to (ReportView, AskView, EntryScreen) -- kept in one place so the
// top-bar Docs button and the sidebar's Help & Docs item can never drift
// apart.
const DOCS_URL = "https://github.com/shriram-s7/hash_patch";

const NAV_ITEMS: { id: NavItem; label: string; icon: typeof Home }[] = [
  { id: "Home", label: "Home", icon: Home },
  { id: "Repository", label: "Repository", icon: FileText },
  { id: "Findings", label: "Findings", icon: Search },
  { id: "Relationships", label: "Relationships", icon: Link2 },
  { id: "BlastRadius", label: "Blast Radius", icon: Radar },
  { id: "Migration", label: "Migration", icon: ArrowLeftRight },
  { id: "Report", label: "Reports", icon: ClipboardList },
  { id: "Ask", label: "Ask Patch AI", icon: Sparkles },
];

/** Global application shell: a fixed dark navigation rail plus a top bar
 * whose contents change once a scan exists (search bar + gear icon appear,
 * the sidebar's Target/Change block appears). The rail's colors are fixed
 * (not theme-tokenized) -- it is meant to read as permanent app chrome,
 * like a dark OS dock, regardless of whether the content area is in light
 * or dark mode. */

function LogoImage({ size = 32 }: { size?: number }) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (loadFailed) {
    return (
      <div
        className="flex items-center justify-center rounded font-bold text-white shadow-sm shrink-0"
        style={{
          width: size,
          height: size,
          minWidth: size,
          background: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
          fontSize: size >= 24 ? Math.round(size * 0.55) : Math.round(size * 0.65),
          lineHeight: 1,
        }}
      >
        #
      </div>
    );
  }

  return (
    <img
      src={logoIcon}
      alt="Hash Patch"
      className="rounded shrink-0"
      onError={() => setLoadFailed(true)}
      style={{
        width: size,
        height: size,
        minWidth: size,
        objectFit: "contain",
      }}
    />
  );
}

export function AppShell({
  activeNav,
  onNavChange,
  sourceName,
  onNewScan,
  hasScan,
  findingsCount,
  immersive,
  children,
}: {
  activeNav: NavItem;
  onNavChange: (id: NavItem) => void;
  sourceName: string;
  onNewScan: () => void;
  hasScan: boolean;
  findingsCount: number;
  /** Hides the left nav rail (e.g. the full file view wants every pixel of
   * horizontal space) without unmounting anything else in the shell -- the
   * top bar and content area are untouched, and the sidebar's own width/
   * collapsed state is just re-read from localStorage on remount. */
  immersive?: boolean;
  children: ReactNode;
}) {
  // Layout is flexbox (aside + a `flex-1` sibling), not margin/padding-offset
  // -- so shrinking the aside's own width already reflows the content
  // sibling to fill the freed space; there is no separate marginLeft to keep
  // in sync with it (a `main` marginLeft hack would double-offset content
  // that flexbox is already reflowing correctly on its own).
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");

  // Continuous drag-resize width -- the "collapsed" boolean above stays as
  // the quick snap-to-icon-only toggle (and what the button's own glyph/
  // title reflect), while `sidebarWidth` is the actual rendered width and
  // drives label visibility via `isIconOnly` so dragging down to icon-only
  // width hides labels exactly like clicking the snap toggle would.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("sidebar-width");
    const parsed = saved !== null ? parseInt(saved, 10) : NaN;
    if (Number.isFinite(parsed)) return parsed;
    return collapsed ? 52 : 230;
  });
  const isIconOnly = sidebarWidth <= 80;
  const dragging = useRef(false);

  return (
    <div className="flex h-screen overflow-hidden bg-page text-ink animate-mode-in">
      {!immersive && (
      <aside
        className="relative flex shrink-0 flex-col border-r transition-all ease-in-out"
        style={{
          width: sidebarWidth,
          background: "#0d1117",
          borderColor: "#21262d",
          transitionDuration: dragging.current ? "0ms" : "200ms",
        }}
      >
        <button
          type="button"
          onClick={() => {
            setCollapsed((c) => {
              const next = !c;
              localStorage.setItem("sidebar-collapsed", String(next));
              return next;
            });
            setSidebarWidth((w) => {
              const next = w <= 80 ? 230 : 52;
              localStorage.setItem("sidebar-width", String(next));
              return next;
            });
          }}
          className="absolute top-4 -right-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[#21262d] bg-[#161b22] transition-colors hover:bg-[#21262d]"
          title={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isIconOnly ? "›" : "‹"}
        </button>

        {/* Branding block -- sits above the nav list, not inside it. */}
        <div className="flex flex-col gap-2 px-4 pb-4 pt-5">
          <div className={`flex items-center gap-2.5 ${isIconOnly ? "justify-center" : ""}`}>
            {/* Fixed 32x32 always -- never resized by the flex row or the
                sidebar's own width transition, so it can never look squashed
                mid-collapse/drag. */}
            <LogoImage size={32} />
            <div
              className="overflow-hidden transition-all duration-200"
              style={{ width: isIconOnly ? 0 : "auto", opacity: isIconOnly ? 0 : 1 }}
            >
              <span className="whitespace-nowrap font-heading text-[15px] font-bold text-white">hash patch</span>
              <span className="block truncate text-[11px] leading-snug" style={{ color: "#8b949e" }}>
                Crypto risk today. Safer tomorrow.
              </span>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-4 py-2">
          {NAV_ITEMS.map((item) => {
            const isActive = activeNav === item.id;
            const needsScan = item.id !== "Home";
            const isLocked = needsScan && !hasScan;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (!isLocked) onNavChange(item.id);
                }}
                aria-current={isActive ? "page" : undefined}
                title={isLocked ? "Run a scan first to access this section" : item.label}
                disabled={isLocked}
                className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                  isIconOnly ? "justify-center" : ""
                } ${isLocked ? "cursor-not-allowed" : ""}`}
                style={
                  isActive
                    ? { background: "#1d2d44", color: "#ffffff" }
                    : isLocked
                    ? { background: "transparent", color: "#484f58", opacity: 0.45 }
                    : { background: "transparent", color: "#8b949e" }
                }
                onMouseEnter={(e) => {
                  if (!isActive && !isLocked) e.currentTarget.style.background = "#161b22";
                }}
                onMouseLeave={(e) => {
                  if (!isActive && !isLocked) e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon
                  className="h-5 w-5 shrink-0"
                  strokeWidth={2}
                  aria-hidden="true"
                  style={{ color: isActive ? "#58a6ff" : "inherit" }}
                />
                {!isIconOnly && <span className="flex-1 truncate text-left">{item.label}</span>}

                {!isIconOnly && isLocked && (
                  <span className="shrink-0 rounded border border-[#30363d] px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide" style={{ color: "#484f58" }}>
                    Locked
                  </span>
                )}

                {!isIconOnly && item.id === "Findings" && hasScan && findingsCount > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">
                    {findingsCount}
                  </span>
                )}

                {!isIconOnly && item.id === "Migration" && hasScan && (
                  <span className="shrink-0 rounded-full bg-emerald-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                    Beta
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-3 px-4 pb-4">
          {!isIconOnly && hasScan && (
            <div className="space-y-1.5 border-t pt-3" style={{ borderColor: "#21262d" }}>
              <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "#8b949e" }}>
                Target
              </div>
              <div className="truncate text-xs text-white" title={sourceName}>
                {sourceName}
              </div>
              <button
                type="button"
                onClick={onNewScan}
                className="rounded-md border px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-white/5"
                style={{ borderColor: "#30363d" }}
              >
                Change
              </button>
            </div>
          )}

          <div className="space-y-1 border-t pt-3" style={{ borderColor: "#21262d" }}>
            {BOTTOM_ITEMS.map(({ label, icon: Icon, nav }) => {
              const isActive = nav !== undefined && activeNav === nav;
              return (
                <button
                  key={label}
                  type="button"
                  title={label}
                  onClick={() => {
                    if (nav) onNavChange(nav);
                    else window.open(DOCS_URL, "_blank");
                  }}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${isIconOnly ? "justify-center" : ""}`}
                  style={isActive ? { background: "#1d2d44", color: "#ffffff" } : { color: "#8b949e" }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "#161b22";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Icon
                    className="h-[18px] w-[18px] shrink-0"
                    strokeWidth={2}
                    aria-hidden="true"
                    style={{ color: isActive ? "#58a6ff" : "inherit" }}
                  />
                  {!isIconOnly && <span>{label}</span>}
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: "#21262d" }}>
            <div className={`flex items-center gap-1.5 ${isIconOnly ? "justify-center" : ""}`}>
              <LogoImage size={16} />
              {!isIconOnly && <span className="text-xs font-bold text-white">Hash Patch v0.1.0</span>}
            </div>
            {!isIconOnly && (
              <p className="mt-1 text-[11px] leading-snug" style={{ color: "#8b949e" }}>
                Built for a post-quantum world.
              </p>
            )}
          </div>
        </div>

        {/* Drag-to-resize handle -- offset below the collapse-toggle button
            (top-10) so its hit area never steals clicks from that button;
            covers the rest of the right edge for the full-height drag grip. */}
        <div
          className="group absolute bottom-0 right-0 top-10 z-40 w-1 cursor-col-resize"
          onMouseDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            const startX = e.clientX;
            const startWidth = sidebarWidth;

            const onMove = (moveEvent: MouseEvent) => {
              const delta = moveEvent.clientX - startX;
              const next = Math.min(280, Math.max(52, startWidth + delta));
              setSidebarWidth(next);
              localStorage.setItem("sidebar-width", String(next));
            };

            const onUp = () => {
              dragging.current = false;
              // Force one more render now that dragging.current is false, so
              // the aside's transition-duration reverts to the smooth 200ms
              // snap instead of staying at the instant-follow 0ms used
              // while actively dragging.
              setSidebarWidth((w) => w);
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };

            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        >
          {/* Visual indicator -- only shows on hover */}
          <div className="absolute inset-y-0 right-0 w-0.5 bg-transparent transition-colors duration-150 group-hover:bg-[#3b82f6]" />
        </div>
      </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header
          className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6"
          style={{ background: "#0d1117", borderColor: "#21262d" }}
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: hasScan ? "#8b949e" : "#484f58" }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <input
              type="text"
              readOnly
              disabled={!hasScan}
              placeholder={hasScan ? "Search findings, files, algorithms, or ask Patch AI..." : "Run a scan first to enable search"}
              title={hasScan ? undefined : "Run a scan first to enable search"}
              className="w-full rounded-md border py-2 pl-9 pr-16 text-sm placeholder:text-[13px] cursor-not-allowed"
              style={{
                background: hasScan ? "#161b22" : "#0d1117",
                borderColor: hasScan ? "#30363d" : "#21262d",
                color: hasScan ? "#ffffff" : "#484f58",
                opacity: hasScan ? 1 : 0.5,
              }}
            />
            {hasScan && (
              <span
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium"
                style={{ borderColor: "#30363d", color: "#8b949e" }}
              >
                Ctrl K
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5" style={{ background: "#161b22", borderColor: "#21262d" }}>
              <span className="text-sm">🌙</span>
              <span className="text-xs" style={{ color: "#8b949e" }}>
                Dark
              </span>
            </div>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/5"
              style={{ borderColor: "#30363d" }}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span>Docs</span>
            </a>
            {hasScan && (
              <button
                type="button"
                onClick={() => onNavChange("Settings")}
                title="Settings"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/5"
              >
                <Settings className="h-4 w-4 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white">
              SS
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden bg-page">{children}</main>
      </div>
    </div>
  );
}

// `nav` present -> in-app view (routed through the shared onNavChange);
// `nav` absent -> external link (opened directly, same as the top-bar Docs button).
const BOTTOM_ITEMS: { label: string; icon: typeof Settings; nav?: NavItem }[] = [
  { label: "Settings", icon: Settings, nav: "Settings" },
  { label: "Help & Docs", icon: HelpCircle },
  { label: "Feedback", icon: MessageCircle, nav: "Feedback" },
];
