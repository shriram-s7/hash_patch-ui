import { useMemo, useState } from "react";
import type { BlastRadiusEntry, Finding } from "./cbom/types";
import { useAnimatedWidth } from "./useAnimatedWidth";

const SEVERITY_DOT_CLASS: Record<string, string> = {
  high: "bg-status-critical",
  medium: "bg-status-warning",
  low: "bg-status-good",
};

const TRACK_MAX_PX = 480;
const TRACK_MIN_PX = 6;

/** Log-scale so a 32-byte value and a 4,000+ byte value are both legible
 * on the same track — linear would make the smaller one invisible. */
function byteWidthPx(bytes: number, maxBytes: number): number {
  if (bytes <= 0) return TRACK_MIN_PX;
  const logMax = Math.log(maxBytes + 1);
  const logVal = Math.log(bytes + 1);
  return Math.max(TRACK_MIN_PX, (logVal / logMax) * TRACK_MAX_PX);
}

function formatBytes(n: number): string {
  return n.toLocaleString();
}

function EntryView({ entry, maxBytes }: { entry: BlastRadiusEntry; maxBytes: number }) {
  const [simulating, setSimulating] = useState(false);

  const declared = entry.declaredBytes ?? 0;
  const pqc = entry.pqcBytes ?? 0;
  const declaredWidthPx = byteWidthPx(declared, maxBytes);
  const pqcTargetWidthPx = simulating ? byteWidthPx(pqc, maxBytes) : 0;
  const animatedWidthPx = useAnimatedWidth(pqcTargetWidthPx, 700);

  const overflows = pqc > declared;
  const normalPart = Math.min(animatedWidthPx, declaredWidthPx);
  const overflowPart = Math.max(0, animatedWidthPx - declaredWidthPx);
  const settled = animatedWidthPx >= pqcTargetWidthPx - 0.5;
  const overflowBytesExact = entry.overflowBytes ?? Math.max(0, pqc - declared);

  return (
    <div className="rounded-sm border border-line bg-surface p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs text-ink-secondary">{entry.key}</div>
        <div className="flex items-center gap-2 text-xs">
          {entry.severity !== undefined && (
            <span
              className={`rounded-sm px-2 py-0.5 font-medium uppercase tracking-wide ${
                entry.severity === "high"
                  ? "bg-status-critical text-white"
                  : entry.severity === "medium"
                    ? "bg-status-warning text-status-warning-fg"
                    : "bg-status-neutral-bg text-status-neutral-fg"
              }`}
            >
              {entry.severity} severity
            </span>
          )}
          {entry.pqcReplacement !== undefined && (
            <span className="font-mono text-ink-secondary">→ {entry.pqcReplacement}</span>
          )}
        </div>
      </div>

      {/* Declared (current classical allocation) bar */}
      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-muted">
        <span>Declared buffer</span>
        <span className="font-mono normal-case tracking-normal text-ink">{formatBytes(declared)} bytes</span>
      </div>
      <div className="mb-4 h-6 rounded-sm bg-page">
        <div className="h-full rounded-sm bg-ink-muted/50" style={{ width: `${declaredWidthPx}px` }} />
      </div>

      {/* PQC replacement bar — grows on "Simulate migration" */}
      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-muted">
        <span>{entry.pqcReplacement ?? "PQC replacement"} size</span>
        {simulating && (
          <span className="font-mono normal-case tracking-normal text-ink">{formatBytes(pqc)} bytes</span>
        )}
      </div>
      <div className="relative mb-2 h-6 rounded-sm bg-page">
        {/* Declared-boundary marker, for a direct visual reference line */}
        <div
          className="absolute top-0 h-full w-px bg-line-strong"
          style={{ left: `${declaredWidthPx}px` }}
          aria-hidden="true"
        />
        <div className="flex h-full">
          <div
            className={`h-full rounded-l-sm ${overflows ? "bg-accent" : "bg-status-good"} ${
              overflowPart === 0 && normalPart > 0 ? "rounded-r-sm" : ""
            }`}
            style={{ width: `${normalPart}px` }}
          />
          {overflowPart > 0 && (
            <div
              className={`h-full rounded-r-sm bg-status-critical ${settled ? "animate-overflow-pulse" : ""}`}
              style={{ width: `${overflowPart}px` }}
            />
          )}
        </div>
      </div>

      {simulating && settled && (
        <p className="text-sm font-medium">
          {overflows ? (
            <span className="text-status-critical">
              +{formatBytes(overflowBytesExact)} bytes over declared size
            </span>
          ) : (
            <span className="text-status-good">Fits within the declared buffer — no overflow</span>
          )}
        </p>
      )}

      <button
        type="button"
        onClick={() => setSimulating(true)}
        disabled={simulating}
        className="mt-4 rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink disabled:cursor-default disabled:opacity-40"
      >
        Simulate migration
      </button>
    </div>
  );
}

export function BlastRadiusMode({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const qualifying = useMemo(() => findings.filter((f) => f.blastRadius.length > 0), [findings]);

  const maxBytes = useMemo(() => {
    let max = 1;
    for (const f of qualifying) {
      for (const e of f.blastRadius) {
        max = Math.max(max, e.declaredBytes ?? 0, e.pqcBytes ?? 0);
      }
    }
    return max;
  }, [qualifying]);

  const selected = qualifying.find((f) => f.id === selectedId) ?? qualifying[0];

  if (qualifying.length === 0) {
    return (
      <div className="rounded-sm border border-line bg-surface p-6 text-sm text-ink-muted">
        No findings in the currently loaded CBOM carry blast-radius data.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4">
      <div className="w-[280px] shrink-0 overflow-y-auto rounded-sm border border-line bg-surface">
        {qualifying.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onSelect(f.id)}
            style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
            className={`animate-row-in flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left last:border-b-0 ${
              f.id === selected?.id ? "bg-accent/10" : "hover:bg-surface-2"
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                SEVERITY_DOT_CLASS[f.blastRadius[0]?.severity ?? ""] ?? "bg-status-neutral-fg"
              }`}
              aria-hidden="true"
            />
            <span className="truncate text-sm text-ink">{f.name}</span>
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto">
        {selected?.blastRadius.map((entry, i) => (
          <EntryView key={`${selected.id}-${i}`} entry={entry} maxBytes={maxBytes} />
        ))}
      </div>
    </div>
  );
}
