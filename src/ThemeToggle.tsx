import { useState } from "react";
import { applyTheme, getStoredTheme, type Theme } from "./theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink"
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
