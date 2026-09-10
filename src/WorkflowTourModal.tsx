export const workflowSteps = [
  {
    id: "scan",
    icon: "📁",
    iconBg: "bg-[#1d2d44]",
    numBg: "bg-[#3b82f6]",
    title: "Select Codebase",
    desc: "Point Hash Patch at any local folder. Nothing is uploaded.",
    actions: ["Browse folder", "Enter path", "Quick targets"],
  },
  {
    id: "detect",
    icon: "🔍",
    iconBg: "bg-[#1a0808]",
    numBg: "bg-[#ef4444]",
    title: "Detect",
    desc: "AST parsing finds every crypto call across Python, Java, Go, C.",
    actions: ["31 algorithms", "OPERATION vs REFERENCE"],
  },
  {
    id: "analyse",
    icon: "📊",
    iconBg: "bg-[#1a1200]",
    numBg: "bg-[#f59e0b]",
    title: "Analyse",
    desc: "Six pillars classify risk, reachability, shelf life, and blast radius.",
    actions: ["Quantum status", "Reachability", "Shelf life"],
  },
  {
    id: "visualise",
    icon: "🔗",
    iconBg: "bg-[#0d1a2e]",
    numBg: "bg-[#6366f1]",
    title: "Visualise",
    desc: "See how findings relate. Cluster or tree layout.",
    actions: ["Relationships graph", "Blast radius rings"],
  },
  {
    id: "plan",
    icon: "🗓",
    iconBg: "bg-[#0d2b1a]",
    numBg: "bg-[#22c55e]",
    title: "Plan Migration",
    desc: "Greedy optimizer sequences fixes by risk density within your budget.",
    actions: ["Timeline scrubber", "Budget control"],
  },
  {
    id: "report",
    icon: "📋",
    iconBg: "bg-[#1d2d44]",
    numBg: "bg-[#8b5cf6]",
    title: "Report",
    desc: "Export a full PDF or share an interactive readiness assessment.",
    actions: ["Export PDF", "Share report"],
  },
];

export const pillars = [
  { icon: "📡", name: "Reachability", desc: "Is this finding actually reachable from an entry point?" },
  { icon: "⏳", name: "Shelf Life", desc: "How long must this data stay secret? Mosca's inequality." },
  { icon: "💥", name: "Blast Radius", desc: "Which buffers overflow when you migrate to PQC?" },
  { icon: "⚡", name: "Contradictions", desc: "Config says one thing. Code does another." },
  { icon: "🗓", name: "Migration Optimizer", desc: "Greedy risk-density scheduler for your budget." },
  { icon: "🔏", name: "PQC Signing", desc: "Sign your CBOM with ML-DSA-65 (FIPS 204)." },
];

interface WorkflowTourModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkflowTourModal({ isOpen, onClose }: WorkflowTourModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1117] border border-[#21262d] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#21262d]">
          <div>
            <h2 className="text-xl font-bold text-[#f0f6fc]">How Hash Patch Works</h2>
            <p className="text-sm text-[#8b949e] mt-1">Your complete workflow from scan to quantum-safe codebase</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-[#161b22] hover:bg-[#21262d] flex items-center justify-center text-[#8b949e] hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Workflow chart — horizontal flow with arrows */}
        <div className="p-8">
          <div className="flex items-start gap-0 overflow-x-auto pb-4">
            {workflowSteps.map((step, i) => (
              <div key={step.id} className="flex items-start flex-shrink-0">
                {/* Step card */}
                <div className="flex flex-col items-center w-40">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-3 ${step.iconBg}`}>
                    {step.icon}
                  </div>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white mb-2 ${step.numBg}`}>
                    {i + 1}
                  </div>
                  <p className="text-sm font-bold text-[#f0f6fc] text-center">{step.title}</p>
                  <p className="text-xs text-[#8b949e] text-center mt-1">{step.desc}</p>
                  {/* Sub-actions */}
                  {step.actions && (
                    <div className="mt-3 space-y-1 w-full">
                      {step.actions.map((a) => (
                        <div key={a} className="text-xs text-[#3b82f6] bg-[#0d1a2e] rounded px-2 py-1 text-center">
                          {a}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Arrow between steps */}
                {i < workflowSteps.length - 1 && (
                  <div className="flex items-center mt-7 mx-2 flex-shrink-0">
                    <div className="w-8 h-0.5 bg-[#3b82f6]" />
                    <div className="w-0 h-0 border-t-4 border-b-4 border-l-8 border-transparent border-l-[#3b82f6]" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pillar breakdown below the flow */}
          <div className="mt-8 border-t border-[#21262d] pt-6">
            <p className="text-xs text-[#8b949e] uppercase tracking-wide mb-4">Six Analysis Pillars</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {pillars.map((p) => (
                <div key={p.name} className="flex items-start gap-3 p-3 rounded-xl bg-[#161b22] border border-[#21262d]">
                  <span className="text-lg flex-shrink-0">{p.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-[#f0f6fc]">{p.name}</p>
                    <p className="text-xs text-[#8b949e]">{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
