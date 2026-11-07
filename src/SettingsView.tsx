import { useState } from "react";
import { Check } from "lucide-react";
import { tourStore } from "./tour/store";
import { FEATURE_GUIDED_UI } from "./tour/flags";

type SettingType = "number" | "toggle" | "select" | "slider" | "display";

interface SettingDef {
  id: string;
  label: string;
  type: SettingType;
  default?: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  value?: string;
  description?: string;
}

interface SettingsSection {
  title: string;
  settings: SettingDef[];
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    title: "Scan Configuration",
    settings: [
      { id: "scan-depth", label: "Max scan depth", type: "number", default: 10, min: 1, max: 50, description: "Maximum directory recursion depth during scan" },
      { id: "lang-python", label: "Scan Python files", type: "toggle", default: true },
      { id: "lang-java", label: "Scan Java files", type: "toggle", default: true },
      { id: "lang-go", label: "Scan Go files", type: "toggle", default: true },
      { id: "lang-c", label: "Scan C files", type: "toggle", default: true },
      { id: "confidence-threshold", label: "Detection confidence threshold", type: "select", options: ["Low", "Medium", "High"], default: "Medium", description: "Minimum confidence level to include a finding" },
      { id: "reachability-enabled", label: "Enable reachability analysis", type: "toggle", default: true, description: "Compute call-graph reachability for each finding" },
    ],
  },
  {
    title: "Local AI (Ask Patch AI)",
    settings: [
      { id: "ai-model", label: "Local AI model", type: "select", options: ["phi3:mini", "llama3.2:3b", "mistral:7b"], default: "phi3:mini", description: "Ollama model used for Ask Patch AI responses" },
      { id: "ai-ram-limit", label: "RAM allocation", type: "slider", min: 4, max: 16, step: 2, default: 8, unit: "GB", description: "Maximum RAM available to the local AI model" },
    ],
  },
  {
    title: "Export & Reports",
    settings: [
      { id: "export-format", label: "Default export format", type: "select", options: ["CycloneDX 1.6", "JSON", "PDF"], default: "CycloneDX 1.6" },
      { id: "auto-open-report", label: "Auto-open report after scan", type: "toggle", default: false },
    ],
  },
  {
    title: "Appearance",
    settings: [
      { id: "theme", label: "Theme", type: "display", value: "Dark (only mode available)", description: "Light mode coming in a future release" },
    ],
  },
];

const STORAGE_KEY = "hashpatch-settings";

type SettingsState = Record<string, number | boolean | string>;

function defaultState(): SettingsState {
  const state: SettingsState = {};
  for (const section of SETTINGS_SECTIONS) {
    for (const s of section.settings) {
      if (s.default !== undefined) state[s.id] = s.default;
    }
  }
  return state;
}

function loadState(): SettingsState {
  const defaults = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as unknown;
    if (saved && typeof saved === "object") return { ...defaults, ...(saved as SettingsState) };
  } catch {
    // ignore malformed storage, fall back to defaults
  }
  return defaults;
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
      style={{ background: on ? "#3b82f6" : "#30363d" }}
    >
      <span
        className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

export function SettingsView() {
  const [settings, setSettings] = useState<SettingsState>(() => loadState());
  const [saved, setSaved] = useState(false);

  const set = (id: string, value: number | boolean | string) => {
    setSettings((prev) => ({ ...prev, [id]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "#0d1117" }}>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[820px]">
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-sm" style={{ color: "#8b949e" }}>
            Configure Hash Patch behaviour and preferences.
          </p>

          <div className="mt-6 space-y-5 pb-24">
            {SETTINGS_SECTIONS.map((section) => (
              <div key={section.title} className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
                <h2 className="text-sm font-semibold text-white">{section.title}</h2>
                <div className="mt-3 divide-y" style={{ borderColor: "#21262d" }}>
                  {section.settings.map((setting) => (
                    <div key={setting.id} className="flex items-center justify-between gap-6 py-3 first:pt-0 last:pb-0" style={{ borderColor: "#21262d" }}>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{setting.label}</div>
                        {setting.description && (
                          <p className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>
                            {setting.description}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0">
                        {setting.type === "toggle" && (
                          <Toggle on={Boolean(settings[setting.id])} onChange={(v) => set(setting.id, v)} />
                        )}

                        {setting.type === "number" && (
                          <input
                            type="number"
                            min={setting.min}
                            max={setting.max}
                            value={Number(settings[setting.id] ?? setting.default ?? 0)}
                            onChange={(e) => {
                              const n = Math.min(setting.max ?? Infinity, Math.max(setting.min ?? -Infinity, Number(e.target.value) || 0));
                              set(setting.id, n);
                            }}
                            className="w-20 rounded-md border px-2 py-1 text-right font-mono text-sm text-white focus:outline-none"
                            style={{ background: "#0d1117", borderColor: "#30363d" }}
                          />
                        )}

                        {setting.type === "select" && setting.options && (
                          <select
                            value={String(settings[setting.id] ?? setting.default ?? "")}
                            onChange={(e) => set(setting.id, e.target.value)}
                            className="rounded-md border px-2.5 py-1.5 text-sm text-white focus:outline-none"
                            style={{ background: "#0d1117", borderColor: "#30363d" }}
                          >
                            {setting.options.map((opt) => (
                              <option key={opt} value={opt} style={{ background: "#0d1117", color: "#ffffff" }}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}

                        {setting.type === "slider" && (
                          <div className="flex items-center gap-3">
                            <input
                              type="range"
                              min={setting.min}
                              max={setting.max}
                              step={setting.step}
                              value={Number(settings[setting.id] ?? setting.default ?? setting.min ?? 0)}
                              onChange={(e) => set(setting.id, Number(e.target.value))}
                              className="w-32 accent-blue-500"
                            />
                            <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-white">
                              {settings[setting.id] ?? setting.default}
                              {setting.unit ? ` ${setting.unit}` : ""}
                            </span>
                          </div>
                        )}

                        {setting.type === "display" && (
                          <span className="text-sm" style={{ color: "#8b949e" }}>
                            {setting.value}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {FEATURE_GUIDED_UI && (
              <div className="rounded-xl border p-5" style={{ background: "#161b22", borderColor: "#21262d" }}>
                <h2 className="text-sm font-semibold text-white">Guided Tour</h2>
                <div className="mt-3 flex items-center justify-between gap-6 py-1">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">Restart guided tour</div>
                    <p className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>
                      Clears every coachmark you've already dismissed so the tour shows again. Same as Ctrl+Shift+T.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => tourStore.resetAll()}
                    className="shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/5"
                    style={{ borderColor: "#30363d" }}
                  >
                    Restart tour
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t px-6 py-4" style={{ borderColor: "#21262d", background: "#0d1117" }}>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#22c55e" }}>
            <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            Saved
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="rounded-lg px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "#3b82f6" }}
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}
