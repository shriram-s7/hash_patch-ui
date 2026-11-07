/** Shared motion constants for the guided-discovery system. Every tour
 * primitive uses these -- no ad-hoc durations anywhere in src/tour. */
export const DUR_FAST = 180;
export const DUR_BASE = 260;
export const DUR_RISE = 420;

export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
export const EASE_IN = "cubic-bezier(0.55, 0, 1, 0.45)";

/** The focus ring pulses exactly twice at 900ms each, then holds static
 * (animation-fill-mode: forwards) -- it must never loop. */
export const PULSE_ITERATIONS = 2;
export const PULSE_DURATION_MS = 900;
