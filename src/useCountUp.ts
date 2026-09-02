import { useEffect, useRef, useState } from "react";

const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

/** Animates from 0 to `target` over `durationMs` on every change to `target`. */
export function useCountUp(target: number, durationMs = 400): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const start = performance.now();
    const from = 0;

    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      setValue(from + (target - from) * EASE_OUT_CUBIC(t));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return Math.round(value);
}
