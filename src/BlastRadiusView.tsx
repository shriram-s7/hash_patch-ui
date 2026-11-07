import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, type BlastRadiusEntry, type DataChainType, type Finding } from "./cbom/types";
import { useAnimatedWidth } from "./useAnimatedWidth";
import { ResizableDivider } from "./components/ResizableDivider";
import { getNodeColor } from "./graphColors";
import { FEATURE_GUIDED_UI } from "./tour/flags";
import { Coachmark } from "./tour/Coachmark";
import { tourStore } from "./tour/store";
import { useTourStep } from "./tour/useTourStep";
import { useReducedMotion } from "./tour/useReducedMotion";
import { DUR_RISE, EASE_OUT } from "./tour/motionTokens";

const BLAST_INTRO_TOUR_ID = "blast.intro";
const STEP_SIMULATE_ALL = "blast.intro.simulate-all";
const STEP_SIMULATE_BUFFER = "blast.intro.simulate-buffer";
const STEP_SHOCKWAVE = "blast.intro.shockwave";
const BLAST_INTRO_STEPS = [STEP_SIMULATE_ALL, STEP_SIMULATE_BUFFER, STEP_SHOCKWAVE];

const ASSET_WIDTH_KEY = "blast-asset-width";
const ASSET_WIDTH_DEFAULT = 260;
const ASSET_WIDTH_MIN = 160;
const ASSET_WIDTH_MAX = 400;

// ---------------------------------------------------------------------------
// Shared computation, ported unchanged from the old BlastRadiusMode /
// ShockwaveView modal — only the presentation changed.
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  return n.toLocaleString();
}

function bufferName(entry: BlastRadiusEntry): string {
  const parts = entry.key.split(".");
  return parts.length >= 2 ? parts.slice(0, -1).join(".") : entry.key;
}

/** Same phrasing the old modal used: "<name> buffer here declared <N>
 * bytes, <replacement> needs <M>" — built entirely from real, already-computed
 * BlastRadiusEntry fields (hash_patch/analyze/blast_radius.py), never invented. */
function blastRadiusReason(entry: BlastRadiusEntry): string {
  const parts = entry.key.split(".");
  const name = parts.length >= 2 ? parts[parts.length - 2] : entry.key;
  const replacement = entry.pqcReplacement ?? "its PQC replacement";
  if (entry.declaredBytes !== undefined && entry.pqcBytes !== undefined) {
    return `${name} buffer here declared ${entry.declaredBytes.toLocaleString()} bytes, ${replacement} needs ${entry.pqcBytes.toLocaleString()}`;
  }
  return `${name} — size data incomplete for this entry`;
}

function locatorLabel(finding: Finding): string {
  const ev = finding.evidence[0];
  if (ev === undefined || ev.locator === undefined) return "(unknown location)";
  return ev.line !== undefined ? `${ev.locator}:${ev.line}` : ev.locator;
}

const SEVERITY_COLOR: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#22c55e" };

// --- Shockwave ring math, ported unchanged from ShockwaveView.tsx ---

const RING_GAP_PX = 90;
const CENTER_RADIUS_PX = 14;
const NODE_RADIUS_PX = 9;
const MAX_RINGS = 12;

type EdgeKind = "call" | "ciphertext" | "key_material";

interface RingEntry {
  finding: Finding;
  viaId: string;
  edgeKind: EdgeKind;
}

