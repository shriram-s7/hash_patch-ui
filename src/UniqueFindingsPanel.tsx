import { useState, useMemo } from "react";
import {
  displayName,
  type Finding,
} from "./cbom/types";
import { QuantumStatusBadge } from "./badges/QuantumStatusBadge";
import { ReachabilityBadge } from "./badges/ReachabilityBadge";
import { ExposureBadge } from "./badges/ExposureBadge";
import { getRecommendationForFinding, type PqcRecommendation } from "./pqcRecommendations";
import {
  X,
  ChevronDown,
  ChevronUp,
  FileCode,
  ExternalLink,
  Copy,
  Check,
  Search,
  Wrench,
  Shield,
  Layers,
  ArrowRight,
} from "lucide-react";

export interface UniqueFindingGroup {
  key: string;
  name: string;
  displayName: string;
  quantumStatus: Finding["quantumStatus"];
  category: string;
  findings: Finding[];
  count: number;
  hasCertificate: boolean;
  hasReference: boolean;
  hasCodeAsset: boolean;
  hasCloudKey: boolean;
  hasBinaryCrypto: boolean;
  recommendation: PqcRecommendation;
  longestShelfLifeYears?: number;
}

export function groupUniqueFindings(findings: Finding[]): UniqueFindingGroup[] {
  const groupsMap = new Map<string, Finding[]>();

  for (const f of findings) {
    const nameKey = displayName(f);
    const list = groupsMap.get(nameKey) ?? [];
    list.push(f);
    groupsMap.set(nameKey, list);
  }

  const result: UniqueFindingGroup[] = [];
  for (const [nameKey, groupFindings] of groupsMap.entries()) {
    const primaryFinding =
      groupFindings.find(
        (f) =>
          f.findingType !== "CRYPTO_REFERENCE" &&
          f.findingType !== "CERTIFICATE" &&
          f.findingType !== "CERTIFICATE_UNPARSEABLE",
      ) ?? groupFindings[0];

    let quantumStatus: Finding["quantumStatus"] = primaryFinding.quantumStatus;
    if (groupFindings.some((f) => f.quantumStatus === "broken-by-shor")) {
      quantumStatus = "broken-by-shor";
    } else if (groupFindings.some((f) => f.quantumStatus === "weakened-by-grover")) {
      quantumStatus = "weakened-by-grover";
    } else if (groupFindings.some((f) => f.quantumStatus === "broken-classically")) {
      quantumStatus = "broken-classically";
    } else if (groupFindings.some((f) => f.quantumStatus === "quantum-safe")) {
      quantumStatus = "quantum-safe";
    }

    const rec = getRecommendationForFinding(primaryFinding);

    let maxShelfLife: number | undefined = undefined;
    for (const f of groupFindings) {
      if (f.longestShelfLifeYears !== undefined) {
        if (maxShelfLife === undefined || f.longestShelfLifeYears > maxShelfLife) {
          maxShelfLife = f.longestShelfLifeYears;
        }
      }
    }

    result.push({
      key: nameKey,
      name: primaryFinding.name,
      displayName: nameKey,
      quantumStatus,
      category: primaryFinding.primitive ?? "Cryptographic Asset",
      findings: groupFindings,
      count: groupFindings.length,
      hasCertificate: groupFindings.some(
        (f) => f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE",
      ),
      hasReference: groupFindings.some((f) => f.findingType === "CRYPTO_REFERENCE"),
      hasCodeAsset: groupFindings.some((f) => !f.findingType || f.findingType === "OPERATION"),
      hasCloudKey: groupFindings.some((f) => f.findingType === "CLOUD_KEY_OPERATION"),
      hasBinaryCrypto: groupFindings.some((f) => f.findingType === "COMPILED_CRYPTO_ARTEFACT"),
      recommendation: rec,
      longestShelfLifeYears: maxShelfLife,
    });
  }

  return result.sort((a, b) => {
    const statusOrder = (s?: string) => {
      if (s === "broken-by-shor") return 0;
      if (s === "weakened-by-grover") return 1;
      if (s === "broken-classically") return 2;
      if (s === "quantum-safe") return 3;
      return 4;
    };
    const orderDiff = statusOrder(a.quantumStatus) - statusOrder(b.quantumStatus);
    if (orderDiff !== 0) return orderDiff;
    return b.count - a.count;
  });
}

