import type { ReactNode } from "react";

interface ExplainerBoxProps {
  title: string;
  type?: "info" | "warning" | "critical";
  onClose: () => void;
  children: ReactNode;
  learnMoreHref?: string;
  learnMoreLabel?: string;
}

const STYLES = {
  info: { bg: "#0d1a2e", border: "#3b82f6", text: "#94b4d4", icon: "ℹ" },
  warning: { bg: "#1a1200", border: "#f59e0b", text: "#fbbf24", icon: "⚠" },
  critical: { bg: "#1a0808", border: "#ef4444", text: "#fca5a5", icon: "🔴" },
} as const;

/** The one anchored explanation/reasoning popup box every "why?" trigger
 * app-wide opens — same fixed header (title + close button, never scrolls)
 * and body palette everywhere, so these can't drift into different shapes
 * again. Not for full-screen centered modals (e.g. ShelfLifeModal) — those
 * have their own backdrop/centering positioning logic, left untouched. */
export function ExplainerBox({ title, type = "info", onClose, children, learnMoreHref, learnMoreLabel }: ExplainerBoxProps) {
  const styles = STYLES[type];

  return (
    <div
      role="dialog"
      aria-label={title}
      className="overflow-hidden rounded-xl shadow-2xl"
      style={{
        background: styles.bg,
        border: "1px solid #21262d",
        borderTop: `3px solid ${styles.border}`,
        minWidth: "340px",
        maxWidth: "500px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}
    >
      {/* Fixed header — never scrolls */}
      <div className="flex items-center justify-between border-b border-[#21262d] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: styles.border }}>{styles.icon}</span>
          <span className="text-sm font-bold text-[#f0f6fc]">{title}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#161b22] text-xs text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#f0f6fc]"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3 text-sm leading-relaxed" style={{ color: styles.text }}>
        {children}
      </div>

      {/* Footer */}
      {learnMoreHref && (
        <div className="px-4 pb-3">
          <a href={learnMoreHref} className="text-xs text-[#3b82f6] hover:underline">
            {learnMoreLabel ?? "Learn more →"}
          </a>
        </div>
      )}
    </div>
  );
}
