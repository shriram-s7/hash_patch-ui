import React from "react";

export type HighlightType = "CRITICAL" | "HIGH" | "WARNING" | "SAFE" | "INFO" | "UNKNOWN";

export interface AnswerHighlight {
  type: HighlightType;
  label: string;
  source_id?: string;
  description?: string;
}

interface MarkdownAnswerRendererProps {
  content: string;
  highlights?: AnswerHighlight[];
}

const HIGHLIGHT_STYLES: Record<HighlightType, { badge: string; dot: string; label: string }> = {
  CRITICAL: {
    badge: "border-status-critical/60 bg-status-critical/15 text-status-critical",
    dot: "bg-status-critical",
    label: "Critical",
  },
  HIGH: {
    badge: "border-status-critical/50 bg-status-critical/10 text-status-critical",
    dot: "bg-status-critical",
    label: "High Priority",
  },
  WARNING: {
    badge: "border-status-warning/60 bg-status-warning/15 text-status-warning-fg",
    dot: "bg-status-warning",
    label: "Warning",
  },
  SAFE: {
    badge: "border-status-good/60 bg-status-good/15 text-status-good",
    dot: "bg-status-good",
    label: "Safe",
  },
  INFO: {
    badge: "border-line-strong bg-surface-2 text-ink",
    dot: "bg-ink-muted",
    label: "Info",
  },
  UNKNOWN: {
    badge: "border-ink-muted/50 bg-surface-2 text-ink-muted",
    dot: "bg-ink-muted",
    label: "Unknown",
  },
};

/**
 * Safely parses inline markdown (bold, italic, inline code, links) without dangerouslySetInnerHTML.
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  // Regex to match `code`, **bold**, *italic*, [text](url)
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern);

  return parts.map((part, idx) => {
    if (!part) return null;

    // Inline code: `code`
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-ink border border-line"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold: **text**
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-ink">
          {renderInlineMarkdown(part.slice(2, -2))}
        </strong>
      );
    }

    // Italic: *text* (avoiding lone asterisks)
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2 && !part.startsWith("**")) {
      return (
        <em key={idx} className="italic text-ink">
          {renderInlineMarkdown(part.slice(1, -1))}
        </em>
      );
    }

    // Link: [text](url)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-ink hover:text-ink-secondary transition-colors"
        >
          {linkMatch[1]}
        </a>
      );
    }

    // Clean up any stray `* *` artifacts if left by the model
    const cleanedText = part.replace(/\*\s+\*/g, "•");
    return <React.Fragment key={idx}>{cleanedText}</React.Fragment>;
  });
}

/**
 * Safe, zero-dependency Markdown parser & renderer specifically built for Hash Patch QA responses.
 * Never executes raw HTML or arbitrary scripts.
 */