function copyToClipboard(text: string, cb?: () => void) {
  navigator.clipboard.writeText(text).then(
    () => cb?.(),
    () => {},
  );
}

export function UniqueFindingDetailPanel({
  group,
  onClose,
  onSelectFinding,
}: {
  group: UniqueFindingGroup;
  onClose: () => void;
  onSelectFinding?: (finding: Finding) => void;
}) {
  const [dropdownExpanded, setDropdownExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState<string | null>(null);
  const [activeModalFinding, setActiveModalFinding] = useState<Finding | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  const top5 = group.findings.slice(0, 5);
  const remaining = group.findings.slice(5);

  const filteredRemaining = useMemo(() => {
    if (!searchQuery.trim()) return remaining;
    const q = searchQuery.toLowerCase();
    return remaining.filter((f) => {
      const loc = f.evidence[0]?.locator ?? "";
      const line = f.evidence[0]?.line ?? "";
      return loc.toLowerCase().includes(q) || String(line).includes(q);
    });
  }, [remaining, searchQuery]);

  // Handle jump via dropdown select
  const handleSelectJump = (findingId: string) => {
    if (!findingId) return;
    setSelectedOccurrenceId(findingId);
    // Find the element and scroll to it if in view
    const el = document.getElementById(`occ-card-${findingId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  const selectedFindingObj = useMemo(() => {
    if (!selectedOccurrenceId) return null;
    return group.findings.find((f) => f.id === selectedOccurrenceId) ?? null;
  }, [group.findings, selectedOccurrenceId]);

  return (
    <div
      className="flex h-full min-h-0 flex-col animate-drawer-in overflow-hidden border-l"
      style={{ background: "#161b22", borderColor: "#21262d" }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: "#21262d", background: "#0d1117" }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Layers className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-bold text-white">{group.displayName}</h2>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold text-white shadow-sm" style={{ background: "#3b82f6" }}>
                {group.count} {group.count === 1 ? "finding" : "findings"}
              </span>
            </div>
            <div className="text-[11px] text-[#8b949e] mt-0.5 truncate">
              Unique Algorithm Group • {group.category}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-[#8b949e] hover:bg-[#21262d] hover:text-white transition-colors"
          title="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Main scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        {/* Migration & Algorithm Summary Card */}
        <div className="rounded-xl border p-3.5 space-y-3" style={{ background: "#0d1117", borderColor: "#21262d" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b949e]">Quantum Assessment</span>
            </div>
            <QuantumStatusBadge status={group.quantumStatus} />
          </div>

          <div className="rounded-lg border p-3 space-y-1.5 text-xs" style={{ background: "#161b22", borderColor: "#30363d" }}>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-medium text-[#8b949e]">Replace:</span>
              <span className="font-semibold text-rose-400">{group.displayName}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-medium text-[#8b949e]">With (PQC):</span>
              <span className="font-bold text-emerald-400 flex items-center gap-1">
                {group.recommendation.recommendedAlgorithm}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] font-medium text-[#8b949e]">Standard:</span>
              <span className="font-mono text-[11px] text-blue-400">{group.recommendation.standard}</span>
            </div>
            {group.longestShelfLifeYears !== undefined && (
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-[11px] font-medium text-[#8b949e]">Shelf-Life:</span>
                <span className="font-semibold text-[#f0f6fc]">{group.longestShelfLifeYears} years</span>
              </div>
            )}
          </div>

          <p className="text-xs leading-relaxed text-[#c9d1d9]">
            {group.recommendation.vulnerabilityReason}
          </p>
        </div>

        {/* Quick jump dropdown selector */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#8b949e] flex items-center justify-between">
            <span>Jump to Occurrence</span>
            <span className="text-[10px] text-blue-400">Dropdown select</span>
          </label>
          <select
            value={selectedOccurrenceId ?? ""}
            onChange={(e) => handleSelectJump(e.target.value)}
            className="w-full rounded-lg border bg-[#0d1117] px-3 py-2 text-xs text-white focus:outline-none focus:border-[#3b82f6]"
            style={{ borderColor: "#30363d" }}
          >
            <option value="" style={{ color: "#8b949e", background: "#161b22" }}>
              -- Select occurrence (1 of {group.count}) --
            </option>
            {group.findings.map((f, idx) => {
              const loc = f.evidence[0]?.locator ?? f.name;
              const line = f.evidence[0]?.line !== undefined ? `:${f.evidence[0].line}` : "";
              const type = f.findingType === "CERTIFICATE" ? "[Cert]" : f.findingType === "CRYPTO_REFERENCE" ? "[Ref]" : "";
              return (
                <option key={f.id} value={f.id} style={{ color: "#fff", background: "#161b22" }}>
                  #{idx + 1} {loc}{line} {type}
                </option>
              );
            })}
          </select>
        </div>

        {/* Selected occurrence detail preview box (if picked from dropdown) */}
        {selectedFindingObj && (
          <div className="rounded-xl border p-3.5 space-y-2 border-blue-500/50 bg-blue-950/20">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">
                Selected Occurrence #{group.findings.findIndex((f) => f.id === selectedFindingObj.id) + 1}
              </span>
              <button
                type="button"
                onClick={() => setSelectedOccurrenceId(null)}
                className="text-[10px] text-[#8b949e] hover:text-white"
              >
                Clear
              </button>
            </div>
            <div className="font-mono text-xs text-white truncate" title={selectedFindingObj.evidence[0]?.locator}>
              {selectedFindingObj.evidence[0]?.locator ?? "Unknown location"}:{selectedFindingObj.evidence[0]?.line ?? "1"}
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <ReachabilityBadge reachability={selectedFindingObj.reachability} status={selectedFindingObj.quantumStatus} mixed={selectedFindingObj.mixedReachability} />
              <ExposureBadge exposure={selectedFindingObj.exposureState} />
            </div>
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setActiveModalFinding(selectedFindingObj)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View Full Analysis
              </button>
              {onSelectFinding && (
                <button
                  type="button"
                  onClick={() => onSelectFinding(selectedFindingObj)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium text-[#c9d1d9] hover:bg-white/5"
                  style={{ borderColor: "#30363d" }}
                >
                  Inspect in Detail
                </button>
              )}
            </div>
          </div>
        )}

        {/* Top 5 Findings List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b949e]">
              Top Findings ({Math.min(5, group.count)} of {group.count})
            </span>
            {group.count > 5 && (
              <span className="text-[10px] text-[#8b949e]">
                {group.count - 5} more below
              </span>
            )}
          </div>

          <div className="space-y-2">
            {top5.map((f, idx) => {
              const occ = f.evidence[0];
              const isSelected = selectedOccurrenceId === f.id;
              const isCert = f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE";
              const isRef = f.findingType === "CRYPTO_REFERENCE";

              return (
                <div
                  key={f.id}
                  id={`occ-card-${f.id}`}
                  className={`rounded-xl border p-3 transition-all ${
                    isSelected ? "border-blue-500 bg-blue-950/20" : "hover:border-[#3b82f6]/50 bg-[#0d1117]"
                  }`}
                  style={{ borderColor: isSelected ? "#3b82f6" : "#21262d" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#21262d] text-[10px] font-mono font-bold text-[#8b949e]">
                        #{idx + 1}
                      </span>
                      <FileCode className="h-3.5 w-3.5 shrink-0 text-[#8b949e]" />
                      <span className="font-mono text-xs font-semibold text-white truncate" title={occ?.locator}>
                        {occ?.locator ? occ.locator.split(/[/\\]/).pop() : f.name}
                      </span>
                      {occ?.line !== undefined && (
                        <span className="font-mono text-[11px] text-[#8b949e] shrink-0">
                          :{occ.line}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveModalFinding(f)}
                      className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      <span>Analysis</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>

                  {occ?.locator && (
                    <p className="mt-1 text-[11px] font-mono text-[#8b949e] truncate" title={occ.locator}>
                      {occ.locator}
                    </p>
                  )}

                  {/* Badges row */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {isCert && (
                      <span className="rounded bg-amber-950/80 border border-amber-700/50 px-1.5 py-0.5 text-[10px] font-mono uppercase font-semibold text-amber-300">
                        Certificate
                      </span>
                    )}
                    {isRef && (
                      <span className="rounded bg-surface-2 border border-line px-1.5 py-0.5 text-[10px] font-mono uppercase font-semibold text-ink-muted">
                        Reference
                      </span>
                    )}
                    {!isCert && !isRef && (
                      <>
                        <ReachabilityBadge reachability={f.reachability} status={f.quantumStatus} mixed={f.mixedReachability} />
                        <ExposureBadge exposure={f.exposureState} />
                      </>
                    )}
                  </div>

                  {/* Snippet preview if present */}
                  {occ?.snippet && (
                    <pre className="mt-2 overflow-x-auto whitespace-pre rounded-md bg-[#161b22] p-2 font-mono text-[10px] text-[#c9d1d9] border border-[#21262d]">
                      {occ.snippet}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Dropdown / Expandable list for all remaining findings */}
        {group.count > 5 ? (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#21262d", background: "#0d1117" }}>
            <button
              type="button"
              onClick={() => setDropdownExpanded((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">
                  {dropdownExpanded ? "Hide All Occurrences" : `Show All ${group.count} Occurrences (Dropdown)`}
                </span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-[#21262d] text-blue-400 border border-[#30363d]">
                  +{group.count - 5} more
                </span>
              </div>
              {dropdownExpanded ? (
                <ChevronUp className="h-4 w-4 text-[#8b949e]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[#8b949e]" />
              )}
            </button>

            {dropdownExpanded && (
              <div className="border-t p-3 space-y-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
                {/* Search filter for instances */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#8b949e]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter occurrences by path or line..."
                    className="w-full rounded-lg border bg-[#0d1117] pl-8 pr-3 py-1.5 text-xs text-white placeholder-[#6e7681] focus:outline-none focus:border-[#3b82f6]"
                    style={{ borderColor: "#30363d" }}
                  />
                </div>

                {/* Scrollable list of remaining occurrences */}
                <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1">
                  {filteredRemaining.length === 0 ? (
                    <div className="py-4 text-center text-xs text-[#8b949e]">
                      No occurrences match "{searchQuery}"
                    </div>
                  ) : (
                    filteredRemaining.map((f, i) => {
                      const occ = f.evidence[0];
                      const idx = i + 5;
                      const isSelected = selectedOccurrenceId === f.id;
                      const isCert = f.findingType === "CERTIFICATE" || f.findingType === "CERTIFICATE_UNPARSEABLE";

                      return (
                        <div
                          key={f.id}
                          id={`occ-card-${f.id}`}
                          className={`rounded-lg border p-2.5 transition-all ${
                            isSelected ? "border-blue-500 bg-blue-950/20" : "hover:border-[#30363d] bg-[#0d1117]"
                          }`}
                          style={{ borderColor: isSelected ? "#3b82f6" : "#21262d" }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-[10px] text-[#8b949e] shrink-0 font-bold">
                                #{idx + 1}
                              </span>
                              <span className="font-mono text-xs font-semibold text-white truncate" title={occ?.locator}>
                                {occ?.locator ? occ.locator.split(/[/\\]/).pop() : f.name}
                              </span>
                              {occ?.line !== undefined && (
                                <span className="font-mono text-[11px] text-[#8b949e] shrink-0">
                                  :{occ.line}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setActiveModalFinding(f)}
                              className="text-[10px] font-semibold text-emerald-400 hover:underline shrink-0"
                            >
                              Analysis →
                            </button>
                          </div>

                          {occ?.locator && (
                            <p className="mt-0.5 text-[10px] font-mono text-[#8b949e] truncate" title={occ.locator}>
                              {occ.locator}
                            </p>
                          )}

                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {isCert ? (
                              <span className="rounded bg-amber-950/80 border border-amber-700/50 px-1.5 py-0.5 text-[9px] font-mono uppercase font-semibold text-amber-300">
                                Certificate
                              </span>
                            ) : (
                              <>
                                <ReachabilityBadge reachability={f.reachability} status={f.quantumStatus} mixed={f.mixedReachability} />
                                <ExposureBadge exposure={f.exposureState} />
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border px-3 py-2 text-center text-xs text-[#8b949e]" style={{ borderColor: "#21262d", background: "#0d1117" }}>
            All {group.count} occurrences of this algorithm are displayed above.
          </div>
        )}
      </div>

      {/* Analysis Modal for any occurrence clicked */}
      {activeModalFinding && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(6px)" }}
          onClick={() => setActiveModalFinding(null)}
        >
          <div
            className="relative flex flex-col rounded-2xl shadow-2xl overflow-hidden"
            style={{
              background: "#0d1117",
              border: "1px solid rgba(59,130,246,0.4)",
              width: "min(780px, 96vw)",
              maxHeight: "88vh",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <div className="flex items-center gap-3 min-w-0">
                <QuantumStatusBadge status={activeModalFinding.quantumStatus} />
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-white">
                    {displayName(activeModalFinding)} Analysis
                  </h3>
                  <p className="font-mono text-xs text-[#8b949e] truncate">
                    {activeModalFinding.evidence[0]?.locator ?? "Finding occurrence"}
                    {activeModalFinding.evidence[0]?.line !== undefined ? `:${activeModalFinding.evidence[0].line}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalFinding(null)}
                className="rounded-lg p-1.5 text-[#8b949e] hover:bg-[#21262d] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {(() => {
                const rec = getRecommendationForFinding(
                  activeModalFinding,
                  activeModalFinding.evidence[0]?.snippet ?? "",
                );
                return (
                  <>
                    <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "#21262d", background: "#161b22" }}>
                      <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[#8b949e] text-[11px]">
                        <Wrench className="h-3.5 w-3.5 text-blue-400" />
                        PQC Migration Guidance
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex gap-2">
                          <span className="w-24 text-[#8b949e]">Vulnerable:</span>
                          <span className="font-semibold text-rose-400">{displayName(activeModalFinding)}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="w-24 text-[#8b949e]">Target:</span>
                          <span className="font-bold text-emerald-400">{rec.recommendedAlgorithm}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="w-24 text-[#8b949e]">Standard:</span>
                          <span className="font-mono text-blue-400">{rec.standard}</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="w-24 text-[#8b949e]">Why:</span>
                          <span className="text-[#c9d1d9]">{rec.vulnerabilityReason}</span>
                        </div>
                      </div>
                    </div>

                    {rec.replacementCode && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#8b949e]">
                          <span>Suggested Replacement Code</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(rec.replacementCode, () => {
                              setCopiedText(true);
                              setTimeout(() => setCopiedText(false), 1500);
                            })}
                            className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                          >
                            {copiedText ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedText ? "Copied!" : "Copy Code"}
                          </button>
                        </div>
                        <pre className="overflow-x-auto whitespace-pre rounded-xl border p-4 font-mono text-[11px] text-[#c9d1d9]" style={{ borderColor: "#21262d", background: "#161b22" }}>
                          {rec.replacementCode}
                        </pre>
                      </div>
                    )}

                    {activeModalFinding.evidence[0]?.snippet && (
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[#8b949e]">
                          Detected Code Excerpt
                        </span>
                        <pre className="overflow-x-auto whitespace-pre rounded-xl border p-4 font-mono text-[11px] text-[#c9d1d9]" style={{ borderColor: "#21262d", background: "#161b22" }}>
                          {activeModalFinding.evidence[0].snippet}
                        </pre>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="flex shrink-0 items-center justify-end border-t px-6 py-3" style={{ borderColor: "#21262d", background: "#161b22" }}>
              <button
                type="button"
                onClick={() => setActiveModalFinding(null)}
                className="rounded-lg bg-[#21262d] px-4 py-2 text-xs font-semibold text-white hover:bg-[#30363d] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
