import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  computePosition,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  arrow,
  type Placement,
  type Side,
} from "@floating-ui/dom";
import "./tour.css";
import { DUR_BASE, EASE_OUT, PULSE_DURATION_MS } from "./motionTokens";
import { useReducedMotion } from "./useReducedMotion";
import { isTourEnabled, useTourStoreState } from "./store";

/** Any of floating-ui's 12 placements ("bottom", "bottom-end", "left-start",
 * ...) -- the "-start"/"-end" suffix is what lets a panel anchored to a
 * top-right control grow toward the window instead of off the edge of it. */
export type CoachmarkPlacement = Placement;

export interface CoachmarkProps {
  id: string;
  anchorRef: RefObject<HTMLElement | null>;
  placement: CoachmarkPlacement;
  title: string;
  body: string;
  onNext?: () => void;
  onSkip?: () => void;
  step?: [number, number];
  variant?: "tip" | "step";
  /** Override the primary/dismiss button text (defaults: "Next"/"Done" and
   * "Skip tour") for a one-off tip whose action isn't "advance a sequence". */
  nextLabel?: string;
  skipLabel?: string;
}

const EDGE_PADDING = 16;
const MIN_WIDTH = 240;
const MAX_WIDTH = 360;
// How far the anchor's centre may fall outside the floating box's own span
// before the tail is hidden rather than drawn pointing at nothing.
const ARROW_HIDE_SLACK = 40;

interface FloatingResult {
  left: number;
  top: number;
  side: Side;
}

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ArrowResult {
  hidden: boolean;
  x?: number;
  y?: number;
}

