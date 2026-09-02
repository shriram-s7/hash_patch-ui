import { useState } from "react";
import { Highlight, themes } from "prism-react-renderer";
import type { Finding } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { quantumStatusColor, useThemeColors } from "./useThemeColors";
import { useIsDark } from "./useIsDark";

const EXT_TO_LANGUAGE: Record<string, string> = {
  py: "python",
  java: "java",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
};

function inferLanguage(locator: string | undefined): string {
  const ext = locator?.split(".").pop()?.toLowerCase();
  return (ext !== undefined && EXT_TO_LANGUAGE[ext]) || "clike";
}

function shortLocator(locator: string | undefined): string {
  if (locator === undefined) return "(unknown file)";
  const parts = locator.split(/[\\/]/);
  return parts[parts.length - 1] ?? locator;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const LINE_HEIGHT_PX = 20;

export function CodeAnnotationView({ finding }: { finding: Finding }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const colors = useThemeColors();
  const isDark = useIsDark();

  const evidence = finding.evidence;
  const active = evidence[Math.min(activeIndex, evidence.length - 1)];
  const statusColor = quantumStatusColor(colors, finding.quantumStatus);

  if (active === undefined || active.snippet === undefined) {
    return (
      <div className="rounded-sm border border-line bg-surface p-4 text-sm text-ink-muted">
        No evidence snippet available for this finding.
      </div>
    );
  }

  const language = inferLanguage(active.locator);
  const normalizedSnippet = active.snippet.replace(/\r\n/g, "\n");
  const isMultiLine = normalizedSnippet.includes("\n");
  // The snippet's first line is always the physical source line the match
  // was found on (`line`/`column` describe that same line) — every
  // multi-line snippet in this dataset follows that shape. There is no
  // matched-token end offset in the data, so for a multi-line snippet the
  // highlighted region runs from `column` to the end of that first line;
  // for a single-line snippet there's no useful column boundary to draw
  // (the whole line typically IS the match), so the whole line is
  // highlighted instead.
  const highlightLine = 0;
  const highlightFromColumn = isMultiLine ? (active.column ?? 0) : 0;

  return (
    <div>
      {evidence.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {evidence.map((e, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIndex(i)}
              className={`rounded-sm border px-2 py-1 font-mono text-[11px] ${
                i === activeIndex
                  ? "border-accent bg-accent/15 text-ink"
                  : "border-line text-ink-secondary hover:border-line-strong hover:text-ink"
              }`}
            >
              {shortLocator(e.locator)}
              {e.line !== undefined ? `:${e.line}` : ""}
            </button>
          ))}
        </div>
      )}

      <div className="relative overflow-hidden rounded-sm border border-line">
        <div className="flex items-center justify-between gap-2 border-b border-line bg-page px-3 py-1.5">
          <span className="break-all font-mono text-[11px] text-ink-secondary">
            {active.locator ?? "(unknown file)"}
            {active.line !== undefined ? `:${active.line}` : ""}
            {active.column !== undefined ? `:${active.column}` : ""}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-xs font-semibold text-ink">{finding.name}</span>
            <QuantumStatusBadge status={finding.quantumStatus} />
          </div>
        </div>

        <Highlight
          code={normalizedSnippet}
          language={language}
          theme={isDark ? themes.vsDark : themes.github}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={`${className} overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-xs`}
              style={{ ...style, backgroundColor: colors["--surface"], lineHeight: `${LINE_HEIGHT_PX}px` }}
            >
              {tokens.map((line, lineIndex) => {
                const isHighlightLine = lineIndex === highlightLine;
                let charOffset = 0;
                return (
                  <div key={lineIndex} {...getLineProps({ line })}>
                    {line.map((token, tokenIndex) => {
                      const tokenProps = getTokenProps({ token });
                      const start = charOffset;
                      charOffset += token.content.length;
                      const inHighlight = isHighlightLine && start + token.content.length > highlightFromColumn;
                      return (
                        <span
                          key={tokenIndex}
                          {...tokenProps}
                          style={{
                            ...tokenProps.style,
                            backgroundColor: inHighlight ? hexToRgba(statusColor, 0.22) : undefined,
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
}
