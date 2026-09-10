import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { applyTheme, getStoredTheme, type Theme } from "./theme";

/** The one light/dark toggle component in the app -- a sun/pill/moon
 * switch (no text label), used identically on the entry screen and
 * inside the main shell's top bar. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  const isDark = theme === "dark";

  return (
    <div className="flex items-center gap-1.5">
      <Sun className="h-3.5 w-3.5 shrink-0 text-amber-400" strokeWidth={2} aria-hidden="true" />
      <button
        type="button"
        onClick={toggle}
        role="switch"
        aria-checked={isDark}
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        title={`Switch to ${isDark ? "light" : "dark"} mode`}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-blue-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            isDark ? "translate-x-[18px]" : "translate-x-1"
          }`}
        />
      </button>
      <Moon className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden="true" />
    </div>
  );
}