function buildRings(findings: Finding[], centerId: string): RingEntry[][] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const center = byId.get(centerId);
  if (center === undefined) return [];

  const visited = new Set<string>([centerId]);
  const rings: RingEntry[][] = [];
  let frontier: Finding[] = [center];

  while (frontier.length > 0 && rings.length < MAX_RINGS) {
    const next: RingEntry[] = [];
    for (const f of frontier) {
      for (const callerId of f.callRelation?.callers ?? []) {
        if (visited.has(callerId)) continue;
        const callerFinding = byId.get(callerId);
        if (callerFinding === undefined) continue;
        visited.add(callerId);
        next.push({ finding: callerFinding, viaId: f.id, edgeKind: "call" });
      }
      for (const targetId of f.dataChain?.chainTargets ?? []) {
        if (visited.has(targetId)) continue;
        const targetFinding = byId.get(targetId);
        if (targetFinding === undefined) continue;
        visited.add(targetId);

        let chainType: DataChainType | undefined = f.dataChain?.edges?.find(
          (e) => e.source === f.id && e.target === targetId,
        )?.chainType;
        if (!chainType) {
          chainType = targetFinding.dataChain?.edges?.find(
            (e) => e.source === f.id && e.target === targetId,
          )?.chainType;
        }
        if (!chainType) chainType = f.dataChain?.chainType;
        if (!chainType) {
          const isKeyGen =
            f.detectorId?.toLowerCase().includes("keygen") ||
            f.name.toLowerCase().includes("keygen") ||
            f.name.toLowerCase().includes("keygenerator");
          chainType = isKeyGen ? "key_material" : "ciphertext";
        }

        const edgeKind: EdgeKind = chainType === "key_material" ? "key_material" : "ciphertext";
        next.push({ finding: targetFinding, viaId: f.id, edgeKind });
      }
    }
    if (next.length === 0) break;
    rings.push(next);
    frontier = next.map((n) => n.finding);
  }
  return rings;
}

interface PositionedNode extends RingEntry {
  x: number;
  y: number;
  ring: number;
}

