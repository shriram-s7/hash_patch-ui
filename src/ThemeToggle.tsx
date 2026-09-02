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
      className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
