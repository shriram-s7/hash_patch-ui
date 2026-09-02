export interface Mode {
  id: string;
  label: string;
}

/** Data-driven so later modes can be appended without touching the toolbar
 * markup. */
export const MODES: Mode[] = [
  { id: "overview", label: "Overview" },
  { id: "graph", label: "Graph" },
  { id: "code", label: "Code" },
  { id: "blast-radius", label: "Blast Radius" },
  { id: "verify", label: "Verify" },
];

export function ModeSwitcher({
  activeMode,
  onChange,
}: {
  activeMode: string;
  onChange: (mode: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-sm border border-line bg-surface p-0.5">
      {MODES.map((mode) => {
        const active = mode.id === activeMode;
        return (
          <button
            key={mode.id}
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => onChange(mode.id)}
            className={`rounded-[2px] px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${
              active ? "bg-accent text-accent-fg" : "text-ink-secondary hover:text-ink"
            }`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
