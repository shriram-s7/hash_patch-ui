import { Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { useThemeColors } from "../useThemeColors";

ChartJS.register(ArcElement, Tooltip, Legend);

interface DonutChartProps {
  counts: { shor: number; classic: number; grover: number; safe: number };
}

export function DonutChart({ counts }: DonutChartProps) {
  const colors = useThemeColors();
  const total = counts.shor + counts.classic + counts.grover + counts.safe;

  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-ink-muted">
        No findings to chart.
      </div>
    );
  }

  const segments = [
    { label: "Broken by Shor", value: counts.shor, color: colors["--status-critical"] },
    { label: "Broken classically", value: counts.classic, color: colors["--status-neutral-fg"] },
    { label: "Weakened by Grover", value: counts.grover, color: colors["--status-warning"] },
    { label: "Quantum-safe", value: counts.safe, color: colors["--status-good"] },
  ].filter((s) => s.value > 0);

  const data = {
    labels: segments.map((s) => {
      const pct = ((s.value / total) * 100).toFixed(0);
      return `${s.label}: ${s.value} (${pct}%)`;
    }),
    datasets: [
      {
        data: segments.map((s) => s.value),
        backgroundColor: segments.map((s) => s.color),
        borderColor: "transparent",
        borderWidth: 0,
        hoverBorderWidth: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "55%",
    plugins: {
      legend: {
        position: "right" as const,
        labels: {
          color: colors["--ink-muted"],
          font: { size: 11, family: "Space Grotesk, sans-serif" },
          boxWidth: 12,
          boxHeight: 12,
          padding: 10,
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

  return (
    <div style={{ height: "260px" }}>
      <Doughnut data={data} options={options} />
    </div>
  );
}
