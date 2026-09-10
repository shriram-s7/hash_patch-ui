import type { QuantumStatus } from "./cbom/types";

/**
 * Single source of truth for graph node fill color, shared by Cluster mode
 * and Tree mode so the two layouts can never drift into two different color
 * mappings. Fixed hex, not a CSS-variable lookup — the app's canvas/SVG
 * graphs need literal color strings, and reading raw `--status-critical`-style
 * custom properties (see the old `useThemeColors`/`quantumStatusColor` path)
 * silently returns an empty string when the property name doesn't exactly
 * match what index.css defines (which is why node fills were broken before
 * this file existed). Every other redesigned view in this app already uses
 * fixed hex for the same reason.
 */
export const NODE_COLORS: Record<string, string> = {
  "broken-by-shor": "#ef4444",
  "weakened-by-grover": "#f59e0b",
  "quantum-safe": "#22c55e",
  "broken-classically": "#6b7280",
  unknown: "#374151",
  // Cloud KMS/HSM client call — deliberately NOT on the red/amber/green/gray
  // quantum-verdict scale (see cbom/types.ts QuantumStatus doc), so it keeps
  // the violet used for this status everywhere else in the app instead of
  // collapsing into the neutral-gray default.
  "algorithm-opaque-provider-managed": "#8b5cf6",
};

export const DEFAULT_NODE_COLOR = "#374151";

export function getNodeColor(status: QuantumStatus | string | undefined): string {
  if (status === undefined) return DEFAULT_NODE_COLOR;
  return NODE_COLORS[status] ?? DEFAULT_NODE_COLOR;
}

/** The one legend both Cluster and Tree mode render — same four entries,
 * same order, same colors as NODE_COLORS above. */
export const LEGEND: { status: string; color: string; label: string }[] = [
  { status: "broken-by-shor", color: "#ef4444", label: "Broken by Shor" },
  { status: "weakened-by-grover", color: "#f59e0b", label: "Weakened by Grover" },
  { status: "quantum-safe", color: "#22c55e", label: "Quantum-safe" },
  { status: "broken-classically", color: "#6b7280", label: "Broken Classically" },
];

/** The statuses the filter chips toggle — same four as the legend. */
export const FILTERABLE_STATUSES = LEGEND.map((l) => l.status);

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  LEGEND.map((l) => [l.status, l.label])
);