function layoutRings(
  rings: RingEntry[][],
  centerId: string,
): { positioned: PositionedNode[]; posById: Map<string, { x: number; y: number }> } {
  const posById = new Map<string, { x: number; y: number }>([[centerId, { x: 0, y: 0 }]]);
  const positioned: PositionedNode[] = [];
  rings.forEach((ring, ringIdx) => {
    const radius = (ringIdx + 1) * RING_GAP_PX;
    const n = ring.length;
    ring.forEach((entry, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      posById.set(entry.finding.id, { x, y });
      positioned.push({ ...entry, x, y, ring: ringIdx + 1 });
    });
  });
  return { positioned, posById };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function BufferCard({
  entry,
  simulating,
  onSimulate,
  buttonRef,
}: {
  entry: BlastRadiusEntry;
  simulating: boolean;
  onSimulate: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const declared = entry.declaredBytes ?? 0;
  const pqc = entry.pqcBytes ?? 0;
  // Per-buffer scale (the larger of the two as 100%) so the required-size
  // bar is never zero-width relative to its own declared size — a shared
  // dataset-wide max (the old approach) could make a small buffer's bars
  // invisible next to a much larger one elsewhere in the scan.
  const maxBytes = Math.max(declared, pqc, 1);
  const declaredPct = (declared / maxBytes) * 100;
  const pqcTargetPct = simulating ? (pqc / maxBytes) * 100 : 0;
  const animatedPct = useAnimatedWidth(pqcTargetPct, 700);

  const overflows = pqc > declared;
  const normalPct = Math.min(animatedPct, declaredPct);
  const overflowPct = Math.max(0, animatedPct - declaredPct);
  const settled = animatedPct >= pqcTargetPct - 0.5;
  const overflowBytesExact = entry.overflowBytes ?? Math.max(0, pqc - declared);
  const severityColor = SEVERITY_COLOR[entry.severity ?? ""] ?? "#8b949e";

  return (
    <div className="mb-3 rounded-xl border p-4" style={{ background: "#161b22", borderColor: "#21262d" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs" style={{ color: "#c9d1d9" }}>{bufferName(entry)}</div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
          {entry.severity !== undefined && (
            <span className="rounded-full px-2 py-0.5 text-white" style={{ background: severityColor }}>
              {entry.severity} severity
            </span>
          )}
          {entry.pqcReplacement !== undefined && (
            <span style={{ color: "#8b949e" }}>→ {entry.pqcReplacement}</span>
          )}
        </div>
      </div>

      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide" style={{ color: "#8b949e" }}>
        <span>Declared buffer allocation</span>
        <span className="font-semibold text-white tabular-nums normal-case">{formatBytes(declared)} bytes</span>
      </div>
      <div className="mb-3 h-5 rounded-md" style={{ background: "#0d1117" }}>
        <div className="h-full rounded-md" style={{ width: `${declaredPct}%`, background: "#3b82f6" }} />
      </div>

      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide" style={{ color: "#8b949e" }}>
        <span>{entry.pqcReplacement ?? "PQC replacement"} required size</span>
        {simulating && <span className="font-semibold text-white tabular-nums normal-case">{formatBytes(pqc)} bytes</span>}
      </div>
      <div className="relative mb-2 h-5 overflow-hidden rounded-md" style={{ background: "#0d1117" }}>
        <div className="absolute top-0 h-full w-px" style={{ left: `${declaredPct}%`, background: "#30363d" }} aria-hidden="true" />
        <div className="absolute inset-y-0 left-0 rounded-l-md" style={{ width: `${normalPct}%`, background: "#6b7280" }} />
        {overflowPct > 0 && (
          <div className="absolute inset-y-0 rounded-r-md" style={{ left: `${normalPct}%`, width: `${overflowPct}%`, background: "#ef4444" }} />
        )}
      </div>

      {simulating && settled && (
        <p className="text-sm font-bold" style={{ color: overflows ? "#ef4444" : "#22c55e" }}>
          {overflows ? `+${formatBytes(overflowBytesExact)} bytes over declared size` : "Fits within the declared buffer — no overflow"}
        </p>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={onSimulate}
        disabled={simulating}
        className="mt-3 w-full rounded-lg border py-2 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-white/5 disabled:cursor-default disabled:opacity-40"
        style={{ borderColor: "#30363d" }}
      >
        Simulate migration
      </button>
    </div>
  );
}

/** Sum of this asset's buffer entries, above the individual per-buffer
 * cards — "how much total overflow does migrating THIS algorithm cause
 * across every buffer it was found in." Only rendered when there is
 * at least one entry with a real declared size to sum. */
export function BufferImpactSummary({ selected, replacement }: { selected: Finding; replacement: string }) {
  const totalDeclared = selected.blastRadius.reduce((sum, b) => sum + (b.declaredBytes ?? 0), 0);
  const totalRequired = selected.blastRadius.reduce((sum, b) => sum + (b.pqcBytes ?? 0), 0);
  const totalOverflow = totalRequired - totalDeclared;

  const reducedMotion = useReducedMotion();
  const [entered, setEntered] = useState(() => !FEATURE_GUIDED_UI || reducedMotion);
  const panelRef = useRef<HTMLDivElement>(null);
  const seenFindings = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!FEATURE_GUIDED_UI || reducedMotion) {
      setEntered(true);
      return;
    }
    if (seenFindings.current.has(selected.id)) {
      setEntered(true);
      return;
    }

    setEntered(false);
    const el = panelRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setEntered(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          seenFindings.current.add(selected.id);
          setEntered(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [selected.id, reducedMotion]);

  if (totalDeclared <= 0) return null;

  const declaredPct = Math.min(100, (totalDeclared / Math.max(totalRequired, 1)) * 100);

  return (
    <div ref={panelRef} className="mb-4 rounded-xl border p-4" style={{ background: "#0d1117", borderColor: "#21262d" }}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "#8b949e" }}>
        Total Buffer Impact — {displayName(selected)} → {replacement}
      </h3>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <div>
          <p className="text-xs" style={{ color: "#8b949e" }}>Declared total</p>
          <p className="text-sm font-bold" style={{ color: "#f0f6fc" }}>{formatBytes(totalDeclared)} bytes</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "#8b949e" }}>PQC required</p>
          <p className="text-sm font-bold" style={{ color: "#f59e0b" }}>{formatBytes(totalRequired)} bytes</p>
        </div>
        <div>
          <p className="text-xs" style={{ color: "#8b949e" }}>Total overflow</p>
          <p className="text-sm font-bold" style={{ color: "#ef4444" }}>
            {totalOverflow > 0 ? `+${formatBytes(totalOverflow)}` : formatBytes(totalOverflow)} bytes
          </p>
        </div>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full" style={{ background: "#21262d" }}>
        <div className="absolute inset-y-0 left-0 rounded-l-full" style={{ width: `${declaredPct}%`, background: "#3b82f6" }} />
        {declaredPct < 100 && (
          <div
            className="absolute inset-y-0 rounded-r-full"
            style={{
              left: `${declaredPct}%`,
              right: 0,
              background: "#ef4444",
              ...(FEATURE_GUIDED_UI
                ? {
                    transformOrigin: "left center",
                    transform: entered ? "scaleX(1)" : "scaleX(0)",
                    transition: entered && !reducedMotion ? `transform ${DUR_RISE}ms ${EASE_OUT}` : "none",
                  }
                : {}),
            }}
          />
        )}
      </div>
      {totalOverflow > 0 && (
        <p className="mt-2 text-xs font-bold" style={{ color: "#ef4444" }}>
          +{formatBytes(totalOverflow)} bytes over total declared capacity
        </p>
      )}
    </div>
  );
}

/** Exported for reuse in ReportView's static "Blast Radius" report section —
 * this component has never had any interactive/"simulate" state, so it's
 * already exactly the "static shockwave diagram" the report needs, with no
 * duplicated ring-layout math. */
export function ShockwaveDiagram({ findings, center }: { findings: Finding[]; center: Finding }) {
  const rings = useMemo(() => buildRings(findings, center.id), [findings, center.id]);
  const { positioned, posById } = useMemo(() => layoutRings(rings, center.id), [rings, center.id]);
  const maxRadius = (rings.length > 0 ? rings.length : 1) * RING_GAP_PX + 30;
  const findingById = new Map(findings.map((f) => [f.id, f]));

  return (
    <div id={`shockwave-${center.id}`} className="mt-4 rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
      <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
        Blast-radius shockwave
      </div>
      <h3 className="mt-0.5 text-lg font-bold text-white">{displayName(center)}</h3>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed" style={{ color: "#8b949e" }}>
        The changed algorithm sits at the center. Each ring is one more hop out — findings whose enclosing
        function calls into this one, or that consume this cipher&rsquo;s output or key material, reusing the
        same relationship data as the Asset Relationships graph.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[400px_1fr]">
        {/* Ring diagram */}
        <div className="relative flex h-[400px] shrink-0 items-center justify-center rounded-xl" style={{ background: "#0d1117" }}>
          <svg viewBox={`${-maxRadius} ${-maxRadius} ${2 * maxRadius} ${2 * maxRadius}`} className="h-full w-full">
            {rings.map((_, i) => (
              <circle key={i} cx={0} cy={0} r={(i + 1) * RING_GAP_PX} fill="none" stroke="#30363d" strokeWidth={1} strokeDasharray="3 4" />
            ))}
            {positioned.map((n) => {
              const from = posById.get(n.viaId) ?? { x: 0, y: 0 };
              const isCiphertext = n.edgeKind === "ciphertext";
              const isKeyMaterial = n.edgeKind === "key_material";
              return (
                <line
                  key={`edge-${n.finding.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={n.x}
                  y2={n.y}
                  stroke={isCiphertext ? "#f59e0b" : isKeyMaterial ? "#6e7681" : "#8b949e"}
                  strokeWidth={isKeyMaterial ? 1.5 : 2}
                  strokeDasharray={isCiphertext ? "4 3" : isKeyMaterial ? "2 3" : undefined}
                />
              );
            })}
            {/* Epicenter and ring nodes are colored by their OWN quantum-risk
                status (same NODE_COLORS map the Relationships graph uses) —
                the red ring around the epicenter is a separate "this is the
                changed node" marker, not a color-semantics collision. */}
            <circle cx={0} cy={0} r={CENTER_RADIUS_PX} fill={getNodeColor(center.quantumStatus)} stroke="#ef4444" strokeWidth={2} />
            {positioned.map((n) => (
              <circle
                key={n.finding.id}
                cx={n.x}
                cy={n.y}
                r={NODE_RADIUS_PX - n.ring}
                fill={getNodeColor(n.finding.quantumStatus)}
                stroke="#161b22"
                strokeWidth={1.5}
              />
            ))}
          </svg>

          <div className="pointer-events-none absolute bottom-2 left-2 space-y-1 rounded-lg border px-2 py-1.5 text-[10px]" style={{ borderColor: "#21262d", background: "rgba(13,17,23,0.9)" }}>
            <div className="flex items-center gap-1.5">
              <span className="h-0 w-3 border-t-2" style={{ borderColor: "#8b949e" }} aria-hidden="true" />
              <span className="uppercase tracking-wide" style={{ color: "#8b949e" }}>Call dependent</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: "#f59e0b" }} aria-hidden="true" />
              <span className="uppercase tracking-wide" style={{ color: "#8b949e" }}>Ciphertext chain</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-0 w-3 border-t-[1.5px] border-dotted" style={{ borderColor: "#6e7681" }} aria-hidden="true" />
              <span className="uppercase tracking-wide" style={{ color: "#8b949e" }}>Key-material binding</span>
            </div>
          </div>
        </div>

        {/* Callout panels */}
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg p-3" style={{ background: "#1a0808", borderLeft: "3px solid #ef4444" }}>
            <h4 className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
              Epicenter — {locatorLabel(center)}
            </h4>
            <ul className="mt-1.5 space-y-1 font-mono text-xs text-white">
              {center.blastRadius.map((b, i) => (
                <li key={i}>{blastRadiusReason(b)}</li>
              ))}
            </ul>
          </div>

          {rings.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4" style={{ borderColor: "#30363d" }}>
              <p className="text-xs font-semibold uppercase tracking-wide text-white">
                No call-graph or data-chain dependents found
              </p>
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "#8b949e" }}>
                This finding has no direct or transitive callers or data-flow consumers among the other
                findings in this scan, so the shockwave is just this one node — an honest result, not a bug.
              </p>
            </div>
          ) : (
            rings.map((ring, ringIdx) => (
              <div key={ringIdx} className="rounded-lg p-3" style={{ background: "#161b22", borderLeft: "3px solid #3b82f6" }}>
                <h4 className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
                  Ring {ringIdx + 1} — {ringIdx === 0 ? "direct dependents" : `${ringIdx + 1} hops out`} ({ring.length})
                </h4>
                <div className="mt-2 space-y-2">
                  {ring.map((n) => {
                    const via = n.viaId === center.id ? center : findingById.get(n.viaId);
                    return (
                      <div key={n.finding.id} className="rounded-lg p-2.5" style={{ background: "#0d1117" }}>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: n.edgeKind === "ciphertext" ? "#f59e0b" : n.edgeKind === "key_material" ? "#8b949e" : "#3b82f6" }}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-bold text-white">{displayName(n.finding)}</span>
                        </div>
                        <div className="mt-1 break-all text-[11px]" style={{ color: "#8b949e" }}>{locatorLabel(n.finding)}</div>
                        <div className="mt-1 text-[11px] leading-relaxed" style={{ color: "#8b949e" }}>
                          {n.edgeKind === "ciphertext" ? (
                            <>{displayName(n.finding)} consumes ciphertext output directly from {via ? displayName(via) : "the epicenter"}{via !== center ? `, which chains back to ${displayName(center)}` : ""}.</>
                          ) : n.edgeKind === "key_material" ? (
                            <>{displayName(n.finding)} binds key material generated by {via ? displayName(via) : "the epicenter"}{via !== center ? `, which chains back to ${displayName(center)}` : ""}.</>
                          ) : (
                            <>{displayName(n.finding)}&rsquo;s enclosing function directly calls {via ? displayName(via) : "the previous ring's"}&rsquo;s enclosing function{via !== center ? `, which chains back to ${displayName(center)}` : ""}.</>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function BlastRadiusView({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const [assetWidth, setAssetWidth] = useState(() => {
    const saved = localStorage.getItem(ASSET_WIDTH_KEY);
    return saved ? parseInt(saved) : ASSET_WIDTH_DEFAULT;
  });

  const handleAssetResize = (delta: number) => {
    if (delta === 0) {
      setAssetWidth(ASSET_WIDTH_DEFAULT);
      localStorage.removeItem(ASSET_WIDTH_KEY);
      return;
    }
    setAssetWidth((w) => {
      const next = Math.min(ASSET_WIDTH_MAX, Math.max(ASSET_WIDTH_MIN, w + delta));
      localStorage.setItem(ASSET_WIDTH_KEY, String(next));
      return next;
    });
  };

  // Tour refs & step hooks for blast.intro
  const simulateAllRef = useRef<HTMLButtonElement>(null);
  const firstSimulateButtonRef = useRef<HTMLButtonElement>(null);
  const shockwaveButtonRef = useRef<HTMLButtonElement>(null);

  const showSimulateAllStep = useTourStep(STEP_SIMULATE_ALL);
  const showSimulateBufferStep = useTourStep(STEP_SIMULATE_BUFFER);
  const showShockwaveStep = useTourStep(STEP_SHOCKWAVE);

  const qualifying = useMemo(() => findings.filter((f) => f.blastRadius.length > 0), [findings]);

  // Auto-arm blast.intro tour once on first entry when constraints exist
  useEffect(() => {
    if (!FEATURE_GUIDED_UI) return;
    if (qualifying.length === 0) return;
    if (tourStore.hasSeen(BLAST_INTRO_TOUR_ID)) return;
    if (tourStore.getSnapshot().activeTour) return;
    tourStore.startTour(BLAST_INTRO_TOUR_ID, BLAST_INTRO_STEPS);
  }, [qualifying.length]);

  const selected = qualifying.find((f) => f.id === selectedId) ?? qualifying[0];
  const topSeverity = selected?.blastRadius[0]?.severity;
  const topReplacement = selected?.blastRadius[0]?.pqcReplacement;

  // Per-buffer "simulate migration" reveal state, keyed by finding+entry so
  // switching assets never leaks another asset's simulated state. "Simulate
  // All" just adds every one of the selected asset's buffer keys at once —
  // the same reveal each card's own button triggers individually.
  const [simulatedKeys, setSimulatedKeys] = useState<Set<string>>(new Set());
  const bufferKey = (findingId: string, entryKey: string) => `${findingId}::${entryKey}`;
  const simulateAll = () => {
    if (!selected) return;
    setSimulatedKeys((prev) => {
      const next = new Set(prev);
      for (const entry of selected.blastRadius) next.add(bufferKey(selected.id, entry.key));
      return next;
    });
  };

  // Jumping to the shockwave section from the asset list: if that asset
  // isn't selected yet, select it first and scroll once it (and its
  // shockwave section) has actually mounted.
  const [pendingScrollId, setPendingScrollId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (pendingScrollId === undefined || selected?.id !== pendingScrollId) return;
    const el = document.getElementById(`shockwave-${pendingScrollId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("shockwave-highlight");
      setTimeout(() => el.classList.remove("shockwave-highlight"), 2000);
    }
    setPendingScrollId(undefined);
  }, [pendingScrollId, selected]);

  const scrollToShockwave = (assetId: string) => {
    if (selected?.id === assetId) {
      const el = document.getElementById(`shockwave-${assetId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("shockwave-highlight");
        setTimeout(() => el.classList.remove("shockwave-highlight"), 2000);
      }
      return;
    }
    onSelect(assetId);
    setPendingScrollId(assetId);
  };

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#0d1117" }}>
      <div className="px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Blast Radius Analysis</h1>
            <p className="mt-1 max-w-2xl text-sm" style={{ color: "#8b949e" }}>
              Fixed-size buffers and database columns that will overflow when migrating classical algorithms to
              post-quantum replacements.
            </p>
          </div>
          {qualifying.length > 0 && (
            <button
              ref={FEATURE_GUIDED_UI ? simulateAllRef : undefined}
              type="button"
              onClick={simulateAll}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ background: "#3b82f6", boxShadow: "0 10px 15px -3px rgba(59,130,246,0.2)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2563eb")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#3b82f6")}
            >
              ⚡ Simulate All Migrations
            </button>
          )}
        </div>

        {qualifying.length === 0 ? (
          <div className="flex h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-3xl" style={{ background: "#0d2b1a", border: "1px solid rgba(34,197,94,0.2)" }}>
              🛡
            </div>
            <div>
              <h3 className="mb-2 text-base font-bold" style={{ color: "#f0f6fc" }}>No buffer constraints detected</h3>
              <p className="max-w-sm text-sm" style={{ color: "#8b949e" }}>
                Blast radius analysis looks for fixed-size memory buffers and database columns sized for classical
                algorithm outputs. None were found — buffers may be dynamically sized or no migration-relevant
                patterns exist.
              </p>
              <p className="mt-3 max-w-sm text-xs" style={{ color: "#6b7280" }}>
                Note: API schemas, network packet formats, and external system interfaces may still require manual
                updates when migrating.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex gap-0 overflow-hidden rounded-xl border" style={{ borderColor: "#21262d" }}>
            {/* Left panel: asset list */}
            <div className="shrink-0" style={{ width: assetWidth, background: "#161b22" }}>
              <div className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
                Constraints Found
              </div>
              <div>
                {qualifying.map((f, idx) => {
                  const isSelected = f.id === selected?.id;
                  const dotColor = SEVERITY_COLOR[f.blastRadius[0]?.severity ?? ""] ?? "#8b949e";
                  return (
                    <div
                      key={f.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelect(f.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") onSelect(f.id);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 border-b px-4 py-3 text-left transition-colors"
                      style={{
                        borderColor: "#21262d",
                        background: isSelected ? "#1d2d44" : "transparent",
                        borderLeft: isSelected ? "3px solid #3b82f6" : "3px solid transparent",
                      }}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{displayName(f)}</span>
                      <button
                        ref={idx === 0 && FEATURE_GUIDED_UI ? shockwaveButtonRef : undefined}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          scrollToShockwave(f.id);
                        }}
                        className="flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors"
                        style={{ background: "#1d2d44", borderColor: "rgba(59,130,246,0.4)", color: "#3b82f6" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.2)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "#1d2d44")}
                      >
                        ↓ Shockwave
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <ResizableDivider onResize={handleAssetResize} />

            {/* Right panel: detail */}
            <div className="min-w-0 flex-1 p-6">
              {selected && (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4" style={{ borderColor: "#21262d" }}>
                    <div>
                      <h2 className="text-xl font-bold text-white">{displayName(selected)}</h2>
                      <p className="mt-0.5 font-mono text-xs" style={{ color: "#8b949e" }}>{locatorLabel(selected)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {topSeverity && (
                        <span className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white" style={{ background: SEVERITY_COLOR[topSeverity] ?? "#8b949e" }}>
                          {topSeverity} severity
                        </span>
                      )}
                      {topReplacement && (
                        <span className="text-sm font-medium" style={{ color: "#8b949e" }}>→ {topReplacement}</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    <BufferImpactSummary selected={selected} replacement={topReplacement ?? "PQC replacement"} />
                    {selected.blastRadius.map((entry, i) => {
                      const key = bufferKey(selected.id, entry.key);
                      return (
                        <BufferCard
                          key={`${selected.id}-${i}`}
                          entry={entry}
                          simulating={simulatedKeys.has(key)}
                          onSimulate={() => setSimulatedKeys((prev) => new Set(prev).add(key))}
                          buttonRef={i === 0 && FEATURE_GUIDED_UI ? firstSimulateButtonRef : undefined}
                        />
                      );
                    })}
                  </div>

                  <ShockwaveDiagram findings={findings} center={selected} />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {FEATURE_GUIDED_UI && showSimulateAllStep && (
        <Coachmark
          id={STEP_SIMULATE_ALL}
          anchorRef={simulateAllRef}
          placement="bottom"
          title="Simulate everything at once"
          body="Applies every PQC replacement and shows which buffers and columns overflow, across the whole scan."
          step={[1, 3]}
          nextLabel="Next →"
          skipLabel="Skip tour"
          onNext={() => tourStore.nextStep()}
          onSkip={() => {
            tourStore.markSeen(BLAST_INTRO_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}

      {FEATURE_GUIDED_UI && showSimulateBufferStep && (
        <Coachmark
          id={STEP_SIMULATE_BUFFER}
          anchorRef={firstSimulateButtonRef}
          placement="top"
          title="Or one buffer at a time"
          body="Watch a single allocation grow from its declared size to what the replacement actually needs."
          step={[2, 3]}
          nextLabel="Next →"
          skipLabel="Skip tour"
          onNext={() => tourStore.nextStep()}
          onSkip={() => {
            tourStore.markSeen(BLAST_INTRO_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}

      {FEATURE_GUIDED_UI && showShockwaveStep && (
        <Coachmark
          id={STEP_SHOCKWAVE}
          anchorRef={shockwaveButtonRef}
          placement="right"
          title="Shockwave"
          body="Jumps down to the concentric dependency diagram, mapping every caller, ciphertext consumer, and key-material dependent impacted outward from this algorithm."
          step={[3, 3]}
          nextLabel="Done"
          skipLabel=""
          onNext={() => {
            tourStore.markSeen(BLAST_INTRO_TOUR_ID);
            tourStore.endTour();
          }}
          onSkip={() => {
            tourStore.markSeen(BLAST_INTRO_TOUR_ID);
            tourStore.endTour();
          }}
        />
      )}
    </div>
  );
}
