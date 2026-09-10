import { useState, useEffect } from "react";
import { getScanHistory, clearScanHistory, type ScanHistoryEntry } from "./scanHistory";

interface ScanHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadScan: (target: string) => void;
}

export function ScanHistoryModal({ isOpen, onClose, onLoadScan }: ScanHistoryModalProps) {
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);

  useEffect(() => {
    if (isOpen) {
      setScanHistory(getScanHistory());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const clearHistory = () => {
    clearScanHistory();
    setScanHistory([]);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-20"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1117] border border-[#21262d] rounded-xl w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#21262d]">
          <h3 className="font-bold text-[#f0f6fc]">Scan History</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-[#161b22] flex items-center justify-center text-[#8b949e] hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
          {scanHistory.length === 0 ? (
            <p className="text-sm text-[#8b949e] text-center py-8">No scan history yet. Run a scan to see it here.</p>
          ) : (
            scanHistory.map((entry, i) => (
              <div
                key={`${entry.target}-${entry.timestamp}-${i}`}
                className="flex items-center justify-between p-3 rounded-lg bg-[#161b22] border border-[#21262d] hover:border-[#3b82f6]/40 cursor-pointer transition-colors"
                onClick={() => {
                  onClose();
                  onLoadScan(entry.target);
                }}
              >
                <div className="min-w-0 flex-1 mr-3">
                  <p className="text-sm font-medium text-[#f0f6fc] truncate">{entry.target}</p>
                  <p className="text-xs text-[#8b949e]">{new Date(entry.timestamp).toLocaleString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-bold text-[#ef4444]">{entry.findingCount} findings</span>
                </div>
              </div>
            ))
          )}
        </div>
        {scanHistory.length > 0 && (
          <div className="p-4 border-t border-[#21262d] flex justify-end">
            <button type="button" onClick={clearHistory} className="text-xs text-[#ef4444] hover:underline">
              Clear history
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
