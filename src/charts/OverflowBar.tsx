import type { BlastRadiusEntry } from "../cbom/types";

const TRACK_MAX_PX = 420;
const TRACK_MIN_PX = 6;

function byteWidthPx(bytes: number, maxBytes: number): number {
  if (bytes <= 0) return TRACK_MIN_PX;
  const logMax = Math.log(maxBytes + 1);
  const logVal = Math.log(bytes + 1);
  return Math.max(TRACK_MIN_PX, (logVal / logMax) * TRACK_MAX_PX);
}

function formatBytes(n: number): string {
  return n.toLocaleString();
}

interface OverflowBarProps {
  entry: BlastRadiusEntry;
  maxBytes: number;
}

/**
 * Static overflow bar for the Report/PDF — no animation, no "Simulate" button.
 * Always shows both the declared and PQC bars side by side.
 */
export function OverflowBar({ entry, maxBytes }: OverflowBarProps) {
  const declared = entry.declaredBytes ?? 0;
  const pqc = entry.pqcBytes ?? 0;
  const declaredWidthPx = byteWidthPx(declared, maxBytes);
  const pqcWidthPx = byteWidthPx(pqc, maxBytes);
  const overflows = pqc > declared;
  const normalPart = Math.min(pqcWidthPx, declaredWidthPx);
  const overflowPart = Math.max(0, pqcWidthPx - declaredWidthPx);
  const overflowBytesExact = entry.overflowBytes ?? Math.max(0, pqc - declared);

  return (
    <div className="rounded-sm border border-line bg-surface p-4 space-y-3">
      {/* Header: key + severity + replacement */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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

      {/* Declared bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-muted">
          <span className="font-heading font-medium">Declared buffer allocation</span>
          <span className="font-heading font-semibold text-ink tabular-nums normal-case">
            {formatBytes(declared)} bytes
          </span>
        </div>
        <div className="h-5 rounded-sm bg-page">
          <div className="h-full rounded-sm bg-ink-muted/50" style={{ width: `${declaredWidthPx}px` }} />
        </div>
      </div>

      {/* PQC replacement bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-muted">
          <span className="font-heading font-medium">{entry.pqcReplacement ?? "PQC replacement"} required size</span>
          <span className="font-heading font-semibold text-ink tabular-nums normal-case">
            {formatBytes(pqc)} bytes
          </span>
        </div>
        <div className="relative h-5 rounded-sm bg-page">
          {/* Declared-boundary marker */}
          <div
            className="absolute top-0 h-full w-px bg-line-strong"
            style={{ left: `${declaredWidthPx}px` }}
            aria-hidden="true"
          />
          <div className="flex h-full">
            <div
              className={`h-full rounded-l-sm ${overflows ? "bg-line-strong" : "bg-status-good"} ${
                overflowPart === 0 ? "rounded-r-sm" : ""
              }`}
              style={{ width: `${normalPart}px` }}
            />
            {overflowPart > 0 && (
              <div
                className="h-full rounded-r-sm bg-status-critical"
                style={{ width: `${overflowPart}px` }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Overflow verdict */}
      <p className="font-heading text-base font-semibold">
        {overflows ? (
          <span className="text-status-critical">
            +{formatBytes(overflowBytesExact)} bytes over declared size
          </span>
        ) : (
          <span className="text-status-good">Fits within the declared buffer — no overflow</span>
        )}
      </p>

      {/* File path / line / locator */}
      {entry.locator !== undefined && (
        <div className="font-mono text-xs text-ink-muted">{entry.locator}</div>
      )}
    </div>
  );
}

import type { Finding } from "../cbom/types";

export function getBlastRadiusScanComposition(
  scannedFiles?: string[],
  findings?: Finding[],
): {
  hasFixedBufferSupport: boolean;
  isPurePython: boolean;
  detectedLanguages: string[];
} {
  const locators = new Set<string>();
  if (scannedFiles && scannedFiles.length > 0) {
    for (const file of scannedFiles) locators.add(file.toLowerCase());
  } else if (findings && findings.length > 0) {
    for (const f of findings) {
      for (const e of f.evidence) {
        if (e.locator) locators.add(e.locator.toLowerCase());
      }
    }
  }

  const exts = new Set<string>();
  for (const loc of locators) {
    const extMatch = loc.match(/\.([a-z0-9]+)$/);
    if (extMatch) exts.add(extMatch[1]);
  }

  const langs = new Set<string>();
  if (exts.has("py")) langs.add("Python");
  if (exts.has("c") || exts.has("h") || exts.has("cpp") || exts.has("cc")) langs.add("C/C++");
  if (exts.has("go")) langs.add("Go");
  if (exts.has("java")) langs.add("Java");
  if (exts.has("sql")) langs.add("SQL");

  const hasFixedBufferSupport =
    exts.has("c") ||
    exts.has("h") ||
    exts.has("cpp") ||
    exts.has("cc") ||
    exts.has("go") ||
    exts.has("java") ||
    exts.has("sql");
  const isPurePython = langs.has("Python") && langs.size === 1;

  return {
    hasFixedBufferSupport,
    isPurePython,
    detectedLanguages: Array.from(langs),
  };
}

/**
 * Honest empty-state explanation for when blast-radius analysis ran but found nothing,
 * dynamically tailored to the scanned repository's actual language composition.
 */
export function BlastRadiusEmptyState({
  scannedFiles,
  findings,
}: {
  scannedFiles?: string[];
  findings?: Finding[];
}) {
  const { hasFixedBufferSupport, isPurePython, detectedLanguages } =
    getBlastRadiusScanComposition(scannedFiles, findings);

  const langList = detectedLanguages.join(", ");

  let explanation: string;
  if (hasFixedBufferSupport) {
    explanation = `PQC size constraint analysis ran across the scanned codebase (including ${langList || "systems files"}), and detected no fixed-size buffer allocations or database column constraints that would overflow under post-quantum algorithm replacement.`;
  } else if (isPurePython) {
    explanation =
      "PQC size constraint analysis detects fixed-size memory buffers and database column widths that may be too small for larger post-quantum cryptographic outputs. Pure-Python codebases allocate memory dynamically at runtime, so static buffer overflows are not applicable and zero overflows are expected.";
  } else {
    explanation =
      "No fixed-size memory buffers or database column widths were found that would overflow under the analyzed PQC replacements.";
  }

  return (
    <div className="rounded-sm border border-line bg-surface p-6 space-y-1.5">
      <p className="font-heading text-base font-medium text-ink">No PQC size constraints detected</p>
      <p className="font-sans text-sm text-ink-muted leading-relaxed">{explanation}</p>
    </div>
  );
}
