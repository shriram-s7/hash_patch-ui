/** Base URL of the local Hash Patch analysis engine (hash_patch/service.py,
 * `hash-patch serve`). Shared by every component that talks to it, so the
 * port only ever needs to change in one place.
 *
 * Two environments:
 *   - Browser/dev: the Vite dev server runs on a random port range and the
 *     engine listens on http://localhost:8000, so that stays the hardcoded
 *     fallback below.
 *   - Electron desktop: the main process picks a free localhost port, spawns
 *     the bundled engine on it, and injects the real URL through the preload
 *     script (window.hashPatchApi.backendUrl). When present, that wins. */
declare global {
  interface Window {
    hashPatchApi?: {
      backendUrl?: string;
      productVersion?: string;
      platform?: string;
      isPackaged?: boolean;
      /** Snapshot of the bundled local AI runtime provisioning state. */
      getOllamaState?: () => Promise<OllamaProvisionState>;
      /** Subscribe to bundled AI runtime progress. Returns unsubscribe. */
      onOllamaProgress?: (cb: (state: OllamaProvisionState) => void) => () => void;
    };
  }
}

/** Mirrors the state object the Electron main process pushes for the bundled
 * local AI runtime (see desktop/electron/main.js). `stage` values:
 *   disabled  — browser/dev mode, no bundled runtime
 *   starting  — launching the bundled Ollama server
 *   downloading — model download in progress (percent may be null mid-layer)
 *   verifying — verifying/download-finished, finishing model setup
 *   ready     — model cached & available (percent 100)
 *   error     — setup failed; Q&A falls back to verified scan evidence */
export interface OllamaProvisionState {
  stage: "disabled" | "starting" | "downloading" | "verifying" | "warming" | "importing" | "ready" | "error";
  percent: number | null;
  message?: string;
}

export const SERVICE_BASE_URL =
  typeof window !== "undefined" && window.hashPatchApi?.backendUrl
    ? window.hashPatchApi.backendUrl
    : "http://localhost:8000";