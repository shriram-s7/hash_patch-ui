import { useSyncExternalStore } from "react";
import { FEATURE_GUIDED_UI } from "./flags";

/** Isolated tour store -- the ONE new state slice for the guided-discovery
 * system. Never touches any existing store, context, or persisted schema.
 * Persists to the same mechanism existing prefs already use (localStorage),
 * under its own key. */
const STORAGE_KEY = "hashpatch-tour-state";

export interface ScrubberSyncState {
  currentDay: number;
  totalDays: number;
  fixedCount: number;
  totalCandidates: number;
  optimizerPct: number;
}

export interface ToastState {
  id: number;
  type: "success" | "error";
  title: string;
  detail: string;
  durationMs?: number;
}

export interface TourState {
  completedSteps: Set<string>;
  activeTour: string | null;
  activeStepIndex: number;
  /** Ordered step ids for the currently running tour. Transient (not
   * persisted) -- a tour resumes fresh rather than mid-flight on reload. */
  activeStepIds: string[];
  /** Mirrors FEATURE_GUIDED_UI + the user's own on/off preference. The
   * effective flag is always `FEATURE_GUIDED_UI && state.enabled` --
   * see isTourEnabled() below. */
  enabled: boolean;
  scrubberSync?: ScrubberSyncState | null;
  toast?: ToastState | null;
  fixCardCollapsed?: boolean;
}

interface PersistedShape {
  completedSteps: string[];
  enabled: boolean;
}

function loadPersisted(): Pick<TourState, "completedSteps" | "enabled"> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completedSteps: new Set(), enabled: true };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return {
      completedSteps: new Set(Array.isArray(parsed.completedSteps) ? parsed.completedSteps : []),
      enabled: parsed.enabled !== false,
    };
  } catch {
    return { completedSteps: new Set(), enabled: true };
  }
}

function persist(state: TourState): void {
  try {
    const shape: PersistedShape = {
      completedSteps: Array.from(state.completedSteps),
      enabled: state.enabled,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    // storage unavailable (private mode, quota) -- tour state just stays in-memory
  }
}

const persisted = loadPersisted();
let state: TourState = {
  completedSteps: persisted.completedSteps,
  activeTour: null,
  activeStepIndex: 0,
  activeStepIds: [],
  enabled: persisted.enabled,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<TourState>, opts: { persist?: boolean } = {}): void {
  state = { ...state, ...patch };
  if (opts.persist) persist(state);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TourState {
  return state;
}

/** id of the step the running tour is currently on, or null if no tour
 * is active / the tour has no steps registered. */
function currentStepId(): string | null {
  if (!state.activeTour) return null;
  return state.activeStepIds[state.activeStepIndex] ?? null;
}

export const tourStore = {
  getSnapshot,
  subscribe,

  startTour(tourId: string, stepIds: string[] = []): void {
    setState({ activeTour: tourId, activeStepIds: stepIds, activeStepIndex: 0 });
  },

  nextStep(): void {
    const id = currentStepId();
    const nextIndex = state.activeStepIndex + 1;
    const patch: Partial<TourState> = id
      ? { completedSteps: new Set(state.completedSteps).add(id) }
      : {};
    if (nextIndex >= state.activeStepIds.length) {
      setState({ ...patch, activeTour: null, activeStepIds: [], activeStepIndex: 0 }, { persist: true });
    } else {
      setState({ ...patch, activeStepIndex: nextIndex }, { persist: Boolean(id) });
    }
  },

  prevStep(): void {
    setState({ activeStepIndex: Math.max(0, state.activeStepIndex - 1) });
  },

  endTour(): void {
    setState({ activeTour: null, activeStepIds: [], activeStepIndex: 0 });
  },

  handoffTour(nextTourId: string, nextStepIds: string[] = []): void {
    const id = currentStepId();
    const completed = new Set(state.completedSteps);
    if (id) completed.add(id);
    if (state.activeTour) completed.add(state.activeTour);
    setState({
      completedSteps: completed,
      activeTour: nextTourId,
      activeStepIds: nextStepIds,
      activeStepIndex: 0,
    }, { persist: true });
  },

  markSeen(id: string): void {
    if (state.completedSteps.has(id)) return;
    setState({ completedSteps: new Set(state.completedSteps).add(id) }, { persist: true });
  },

  hasSeen(id: string): boolean {
    return state.completedSteps.has(id);
  },

  resetAll(): void {
    setState({ completedSteps: new Set(), activeTour: null, activeStepIds: [], activeStepIndex: 0 }, { persist: true });
  },

  setEnabled(enabled: boolean): void {
    setState({ enabled }, { persist: true });
  },

  setScrubberSync(scrubberSync: ScrubberSyncState | null): void {
    setState({ scrubberSync });
  },

  showToast(toast: Omit<ToastState, "id">): void {
    setState({
      toast: {
        ...toast,
        id: Date.now(),
      },
    });
  },

  dismissToast(): void {
    setState({ toast: null });
  },

  setFixCardCollapsed(collapsed: boolean): void {
    setState({ fixCardCollapsed: collapsed });
  },

  currentStepId,
};

/** True only when the feature flag AND the user's own setting both allow
 * it -- this is the single check every tour primitive gates on. */
export function isTourEnabled(state: TourState): boolean {
  return FEATURE_GUIDED_UI && state.enabled;
}

export function useTourStoreState(): TourState {
  return useSyncExternalStore(tourStore.subscribe, tourStore.getSnapshot, tourStore.getSnapshot);
}
