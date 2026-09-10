import { LEGEND } from "../graphColors";

export function GraphSearchFilterBar({
  searchTerm,
  onSearchChange,
  activeFilters,
  onToggleFilter,
}: {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  activeFilters: string[];
  onToggleFilter: (status: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <input
        type="text"
        placeholder="Find node..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="px-3 py-1.5 rounded-lg bg-[#161b22] border border-[#21262d] text-sm text-[#f0f6fc] placeholder-[#8b949e] w-48 focus:border-[#3b82f6] outline-none"
      />
      {LEGEND.map(({ status, color, label }) => {
        const isActive = activeFilters.includes(status);
        return (
          <button
            key={status}
            type="button"
            onClick={() => onToggleFilter(status)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors ${
              isActive ? "border-transparent" : "opacity-40 border-[#21262d]"
            }`}
            style={{
              backgroundColor: isActive ? color + "20" : undefined,
              color,
              borderColor: isActive ? color + "40" : undefined,
            }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
