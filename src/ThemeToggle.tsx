import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { applyTheme, getStoredTheme, type Theme } from "./theme";

/** The one light/dark toggle component in the app -- used identically on
 * the entry screen and inside the main shell, per the design brief's
 * requirement that there never be two separate implementations. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="flex items-center gap-1.5 rounded-sm border border-line px-2.5 py-1.5 font-heading text-[11px] font-medium uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink transition-colors"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
