import { useEffect } from "react";
import { FEATURE_GUIDED_UI } from "./flags";
import { tourStore } from "./store";
import { ToastContainer } from "./Toast";

/** Demo re-arm: Ctrl+Shift+T resets every completed tour step and shows a
 * toast confirming it. Mounted once, as a sibling of <App/> in main.tsx --
 * no existing app file's handlers are touched. This is the only
 * window-level keydown listener in the app; if a shared shortcut registry
 * is ever added, this should move into it. */
export function TourHotkey() {
  useEffect(() => {
    if (!FEATURE_GUIDED_UI) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "T" || e.key === "t")) {
        e.preventDefault();
        tourStore.resetAll();
        tourStore.showToast({
          type: "success",
          title: "Guided tour reset",
          detail: "All discovery steps re-armed",
          durationMs: 2000,
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!FEATURE_GUIDED_UI) return null;

  return <ToastContainer />;
}
