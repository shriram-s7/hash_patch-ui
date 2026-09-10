import { useMemo, useState } from "react";
import { displayName, type Finding, type Reachability, type ExposureState, type ShelfLifeEntry } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { compareFindingsPriority } from "./priority";
import { ShelfLifeModal } from "./ShelfLifeModal";
import { groupUniqueFindings, type UniqueFindingGroup } from "./UniqueFindingsPanel";
import { Layers, ListFilter } from "lucide-react";

/** The ShelfLifeEntry backing a finding's longestShelfLifeYears value (the
 * one FindingsTable's "Shelf-life (yrs)" column actually displays), or
 * undefined if the finding has no shelf-life data at all. */
function longestShelfLifeEntry(finding: Finding): ShelfLifeEntry | undefined {
  if (finding.longestShelfLifeYears === undefined) return undefined;
  return finding.shelfLife.find((s) => s.shelfLifeYears === finding.longestShelfLifeYears);
}

/** Sum of estimatedEffortDays across a finding's blast-radius entries, or
 * undefined if none carry that field (defensive: never show 0 for "no data"). */
function totalBlastRadiusDays(finding: Finding): number | undefined {
  const days = finding.blastRadius
    .map((b) => b.estimatedEffortDays)
    .filter((d): d is number => d !== undefined);
  return days.length > 0 ? days.reduce((a, b) => a + b, 0) : undefined;
}

// Row entrance is staggered on data load only; capped so a large result set
// (e.g. 41 findings) doesn't drag the animation out.
const MAX_STAGGER_MS = 300;
const STAGGER_STEP_MS = 12;

type FilterValue = "all" | Reachability | "mixed";
type ExposureFilterValue = "all" | ExposureState;
type QuantumFilterValue = "all" | "broken-by-shor" | "weakened-by-grover" | "quantum-safe" | "broken-classically";

interface FilterOption {
  value: FilterValue;
  label: string;
}

interface ExposureFilterOption {
  value: ExposureFilterValue;
  label: string;
}

interface QuantumFilterOption {
  value: QuantumFilterValue;
  label: string;
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: "all", label: "All" },
  { value: "live-external", label: "Live (entry-reachable)" },
  { value: "live-internal", label: "Live (internal-call)" },
  { value: "mixed", label: "Mixed" },
  { value: "unknown", label: "Unknown" },
  { value: "inert", label: "Inert (dead code)" },
];

const EXPOSURE_FILTER_OPTIONS: ExposureFilterOption[] = [
  { value: "all", label: "All" },
  { value: "external", label: "External" },
  { value: "internal", label: "Internal" },
  { value: "mixed", label: "Mixed" },
  { value: "unknown", label: "Unknown" },
];

const QUANTUM_FILTER_OPTIONS: QuantumFilterOption[] = [
  { value: "all", label: "All Unique" },
  { value: "broken-by-shor", label: "Broken by Shor" },
  { value: "weakened-by-grover", label: "Weakened by Grover" },
  { value: "quantum-safe", label: "Quantum-safe" },
  { value: "broken-classically", label: "Broken Classically" },
];

