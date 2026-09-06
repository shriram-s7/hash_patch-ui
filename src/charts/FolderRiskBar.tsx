import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { useThemeColors } from "../useThemeColors";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface FolderData {
  path: string;
  shor: number;
  classic: number;
  grover: number;
  safe: number;
}

interface FolderRiskBarProps {
  folders: FolderData[];
}

/** Truncate folder path from the left, keeping the meaningful tail. */
function truncateLeft(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  return "…" + path.slice(path.length - maxLen + 1);
}

export function FolderRiskBar({ folders }: FolderRiskBarProps) {
  const colors = useThemeColors();
  const top10 = folders
    .map((f) => ({ ...f, total: f.shor + f.classic + f.grover + f.safe }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  if (top10.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-ink-muted">
        No folder data available.
      </div>
    );
  }

  const labels = top10.map((f) => truncateLeft(f.path, 30));

  const data = {
    labels,
    datasets: [
      {
        label: "Broken by Shor",
        data: top10.map((f) => f.shor),
        backgroundColor: colors["--status-critical"],
      },
      {
        label: "Broken classically",
        data: top10.map((f) => f.classic),
        backgroundColor: colors["--status-neutral-fg"],
      },
      {
        label: "Weakened by Grover",
        data: top10.map((f) => f.grover),
        backgroundColor: colors["--status-warning"],
      },
      {
        label: "Quantum-safe",
        data: top10.map((f) => f.safe),
        backgroundColor: colors["--status-good"],
      },
    ],
  };

  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true,
        ticks: { color: colors["--ink-muted"], font: { size: 10, family: "JetBrains Mono, monospace" } },
        grid: { color: colors["--line"] },
      },
      y: {
        stacked: true,
        ticks: { color: colors["--ink-muted"], font: { size: 10, family: "JetBrains Mono, monospace" } },
        grid: { display: false },
      },
    },
    plugins: {
      legend: {
        labels: {
          color: colors["--ink-muted"],
          font: { size: 10, family: "Space Grotesk, sans-serif" },
          boxWidth: 10,
          boxHeight: 10,
          padding: 8,
        },
      },
      tooltip: {
        backgroundColor: colors["--surface"],
        titleColor: colors["--ink"],
        bodyColor: colors["--ink"],
        borderColor: colors["--line"],
        borderWidth: 1,
      },
    },
  };

  const barHeight = Math.max(200, top10.length * 32 + 60);

  return (
    <div style={{ height: `${barHeight}px` }}>
      <Bar data={data} options={options} />
    </div>
  );
}
