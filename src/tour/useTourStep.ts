import { useEffect, useRef, type RefObject } from "react";
import { isTourEnabled, tourStore, useTourStoreState } from "./store";

/** What each view calls, one line per anchor:
 *
 *   const showScanStep = useTourStep("scan", scanButtonRef);
 *   {showScanStep && <Coachmark id="scan" anchorRef={scanButtonRef} ... onNext={() => tourStore.nextStep()} onSkip={() => tourStore.endTour()} />}
 *
 * Returns true only while `id` is the current step of the active tour,
 * the flag/user-setting both allow it, and this step hasn't already been
 * completed. Silently advances past an id that's already been seen so a
 * remounted view never re-shows a step the user already dismissed. */
export function useTourStep(id: string, _anchorRef?: RefObject<HTMLElement | null>): boolean {
  const state = useTourStoreState();
  const enabled = isTourEnabled(state);
  const currentId = tourStore.currentStepId();
  const alreadySeen = state.completedSteps.has(id);
  const isCurrent = currentId === id;

  const skippedSeen = useRef(false);
  useEffect(() => {
    if (enabled && isCurrent && alreadySeen && !skippedSeen.current) {
      skippedSeen.current = true;
      tourStore.nextStep();
    }
    if (!isCurrent) skippedSeen.current = false;
  }, [enabled, isCurrent, alreadySeen]);

  return enabled && isCurrent && !alreadySeen;
}
