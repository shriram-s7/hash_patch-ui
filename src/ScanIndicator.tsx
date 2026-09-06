export function ScanIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-xs text-ink-muted">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-ink animate-signal-pulse" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-ink" />
      </span>
      <span className="uppercase tracking-wider">{label}</span>
    </div>
  );
}