export function Coachmark({
  id,
  anchorRef,
  placement,
  title,
  body,
  onNext,
  onSkip,
  step,
  variant: _variant = "step",
  nextLabel,
  skipLabel = "Skip tour",
}: CoachmarkProps) {
  const tourState = useTourStoreState();
  const reducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const skippedNullAnchor = useRef(false);

  const [floating, setFloating] = useState<FloatingResult | null>(null);
  const [arrowResult, setArrowResult] = useState<ArrowResult>({ hidden: true });
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const [ready, setReady] = useState(false);

  const enabled = isTourEnabled(tourState);

  // Anchor missing (view not mounted / conditionally hidden) -- silently
  // advance past this step instead of rendering floating in a corner.
  useEffect(() => {
    if (!enabled) return;
    if (anchorRef.current) {
      skippedNullAnchor.current = false;
      return;
    }
    if (skippedNullAnchor.current) return;
    skippedNullAnchor.current = true;
    onNext?.();
  }, [enabled, anchorRef, onNext]);

  useLayoutEffect(() => {
    if (!enabled || !anchorRef.current || !cardRef.current) {
      setReady(false);
      return;
    }
    const anchorEl = anchorRef.current;
    const floatingEl = cardRef.current;

    anchorEl.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });

    const cleanup = autoUpdate(anchorEl, floatingEl, () => {
      computePosition(anchorEl, floatingEl, {
        placement,
        strategy: "fixed",
        middleware: [
          offset(12),
          flip({ fallbackPlacements: ["bottom-end", "left-start", "top-end", "bottom"] }),
          shift({ padding: EDGE_PADDING }),
          size({
            padding: EDGE_PADDING,
            apply({ availableWidth, availableHeight, elements }) {
              Object.assign(elements.floating.style, {
                maxWidth: `${Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, availableWidth - EDGE_PADDING))}px`,
                maxHeight: `${Math.max(0, availableHeight - EDGE_PADDING)}px`,
              });
            },
          }),
          arrowRef.current ? arrow({ element: arrowRef.current, padding: 12 }) : undefined,
        ].filter((m): m is NonNullable<typeof m> => Boolean(m)),
      }).then(({ x, y, placement: finalPlacement, middlewareData }) => {
        const side = finalPlacement.split("-")[0] as Side;

        // The tail is positioned INDEPENDENTLY of the panel -- computed from
        // the anchor's true centre relative to the panel's final box, not
        // just floating-ui's already-clamped arrow offset. If the anchor
        // centre doesn't even fall within (a slack margin of) the panel's
        // own span on the cross axis, a shift has moved the panel far
        // enough that a tail would point at nothing -- hide it instead.
        const currentAnchorRect = anchorEl.getBoundingClientRect();
        const floatingWidth = floatingEl.offsetWidth;
        const floatingHeight = floatingEl.offsetHeight;
        const arrowData = middlewareData.arrow;

        let hidden = true;
        let ax: number | undefined;
        let ay: number | undefined;
        if (arrowData) {
          if (side === "top" || side === "bottom") {
            const anchorCenterX = currentAnchorRect.left + currentAnchorRect.width / 2;
            hidden = anchorCenterX < x - ARROW_HIDE_SLACK || anchorCenterX > x + floatingWidth + ARROW_HIDE_SLACK;
            ax = arrowData.x;
          } else {
            const anchorCenterY = currentAnchorRect.top + currentAnchorRect.height / 2;
            hidden = anchorCenterY < y - ARROW_HIDE_SLACK || anchorCenterY > y + floatingHeight + ARROW_HIDE_SLACK;
            ay = arrowData.y;
          }
        }

        setAnchorRect({
          top: currentAnchorRect.top,
          left: currentAnchorRect.left,
          width: currentAnchorRect.width,
          height: currentAnchorRect.height,
        });
        setFloating({ left: x, top: y, side });
        setArrowResult({ hidden, x: ax, y: ay });
        setReady(true);
      });
    });

    return () => {
      cleanup();
      setReady(false);
      setAnchorRect(null);
    };
  }, [enabled, anchorRef, placement, reducedMotion]);

  const previouslyFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled || !ready) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      try {
        anchorRef.current?.focus();
      } catch {
        // anchor may not be focusable -- harmless no-op
      }
    };
  }, [enabled, ready, anchorRef]);

  const endAndSkip = () => {
    onSkip?.();
  };

  useEffect(() => {
    if (!enabled || !ready) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") endAndSkip();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready]);

  if (!enabled) return null;

  const [stepN, stepTotal] = step ?? [];
  const side = floating?.side ?? "bottom";

  return createPortal(
    <>
      <div className="tour-scrim" onMouseDown={endAndSkip} />
      {anchorRect && (
        <div
          className={`tour-ring ${reducedMotion ? "" : "tour-ring--pulse"}`}
          style={{
            top: anchorRect.top - 4,
            left: anchorRect.left - 4,
            width: anchorRect.width + 8,
            height: anchorRect.height + 8,
            borderRadius: anchorRect.width <= 16 ? 9999 : 8,
            animationDuration: reducedMotion ? undefined : `${PULSE_DURATION_MS}ms`,
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-live="polite"
        aria-label={title}
        tabIndex={-1}
        data-tour-id={id}
        className="tour-coachmark rounded-xl border p-4 shadow-2xl outline-none"
        style={{
          left: floating?.left ?? 0,
          top: floating?.top ?? 0,
          width: MAX_WIDTH,
          visibility: ready ? "visible" : "hidden",
          background: "var(--surface, #161b22)",
          borderColor: "var(--line-strong, #30363d)",
          transition: reducedMotion || !ready ? undefined : `opacity ${DUR_BASE}ms ${EASE_OUT}, transform ${DUR_BASE}ms ${EASE_OUT}`,
          pointerEvents: "auto",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          ref={arrowRef}
          className={`tour-coachmark-arrow tour-coachmark-arrow--${side}`}
          style={{
            display: arrowResult.hidden ? "none" : undefined,
            left: arrowResult.x !== undefined ? arrowResult.x : undefined,
            top: arrowResult.y !== undefined ? arrowResult.y : undefined,
          }}
        />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold" style={{ color: "var(--ink, #e7ecf3)" }}>
              {title}
            </h3>
          </div>
          {stepTotal === undefined && (
            <button
              type="button"
              onClick={endAndSkip}
              className="shrink-0 text-xs font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--ink-muted, #6b7d94)" }}
            >
              {skipLabel}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--ink-secondary, #93a1b5)" }}>
          {body}
        </p>
        {stepTotal !== undefined ? (
          <div
            className="mt-3.5 flex items-center justify-between border-t pt-2.5"
            style={{ borderColor: "rgba(255,255,255,0.08)" }}
          >
            <div className="text-[11px] font-medium" style={{ color: "var(--ink-muted, #8b949e)" }}>
              {stepN !== undefined ? `Step ${stepN} of ${stepTotal}` : ""}
            </div>
            <div className="flex items-center gap-2">
              {Boolean(skipLabel) && (
                <button
                  type="button"
                  onClick={endAndSkip}
                  className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5"
                  style={{ borderColor: "#30363d", color: "#8b949e" }}
                >
                  {skipLabel}
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  className="rounded-md px-3 py-1 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98]"
                  style={{
                    background:
                      nextLabel === "Open"
                        ? "linear-gradient(135deg, #16a34a 0%, #15803d 100%)"
                        : "#2563eb",
                    boxShadow:
                      nextLabel === "Open"
                        ? "0 1px 6px rgba(22,163,74,0.35)"
                        : "0 1px 6px rgba(37,99,235,0.35)",
                  }}
                >
                  {nextLabel ?? (stepN === stepTotal ? "Done" : "Next →")}
                </button>
              )}
            </div>
          </div>
        ) : (
          onNext && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={onNext}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98]"
                style={{ background: "#2563eb", boxShadow: "0 1px 6px rgba(37,99,235,0.35)" }}
              >
                {nextLabel ?? "Next"}
              </button>
            </div>
          )
        )}
      </div>
    </>,
    document.body,
  );
}
