import { useEffect, useState } from "react";

const VAR_NAMES = [
  "--status-critical",
  "--status-warning",
  "--status-good",
  "--status-neutral-fg",
  "--accent",
  "--ink",
  "--ink-muted",
  "--line",
  "--surface",
  "--page",
] as const;

export type ThemeColors = Record<(typeof VAR_NAMES)[number], string>;

function readColors(): ThemeColors {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(VAR_NAMES.map((name) => [name, styles.getPropertyValue(name).trim()])) as ThemeColors;
}

/** Reads the app's CSS custom-property color tokens directly, so canvas
 * (which needs literal color strings, not Tailwind classes) stays in sync
 * with the same tokens the rest of the app uses — no redefined hex.
 * Re-reads whenever the `.dark` class on <html> toggles. */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(() => readColors());

  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

const QUANTUM_STATUS_COLOR_VAR: Record<string, keyof ThemeColors> = {
  "broken-by-shor": "--status-critical",
  "weakened-by-grover": "--status-warning",
  "quantum-safe": "--status-good",
  "broken-classically": "--status-neutral-fg",
  unknown: "--status-neutral-fg",
};

export function quantumStatusColor(colors: ThemeColors, status: string | undefined): string {
  const varName = status !== undefined ? QUANTUM_STATUS_COLOR_VAR[status] : undefined;
  return varName !== undefined ? colors[varName] : colors["--status-neutral-fg"];
}
