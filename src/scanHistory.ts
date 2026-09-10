export interface ScanHistoryEntry {
  target: string;
  timestamp: number;
  findingCount: number;
}

const SCAN_HISTORY_KEY = "hashpatch-scan-history";

export const getScanHistory = (): ScanHistoryEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(SCAN_HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
};

export const addToHistory = (entry: { target: string; timestamp: number; findingCount: number }) => {
  const history = getScanHistory();
  const updated = [entry, ...history.filter((h) => h.target !== entry.target || Math.abs(h.timestamp - entry.timestamp) > 1000)].slice(0, 20);
  try {
    localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
};

export const clearScanHistory = () => {
  try {
    localStorage.removeItem(SCAN_HISTORY_KEY);
  } catch {
    // ignore
  }
};
