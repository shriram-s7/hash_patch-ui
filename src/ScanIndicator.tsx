export function ScanIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-accent animate-signal-pulse" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{label}</span>
    </div>
  );
}