export function MarkdownAnswerRenderer({ content, highlights }: MarkdownAnswerRendererProps) {
  if (!content) return null;

  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];

  let currentList: { type: "ul" | "ol"; items: React.ReactNode[] } | null = null;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  function flushList() {
    if (!currentList) return;
    const ListTag = currentList.type;
    const listKey = `list-${elements.length}`;
    elements.push(
      <ListTag
        key={listKey}
        className={`my-2 space-y-1 pl-5 ${currentList.type === "ul" ? "list-disc" : "list-decimal"} font-sans text-sm text-ink`}
      >
        {currentList.items.map((item, i) => (
          <li key={i} className="leading-relaxed">
            {item}
          </li>
        ))}
      </ListTag>
    );
    currentList = null;
  }

  function flushTable() {
    if (!inTable || tableRows.length === 0) return;
    const tableKey = `table-${elements.length}`;
    const header = tableRows[0];
    const bodyRows = tableRows.slice(1).filter(r => !r.every(cell => /^[-: ]+$/.test(cell)));

    elements.push(
      <div key={tableKey} className="my-3 overflow-x-auto rounded-sm border border-line">
        <table className="min-w-full divide-y divide-line text-left font-sans text-xs">
          <thead className="bg-surface-2 font-heading font-semibold uppercase tracking-wider text-ink">
            <tr>
              {header.map((col, idx) => (
                <th key={idx} className="px-3 py-2">
                  {renderInlineMarkdown(col.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface text-ink">
            {bodyRows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-surface-2/50 transition-colors">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3 py-1.5 leading-normal">
                    {renderInlineMarkdown(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  }

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trimEnd();

    // Code blocks ```
    if (line.startsWith("```")) {
      flushList();
      flushTable();
      if (inCodeBlock) {
        // End code block
        elements.push(
          <pre
            key={`code-${idx}`}
            className="my-2 overflow-x-auto rounded-sm border border-line bg-page p-2.5 font-mono text-xs text-ink"
          >
            <code>{codeBlockLines.join("\n")}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      return;
    }

    // Tables (| col | col |)
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      flushList();
      inTable = true;
      const cells = line.trim().slice(1, -1).split("|");
      tableRows.push(cells);
      return;
    } else if (inTable) {
      flushTable();
    }

    // Headings #, ##, ###, ####
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const headingContent = renderInlineMarkdown(text);

      if (level === 1) {
        elements.push(
          <h1 key={`h1-${idx}`} className="mt-4 mb-2 font-heading text-lg font-bold tracking-tight text-ink border-b border-line pb-1">
            {headingContent}
          </h1>
        );
      } else if (level === 2) {
        elements.push(
          <h2 key={`h2-${idx}`} className="mt-3.5 mb-1.5 font-heading text-base font-semibold tracking-tight text-ink">
            {headingContent}
          </h2>
        );
      } else if (level === 3) {
        elements.push(
          <h3 key={`h3-${idx}`} className="mt-3 mb-1 font-heading text-sm font-semibold uppercase tracking-wider text-ink-secondary">
            {headingContent}
          </h3>
        );
      } else {
        elements.push(
          <h4 key={`h4-${idx}`} className="mt-2 mb-1 font-heading text-xs font-semibold uppercase tracking-wider text-ink-muted">
            {headingContent}
          </h4>
        );
      }
      return;
    }

    // Unordered lists (- or * or +)
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!currentList || currentList.type !== "ul") {
        flushList();
        currentList = { type: "ul", items: [] };
      }
      currentList.items.push(renderInlineMarkdown(ulMatch[2]));
      return;
    }

    // Ordered lists (1. or 2.)
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!currentList || currentList.type !== "ol") {
        flushList();
        currentList = { type: "ol", items: [] };
      }
      currentList.items.push(renderInlineMarkdown(olMatch[2]));
      return;
    }

    // Blockquote >
    if (line.startsWith(">")) {
      flushList();
      const quoteText = line.replace(/^>\s*/, "");
      elements.push(
        <blockquote
          key={`quote-${idx}`}
          className="my-2 border-l-2 border-line-strong pl-3 font-sans text-xs italic text-ink-secondary"
        >
          {renderInlineMarkdown(quoteText)}
        </blockquote>
      );
      return;
    }

    // Blank line
    if (!line.trim()) {
      flushList();
      return;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p key={`p-${idx}`} className="my-1.5 font-sans text-sm text-ink leading-relaxed">
        {renderInlineMarkdown(line)}
      </p>
    );
  });

  flushList();
  flushTable();

  return (
    <div className="space-y-1">
      {highlights && highlights.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5 border-b border-line pb-2">
          {highlights.map((h, i) => {
            const style = HIGHLIGHT_STYLES[h.type] || HIGHLIGHT_STYLES.INFO;
            return (
              <span
                key={i}
                title={h.description || h.source_id}
                className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wider ${style.badge}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                <span>{h.label}</span>
              </span>
            );
          })}
        </div>
      )}
      <div className="prose-container">{elements}</div>
    </div>
  );
}
