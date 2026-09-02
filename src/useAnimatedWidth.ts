import { useCountUp } from "./useCountUp";

/** Animates a pixel width from 0 to `targetPx` — a thin semantic wrapper
 * around the same 0→target ease-out primitive used for metric-card
 * count-up, reused here for the Blast Radius bar growth. */
export function useAnimatedWidth(targetPx: number, durationMs = 700): number {
  return useCountUp(targetPx, durationMs);
}
