export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFitAll,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
}) {
  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-1 z-10">
      <button
        type="button"
        onClick={onZoomIn}
        title="Zoom in"
        className="w-8 h-8 rounded-lg bg-[#161b22] border border-[#21262d] text-[#f0f6fc] hover:bg-[#21262d] flex items-center justify-center font-bold"
      >
        +
      </button>
      <button
        type="button"
        onClick={onZoomOut}
        title="Zoom out"
        className="w-8 h-8 rounded-lg bg-[#161b22] border border-[#21262d] text-[#f0f6fc] hover:bg-[#21262d] flex items-center justify-center font-bold"
      >
        −
      </button>
      <button
        type="button"
        onClick={onFitAll}
        title="Fit all"
        className="w-8 h-8 rounded-lg bg-[#161b22] border border-[#21262d] text-[#f0f6fc] hover:bg-[#21262d] flex items-center justify-center text-xs"
      >
        ⊡
      </button>
    </div>
  );
}