export function FindingsTable({
  findings,
  selectedId,
  onSelect,
  viewMode: controlledViewMode,
  onViewModeChange,
  selectedUniqueKey,
  onSelectUniqueGroup,
}: {
  findings: Finding[];
  selectedId: string | undefined;
  onSelect: (finding: Finding) => void;
  viewMode?: "all" | "unique";
  onViewModeChange?: (mode: "all" | "unique") => void;
  selectedUniqueKey?: string;
  onSelectUniqueGroup?: (group: UniqueFindingGroup) => void;
}) {
  const [internalViewMode, setInternalViewMode] = useState<"all" | "unique">("all");
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = (mode: "all" | "unique") => {
    setInternalViewMode(mode);
    onViewModeChange?.(mode);
  };

  // Reachability filter state: Set of selected filters. Defaults to ["all"]
  const [selectedFilters, setSelectedFilters] = useState<Set<FilterValue>>(new Set(["all"]));
  // Exposure filter state: Set of selected filters. Defaults to ["all"]
  const [selectedExposureFilters, setSelectedExposureFilters] = useState<Set<ExposureFilterValue>>(new Set(["all"]));
  // Unique view quantum status filter
  const [selectedQuantumFilters, setSelectedQuantumFilters] = useState<Set<QuantumFilterValue>>(new Set(["all"]));

  const [shelfLifeModal, setShelfLifeModal] = useState<{ assetName: string; entry: ShelfLifeEntry } | undefined>(
    undefined
  );

  // Group findings into unique algorithms
  const uniqueGroups = useMemo(() => groupUniqueFindings(findings), [findings]);

  const handleToggleFilter = (val: FilterValue) => {
    setSelectedFilters((prev) => {
      const next = new Set(prev);
      if (val === "all") {
        return new Set(["all"]);
      }
      next.delete("all");
      if (next.has(val)) {
        next.delete(val);
      } else {
        next.add(val);
      }
      // If no filters selected, reset to all
      if (next.size === 0) {
        return new Set(["all"]);
      }
      // If all 5 individual filters selected, reset to all
      if (next.size === 5) {
        return new Set(["all"]);
      }
      return next;
    });
  };

  const handleToggleExposureFilter = (val: ExposureFilterValue) => {
    setSelectedExposureFilters((prev) => {
      const next = new Set(prev);
      if (val === "all") {
        return new Set(["all"]);
      }
      next.delete("all");
      if (next.has(val)) {
        next.delete(val);
      } else {
        next.add(val);
      }
      // If no filters selected, reset to all
      if (next.size === 0) {
        return new Set(["all"]);
      }
      // If all 4 individual filters selected, reset to all
      if (next.size === 4) {
        return new Set(["all"]);
      }
      return next;
    });
  };

  // A CERTIFICATE/CERTIFICATE_UNPARSEABLE finding (hash_patch/detect/
  // certificates.py) has no reachability either — a certificate file is
  // never "called" from code, so it never gets assigned a reachability
  // bucket, same rule as CRYPTO_REFERENCE below (but unlike a reference, it
  // DOES keep its real quantum-status severity).
  const hasNoReachability = (f: Finding) =>
    f.findingType === "CRYPTO_REFERENCE" ||
    f.findingType === "CERTIFICATE" ||
    f.findingType === "CERTIFICATE_UNPARSEABLE";

  const referenceCount = useMemo(
    () => findings.filter((f) => f.findingType === "CRYPTO_REFERENCE").length,
    [findings]
  );
  const certificateCount = useMemo(
    () => findings.filter((f) => f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE").length,
    [findings]
  );

  // Counts for each filter option. Reachability is not a meaningful concept
  // for a CRYPTO_REFERENCE (a string literal that merely looks like an
  // algorithm name, never passed to a crypto API call) or a CERTIFICATE
  // finding (never "called" from code) — neither ever gets assigned to a
  // reachability bucket, so they must not inflate "Unknown" (or any other
  // bucket) here. "All" alone still counts every finding.
  const filterCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: findings.length,
      "live-external": 0,
      "live-internal": 0,
      mixed: 0,
      unknown: 0,
      inert: 0,
    };
    for (const f of findings) {
      if (hasNoReachability(f)) continue;
      // A Mixed-reachability finding counts ONLY toward "mixed" — counting it
      // into its resolved live-external/live-internal/etc bucket too would
      // double-count it and make the chip totals exceed the finding count.
      if (f.mixedReachability) {
        counts.mixed = (counts.mixed ?? 0) + 1;
        continue;
      }
      const reach = f.reachability ?? "unknown";
      counts[reach] = (counts[reach] ?? 0) + 1;
    }
    return counts;
  }, [findings]);

  const exposureFilterCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: findings.length,
      external: 0,
      internal: 0,
      mixed: 0,
      unknown: 0,
    };
    for (const f of findings) {
      if (f.findingType === "CRYPTO_REFERENCE" || f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE") continue;
      const exposure = f.exposureState ?? "unknown";
      counts[exposure] = (counts[exposure] ?? 0) + 1;
    }
    return counts;
  }, [findings]);

  // Filter and sort findings using consolidated priority comparator
  const visibleFindings = useMemo(() => {
    const sorted = [...findings].sort(compareFindingsPriority);
    if (selectedFilters.has("all") && selectedExposureFilters.has("all")) {
      return sorted;
    }
    // A reachability filter (Live/Unknown/Inert) is about real operations —
    // neither a CRYPTO_REFERENCE nor a CERTIFICATE finding ever matches
    // one, same rule as the counts above.
    return sorted.filter((f) => {
      if (f.findingType === "CRYPTO_REFERENCE" || f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE") return false;
      const reach = f.reachability ?? "unknown";
      const exposure = f.exposureState ?? "unknown";
      // Mixed-reachability findings belong exclusively to the "mixed" filter
      // — a single-state filter (live-external, live-internal, unknown,
      // inert) must never also match a Mixed finding just because its
      // resolved top-level reachability happens to equal that state.
      const reachMatch =
        selectedFilters.has("all") ||
        (f.mixedReachability
          ? selectedFilters.has("mixed")
          : selectedFilters.has(reach as FilterValue));
      const exposureMatch = selectedExposureFilters.has("all") || selectedExposureFilters.has(exposure as ExposureFilterValue);
      return reachMatch && exposureMatch;
    });
  }, [findings, selectedFilters, selectedExposureFilters]);
  // Unique counts for quantum filters:
  const uniqueCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: uniqueGroups.length,
      "broken-by-shor": 0,
      "weakened-by-grover": 0,
      "quantum-safe": 0,
      "broken-classically": 0,
    };
    for (const g of uniqueGroups) {
      const qs = g.quantumStatus ?? "broken-by-shor";
      if (counts[qs] !== undefined) {
        counts[qs] += 1;
      }
    }
    return counts;
  }, [uniqueGroups]);

  const handleToggleQuantumFilter = (val: QuantumFilterValue) => {
    setSelectedQuantumFilters((prev) => {
      const next = new Set(prev);
      if (val === "all") return new Set(["all"]);
      next.delete("all");
      if (next.has(val)) next.delete(val);
      else next.add(val);
      if (next.size === 0 || next.size === 4) return new Set(["all"]);
      return next;
    });
  };

  const visibleUniqueGroups = useMemo(() => {
    if (selectedQuantumFilters.has("all")) return uniqueGroups;
    return uniqueGroups.filter((g) => {
      const qs = g.quantumStatus ?? "broken-by-shor";
      return selectedQuantumFilters.has(qs as QuantumFilterValue);
    });
  }, [uniqueGroups, selectedQuantumFilters]);

  return (
    <div className="space-y-3">
      {/* Top View Mode Switcher + Count summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b" style={{ borderColor: "#21262d" }}>
        <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: "#30363d", background: "#161b22" }}>
          <button
            type="button"
            onClick={() => setViewMode("all")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              viewMode === "all"
                ? "bg-[#3b82f6] text-white shadow-sm"
                : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc]"
            }`}
          >
            <ListFilter className="h-3.5 w-3.5" />
            <span>All Findings</span>
            <span
              className="rounded-full px-2 py-0.2 font-mono text-[10px] tabular-nums font-bold"
              style={{
                background: viewMode === "all" ? "rgba(255,255,255,0.2)" : "#21262d",
                color: viewMode === "all" ? "#ffffff" : "#8b949e",
              }}
            >
              {findings.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("unique")}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
              viewMode === "unique"
                ? "bg-[#3b82f6] text-white shadow-sm"
                : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#f0f6fc]"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Unique Only</span>
            <span
              className="rounded-full px-2 py-0.2 font-mono text-[10px] tabular-nums font-bold"
              style={{
                background: viewMode === "unique" ? "rgba(255,255,255,0.2)" : "#21262d",
                color: viewMode === "unique" ? "#ffffff" : "#8b949e",
              }}
            >
              {uniqueGroups.length}
            </span>
          </button>
        </div>

        <div className="text-xs text-[#8b949e]">
          {viewMode === "all" ? (
            <span>Showing individual occurrence items with runtime reachability & blast radius</span>
          ) : (
            <span className="text-blue-400 font-medium">
              Showing {visibleUniqueGroups.length} unique cryptographic algorithms ({uniqueGroups.length} total) across {findings.length} occurrences
            </span>
          )}
        </div>
      </div>

      {viewMode === "unique" ? (
        /* ================= UNIQUE ONLY VIEW ================= */
        <div className="space-y-3">
          {/* Quantum Status Filter Chips with Unique Counts */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
              Filter Status:
            </span>
            {QUANTUM_FILTER_OPTIONS.map((opt) => {
              const isActive = selectedQuantumFilters.has(opt.value);
              const count = uniqueCounts[opt.value] ?? 0;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleToggleQuantumFilter(opt.value)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                  style={
                    isActive
                      ? { background: "#3b82f6", borderColor: "#3b82f6", color: "#ffffff" }
                      : { background: "transparent", borderColor: "#30363d", color: "#c9d1d9" }
                  }
                >
                  <span>{opt.label}</span>
                  <span
                    className="rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums"
                    style={{ background: isActive ? "rgba(255,255,255,0.2)" : "#21262d", color: isActive ? "#ffffff" : "#8b949e" }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Unique Only Table */}
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "#21262d", background: "#0d1117" }}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {["Algorithm / Unique Asset", "Occurrences", "Quantum Status", "Category", "Recommended Migration", "Standard / Shelf-Life"].map((h) => (
                    <th key={h} className="border-b px-3.5 py-2.5 text-[11px] font-medium uppercase tracking-wide" style={{ borderColor: "#21262d", color: "#6e7681" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleUniqueGroups.map((g, i) => {
                  const isSelected = g.key === selectedUniqueKey;
                  return (
                    <tr
                      key={g.key}
                      onClick={() => onSelectUniqueGroup?.(g)}
                      className={`animate-row-in cursor-pointer border-b last:border-b-0 transition-colors ${
                        isSelected ? "font-semibold" : "hover:bg-[#161b22] font-normal"
                      }`}
                      style={{
                        borderColor: "#21262d",
                        background: isSelected ? "#1d2d44" : "transparent",
                        animationDelay: `${Math.min(i * STAGGER_STEP_MS, MAX_STAGGER_MS)}ms`,
                      }}
                    >
                      {/* Algorithm / Asset name & tags */}
                      <td className="px-3.5 py-3 text-sm font-semibold text-white">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{g.displayName}</span>
                          {g.hasCertificate && (
                            <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted border border-line">
                              Certificate
                            </span>
                          )}
                          {g.hasReference && (
                            <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-surface-2 text-ink-muted border border-line">
                              Reference
                            </span>
                          )}
                          {g.hasCloudKey && (
                            <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-status-opaque text-white border border-line">
                              Cloud KMS
                            </span>
                          )}
                          {g.hasBinaryCrypto && (
                            <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                              Compiled Binary
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Occurrences count */}
                      <td className="px-3.5 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          <Layers className="h-3 w-3" />
                          <span>{g.count} {g.count === 1 ? "occurrence" : "occurrences"}</span>
                        </span>
                      </td>

                      {/* Quantum Status */}
                      <td className="px-3.5 py-3">
                        <QuantumStatusBadge status={g.quantumStatus} />
                      </td>

                      {/* Category */}
                      <td className="px-3.5 py-3 text-xs text-[#c9d1d9] capitalize">
                        {g.category}
                      </td>

                      {/* Recommended Replacement */}
                      <td className="px-3.5 py-3 text-xs">
                        <span className="font-semibold text-emerald-400">
                          {g.recommendation.recommendedAlgorithm}
                        </span>
                      </td>

                      {/* Standard / Shelf-Life */}
                      <td className="px-3.5 py-3 text-xs text-[#8b949e]">
                        <div>{g.recommendation.standard}</div>
                        {g.longestShelfLifeYears !== undefined && (
                          <div className="text-[11px] text-[#c9d1d9] mt-0.5">
                            Shelf-life: {g.longestShelfLifeYears} yrs
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleUniqueGroups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center space-y-1">
                      <p className="font-heading text-base font-medium text-ink">No unique findings match filter</p>
                      <p className="font-sans text-sm text-ink-muted leading-relaxed">
                        Try selecting "All Unique" to view all unique cryptographic algorithms.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ================= ALL FINDINGS VIEW ================= */
        <div className="space-y-3">
          {/* Reachability Filter Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
              Filter Reachability:
            </span>
            {FILTER_OPTIONS.map((opt) => {
              const isActive = selectedFilters.has(opt.value);
              const count = filterCounts[opt.value] ?? 0;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleToggleFilter(opt.value)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
                  style={
                    isActive
                      ? { background: "#3b82f6", borderColor: "#3b82f6", color: "#ffffff" }
                      : { background: "transparent", borderColor: "#30363d", color: "#c9d1d9" }
                  }
                >
                  <span>{opt.label}</span>
                  <span
                    className="rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums"
                    style={{ background: isActive ? "rgba(255,255,255,0.2)" : "#21262d", color: isActive ? "#ffffff" : "#8b949e" }}
                  >
                    {opt.value === "all" && referenceCount + certificateCount > 0
                      ? `${filterCounts.all - referenceCount - certificateCount} + ${referenceCount + certificateCount} ref/cert`
                      : count}
                  </span>
                </button>
              );
            })}
            {referenceCount + certificateCount > 0 && (
              <span className="text-[10px]" style={{ color: "#6e7681" }}>
                (reachability buckets below are operation-only — references and certificates are never assigned one)
              </span>
            )}
          </div>

      {/* Exposure Filter Chips */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-widest" style={{ color: "#8b949e" }}>
          Filter Exposure:
        </span>
        {EXPOSURE_FILTER_OPTIONS.map((opt) => {
          const isActive = selectedExposureFilters.has(opt.value);
          const count = exposureFilterCounts[opt.value] ?? 0;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleToggleExposureFilter(opt.value)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
              style={
                isActive
                  ? { background: "#3b82f6", borderColor: "#3b82f6", color: "#ffffff" }
                  : { background: "transparent", borderColor: "#30363d", color: "#c9d1d9" }
              }
            >
              <span>{opt.label}</span>
              <span
                className="rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums"
                style={{ background: isActive ? "rgba(255,255,255,0.2)" : "#21262d", color: isActive ? "#ffffff" : "#8b949e" }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "#21262d", background: "#0d1117" }}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {["Algorithm / Asset", "Quantum Status", "Reachability", "Exposure", "Shelf-life (yrs)", "Blast Radius (days)"].map((h) => (
                <th key={h} className="border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wide" style={{ borderColor: "#21262d", color: "#6e7681" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleFindings.map((f, i) => {
              const blastDays = totalBlastRadiusDays(f);
              const selected = f.id === selectedId;
              const isInert = f.reachability === "inert";
              const isReference = f.findingType === "CRYPTO_REFERENCE";
              const isCertificate = f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE";
              const isCloudKey = f.findingType === "CLOUD_KEY_OPERATION";
              const isBinaryCrypto = f.findingType === "COMPILED_CRYPTO_ARTEFACT";
              return (
                <tr
                  key={f.id}
                  onClick={() => onSelect(f)}
                  className={`animate-row-in cursor-pointer border-b last:border-b-0 ${
                    selected ? "font-semibold" : "hover:bg-[#161b22] font-normal"
                  } ${isInert ? "opacity-60 hover:opacity-100 transition-opacity" : ""}`}
                  style={{
                    borderColor: "#21262d",
                    background: selected ? "#1d2d44" : "transparent",
                    animationDelay: `${Math.min(i * STAGGER_STEP_MS, MAX_STAGGER_MS)}ms`,
                  }}
                >
                  <td className="px-3 py-2 text-sm font-semibold text-white">
                    <span className="inline-flex items-center gap-2">
                      {displayName(f)}
                      {isReference && (
                        <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                          Reference
                        </span>
                      )}
                      {isCertificate && (
                        <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line">
                          Certificate
                        </span>
                      )}
                      {isCloudKey && (
                        <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-status-opaque text-white border border-line">
                          Cloud KMS
                        </span>
                      )}
                      {isBinaryCrypto && (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                            Compiled Binary
                          </span>
                          {f.binaryCrypto?.evidenceType && (
                            <span className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line capitalize">
                              {f.binaryCrypto.evidenceType.replace("_", " ")}
                            </span>
                          )}
                        </span>
                      )}
                      {f.container && (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-teal-950/80 text-teal-300 border border-teal-700/50">
                            Container
                          </span>
                          {f.container.layerDigest && (
                            <span className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-surface-2 text-ink-muted border border-line" title={f.container.layerDigest}>
                              {f.container.layerDigest.slice(0, 12)}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {/* A CRYPTO_REFERENCE (a string literal that merely
                        looks like an algorithm name, never passed to a
                        crypto call) has no real-world exploitability — it
                        never carries a quantum-status or reachability
                        badge on the same scale as a genuine operation. The
                        "Reference" tag above is its only status indicator.
                        A CERTIFICATE finding DOES keep a real quantum-status
                        badge (an RSA-2048 cert is genuinely broken-by-shor),
                        just no reachability badge (see next column). */}
                    {!isReference && <QuantumStatusBadge status={f.quantumStatus} />}
                  </td>
                  <td className="px-3 py-2">
                    {!isReference && !isCertificate && (
                      <ReachabilityBadge
                        reachability={f.reachability}
                        status={f.quantumStatus}
                        mixed={f.mixedReachability}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {!isReference && !isCertificate && (
                      <ExposureBadge exposure={f.exposureState} />
                    )}
                  </td>
                  <td className="px-3 py-2 font-heading text-xs font-semibold text-ink-secondary tabular-nums">
                    {f.longestShelfLifeYears !== undefined ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const entry = longestShelfLifeEntry(f);
                          if (entry) setShelfLifeModal({ assetName: f.name, entry });
                        }}
                        className="rounded-sm underline decoration-dotted underline-offset-2 hover:text-ink hover:decoration-solid transition-colors"
                        aria-label={`Show shelf-life calculation for ${f.name}`}
                      >
                        {f.longestShelfLifeYears}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 font-heading text-xs font-semibold text-ink-secondary tabular-nums">
                    {blastDays !== undefined ? `${blastDays}d` : "—"}
                  </td>
                </tr>
              );
            })}
            {visibleFindings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center space-y-1">
                  <p className="font-heading text-base font-medium text-ink">No cryptographic findings match filter</p>
                  <p className="font-sans text-sm text-ink-muted leading-relaxed">
                    No findings in the current scan match the selected reachability/exposure criteria. Try selecting "All" or a different filter.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {shelfLifeModal && (
        <ShelfLifeModal
          assetName={shelfLifeModal.assetName}
          entry={shelfLifeModal.entry}
          onClose={() => setShelfLifeModal(undefined)}
        />
      )}
        </div>
      )}
    </div>
  );
}
