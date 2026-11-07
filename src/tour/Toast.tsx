import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Clipboard, AlertCircle, X } from "lucide-react";
import { FEATURE_GUIDED_UI } from "./flags";
import { tourStore, useTourStoreState, type ToastState } from "./store";
import { useReducedMotion } from "./useReducedMotion";
import "./tour.css";

interface ToastProps {
  toast: ToastState;
  onDismiss: () => void;
}

function ToastItem({ toast, onDismiss }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const isReduced = useReducedMotion();
  const exitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isError = toast.type === "error";

  const triggerExit = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    if (isReduced) {
      onDismiss();
    } else {
      exitTimeoutRef.current = setTimeout(() => {
        onDismiss();
      }, 180); // DUR_FAST
    }
  }, [isExiting, isReduced, onDismiss]);

  useEffect(() => {
    return () => {
      if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);
    };
  }, []);

  // For reduced-motion environments where CSS animationend won't fire:
  useEffect(() => {
    if (isReduced && !isError && toast.durationMs) {
      const timer = setTimeout(() => {
        triggerExit();
      }, toast.durationMs);
      return () => clearTimeout(timer);
    }
  }, [isReduced, isError, toast.durationMs, triggerExit]);

  const handleDrainEnd = () => {
    triggerExit();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`toast-box relative flex max-w-md items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-2.5 shadow-2xl transition-colors pointer-events-auto ${
        isExiting ? "toast-box-exit" : "toast-box-enter"
      }`}
      style={{
        background: isError ? "rgba(30, 20, 25, 0.96)" : "var(--surface, #161b22)",
        borderColor: isError ? "rgba(239, 68, 68, 0.4)" : "var(--line-strong, #30363d)",
        boxShadow: "0 12px 32px -4px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05)",
      }}
    >
      {/* Icon */}
      <div className="flex shrink-0 items-center justify-center">
        {isError ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" strokeWidth={2} aria-hidden="true" />
        ) : (
          <Clipboard className="h-4 w-4 shrink-0 text-emerald-400" strokeWidth={2} aria-hidden="true" />
        )}
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col justify-center pr-1">
        <div className="text-[13px] font-semibold text-white leading-tight">
          {toast.title}
        </div>
        <div
          className="text-[12px] truncate leading-tight mt-0.5"
          style={{ color: isError ? "rgba(252, 165, 165, 0.85)" : "var(--ink-muted, #8b949e)" }}
          title={toast.detail}
        >
          {toast.detail}
        </div>
      </div>

      {/* Dismiss Control */}
      <button
        type="button"
        onClick={triggerExit}
        className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      {/* Draining bar: flush along bottom edge, drains to the right (dismiss side) over 2000ms */}
      {!isError && (
        <div
          className="toast-drain-bar absolute bottom-0 left-0 right-0 h-[2px]"
          style={{
            background: "#10b981", // emerald success green
          }}
          onAnimationEnd={handleDrainEnd}
        />
      )}
    </div>
  );
}

export function ToastContainer() {
  const state = useTourStoreState();
  const toast = state.toast;

  if (!FEATURE_GUIDED_UI || !toast) return null;

  return createPortal(
    <div
      className="fixed top-6 left-1/2 -translate-x-1/2 z-[70] flex flex-col items-center pointer-events-none"
      style={{ minWidth: 320 }}
    >
      <ToastItem
        key={toast.id}
        toast={toast}
        onDismiss={() => tourStore.dismissToast()}
      />
    </div>,
    document.body
  );
}
