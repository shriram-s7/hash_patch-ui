import { useRef, useCallback } from 'react';

interface Props {
  onResize: (delta: number) => void;
  direction?: 'horizontal' | 'vertical';
}

export function ResizableDivider({ onResize, direction = 'horizontal' }: Props) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const pos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = pos - lastPos.current;
      lastPos.current = pos;
      onResize(delta);
    };

    const onMouseUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onResize, direction]);

  const isVertical = direction === 'vertical';

  return (
    <div
      onMouseDown={onMouseDown}
      className={
        isVertical
          ? "group flex-shrink-0 h-1 w-full bg-[#21262d] hover:bg-[#3b82f6] cursor-row-resize transition-colors duration-150 relative"
          : "group flex-shrink-0 w-1 bg-[#21262d] hover:bg-[#3b82f6] cursor-col-resize transition-colors duration-150 relative"
      }
      title="Drag to resize. Double-click to reset."
      onDoubleClick={() => onResize(0)}  // signal reset — parent handles it
    >
      {isVertical ? (
        <div className="absolute inset-x-0 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-row justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="h-0.5 w-3 bg-[#3b82f6] rounded-full" />
          <span className="h-0.5 w-3 bg-[#3b82f6] rounded-full" />
        </div>
      ) : (
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="w-0.5 h-3 bg-[#3b82f6] rounded-full" />
          <span className="w-0.5 h-3 bg-[#3b82f6] rounded-full" />
        </div>
      )}
    </div>
  );
}
