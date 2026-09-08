import { useMemo, useState } from "react";
import { displayName, type Finding, type Reachability, type ExposureState, type ShelfLifeEntry } from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { compareFindingsPriority } from "./priority";
import { ShelfLifeModal } from "./ShelfLifeModal";

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

interface FilterOption {
  value: FilterValue;
  label: string;
}

interface ExposureFilterOption {
  value: ExposureFilterValue;
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

export function FindingsTable({
  findings,
  selectedId,
  onSelect,
}: {
  findings: Finding[];
  selectedId: string | undefined;
  onSelect: (finding: Finding) => void;
}) {
  // Reachability filter state: Set of selected filters. Defaults to ["all"]
  const [selectedFilters, setSelectedFilters] = useState<Set<FilterValue>>(new Set(["all"]));
  // Exposure filter state: Set of selected filters. Defaults to ["all"]
  const [selectedExposureFilters, setSelectedExposureFilters] = useState<Set<ExposureFilterValue>>(new Set(["all"]));
  const [shelfLifeModal, setShelfLifeModal] = useState<{ assetName: string; entry: ShelfLifeEntry } | undefined>(
    undefined
  );

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

  return (
    <div className="space-y-3">
      {/* Reachability Filter Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted mr-1">
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
              className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-heading text-xs transition-colors ${
                isActive
                  ? "border border-ink bg-surface-2 font-semibold text-ink shadow-xs"
                  : "border border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
              }`}
            >
              <span>{opt.label}</span>
              <span className="rounded-full bg-page/60 px-1.5 py-0.2 font-mono text-[10px] text-ink-muted tabular-nums">
                {opt.value === "all" && referenceCount + certificateCount > 0
                  ? `${filterCounts.all - referenceCount - certificateCount} + ${referenceCount + certificateCount} ref/cert`
                  : count}
              </span>
            </button>
          );
        })}
        {referenceCount + certificateCount > 0 && (
          <span className="font-mono text-[10px] text-ink-muted">
            (reachability buckets below are operation-only — references and certificates are never assigned one)
          </span>
        )}
      </div>

      {/* Exposure Filter Chips */}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        <span className="font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted mr-1">
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
              className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 font-heading text-xs transition-colors ${
                isActive
                  ? "border border-ink bg-surface-2 font-semibold text-ink shadow-xs"
                  : "border border-line bg-surface text-ink-secondary hover:border-line-strong hover:text-ink"
              }`}
            >
              <span>{opt.label}</span>
              <span className="rounded-full bg-page/60 px-1.5 py-0.2 font-mono text-[10px] text-ink-muted tabular-nums">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-sm border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/40">
              <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                Algorithm / Asset
              </th>
              <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                Quantum Status
              </th>
              <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                Reachability
              </th>
              <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                Exposure
              </th>
              <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                Shelf-life (yrs)
              </th>
              <th className="px-3 py-2 font-heading text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                Blast Radius (days)
              </th>
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
                  className={`animate-row-in cursor-pointer border-b border-line last:border-b-0 ${
                    selected ? "bg-surface-2 font-semibold" : "hover:bg-surface-2/60 font-normal"
                  } ${isInert ? "opacity-60 hover:opacity-100 transition-opacity" : ""}`}
                  style={{ animationDelay: `${Math.min(i * STAGGER_STEP_MS, MAX_STAGGER_MS)}ms` }}
                >
                  <td className="px-3 py-2 font-heading text-sm font-semibold text-ink">
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
  );
}
