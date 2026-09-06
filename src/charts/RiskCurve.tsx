import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { useThemeColors } from "../useThemeColors";
import type { RiskCurvePoint } from "../plan/types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface RiskCurveProps {
  optimizerCurve: RiskCurvePoint[] | undefined;
  naiveCurve: RiskCurvePoint[] | undefined;
}

export function RiskCurve({ optimizerCurve, naiveCurve }: RiskCurveProps) {
  const colors = useThemeColors();

  const hasData =
    optimizerCurve !== undefined &&
    optimizerCurve.length > 0 &&
    naiveCurve !== undefined &&
    naiveCurve.length > 0;

  if (!hasData) {
    return (
      <div className="rounded-sm border border-line bg-surface p-6 space-y-1.5">
        <p className="font-heading text-base font-medium text-ink">Risk curve comparison unavailable</p>
        <p className="font-sans text-sm text-ink-muted leading-relaxed">
          No migration plan has been loaded for the current scan. Click <strong className="font-heading text-ink font-semibold">Load reference plan</strong> in the Migration view or upload an optimizer JSON file to compare the risk-density reduction against a naive baseline.
        </p>
      </div>
    );
  }

  // Merge all unique day values and sort
  const allDays = Array.from(
    new Set([...optimizerCurve.map((p) => p.day), ...naiveCurve.map((p) => p.day)]),
  ).sort((a, b) => a - b);

  const labels = allDays.map((d) => d.toString());

  // Build lookup maps for quick access
  const optMap = new Map(optimizerCurve.map((p) => [p.day, p.risk]));
  const naiveMap = new Map(naiveCurve.map((p) => [p.day, p.risk]));

  // Interpolate missing points with last-known value
  function interpolate(dayList: number[], lookup: Map<number, number>): number[] {
    let lastVal = lookup.values().next().value ?? 0;
    return dayList.map((d) => {
      const v = lookup.get(d);
      if (v !== undefined) {
        lastVal = v;
        return v;
      }
      return lastVal;
    });
  }

  const data = {
    labels,
    datasets: [
      {
        label: "Optimizer plan",
        data: interpolate(allDays, optMap),
        borderColor: colors["--status-good"],
        backgroundColor: colors["--status-good"] + "22",
        fill: false,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: "Naive baseline",
        data: interpolate(allDays, naiveMap),
        borderColor: colors["--status-critical"],
        backgroundColor: colors["--status-critical"] + "22",
        fill: false,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
        borderDash: [6, 3],
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        title: {
          display: true,
          text: "Migration days",
          color: colors["--ink-muted"],
          font: { size: 11, family: "Space Grotesk, sans-serif" },
        },
        ticks: { color: colors["--ink-muted"], font: { size: 10, family: "JetBrains Mono, monospace" }, maxTicksLimit: 12 },
        grid: { color: colors["--line"] },
      },
      y: {
        title: {
          display: true,
          text: "Residual risk",
          color: colors["--ink-muted"],
          font: { size: 11, family: "Space Grotesk, sans-serif" },
        },
        ticks: { color: colors["--ink-muted"], font: { size: 10, family: "JetBrains Mono, monospace" } },
        grid: { color: colors["--line"] },
        beginAtZero: true,
      },
    },
    plugins: {
      legend: {
        labels: {
          color: colors["--ink-muted"],
          font: { size: 11, family: "Space Grotesk, sans-serif" },
          boxWidth: 16,
          boxHeight: 2,
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
    <div style={{ height: "280px" }}>
      <Line data={data} options={options} />
    </div>
  );
}
