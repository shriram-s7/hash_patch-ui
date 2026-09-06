import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { useThemeColors, quantumStatusColor } from "../useThemeColors";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface FileData {
  path: string;
  score: number;
  worstStatus: string;
}

interface FilePriorityBarProps {
  files: FileData[];
}

/** Truncate file path from the left, keeping the meaningful tail. */
function truncateLeft(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  return "…" + path.slice(path.length - maxLen + 1);
}

export function FilePriorityBar({ files }: FilePriorityBarProps) {
  const colors = useThemeColors();
  const top10 = [...files].sort((a, b) => b.score - a.score).slice(0, 10);

  if (top10.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-ink-muted">
        No file-level priority data available.
      </div>
    );
  }

  const labels = top10.map((f) => truncateLeft(f.path, 35));

  const data = {
    labels,
    datasets: [
      {
        label: "Priority Score",
        data: top10.map((f) => f.score),
        backgroundColor: top10.map((f) => quantumStatusColor(colors, f.worstStatus)),
        borderWidth: 0,
      },
    ],
  };

  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: colors["--ink-muted"], font: { size: 10, family: "JetBrains Mono, monospace" } },
        grid: { color: colors["--line"] },
      },
      y: {
        ticks: { color: colors["--ink-muted"], font: { size: 10, family: "JetBrains Mono, monospace" } },
        grid: { display: false },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: colors["--surface"],
        titleColor: colors["--ink"],
        bodyColor: colors["--ink"],
        borderColor: colors["--line"],
        borderWidth: 1,
      },
    },
  };

  const barHeight = Math.max(200, top10.length * 32 + 40);

  return (
    <div style={{ height: `${barHeight}px` }}>
      <Bar data={data} options={options} />
    </div>
  );
}
