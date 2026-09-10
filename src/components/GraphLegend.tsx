import { LEGEND } from "../graphColors";

/** The one legend both Cluster mode and Tree mode render — status colors
 * plus the edge-kind key. Kept as a single component so the two layouts can
 * never drift into two different legends. */
export function GraphLegend() {
  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1 rounded-xl border px-2.5 py-2 z-10"
      style={{ background: "#161b22", borderColor: "#21262d" }}
    >
      {LEGEND.map((item) => (
        <div key={item.status} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-wide" style={{ color: "#8b949e" }}>{item.label}</span>
        </div>
      ))}
      <div className="mt-1 flex flex-col gap-1 border-t pt-1" style={{ borderColor: "#21262d" }}>
        <div className="flex items-center gap-1.5">
          <span className="h-0 w-3 border-t-2" style={{ borderColor: "#8b949e" }} aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-wide" style={{ color: "#8b949e" }}>Cross-function call</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: "#f59e0b" }} aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-wide" style={{ color: "#8b949e" }}>Ciphertext chain</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-0 w-3 border-t-[1.5px] border-dotted" style={{ borderColor: "#6e7681" }} aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-wide" style={{ color: "#8b949e" }}>Key-material binding</span>
        </div>
      </div>
    </div>
  );
}
