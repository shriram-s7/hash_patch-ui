/** Environment-branched target-directory selection for the entry screen.
 * Three real paths, never a single fake unified control:
 *
 * 1. Electron desktop build: a genuine native OS folder dialog
 *    (dialog.showOpenDialog in the main process -- see
 *    desktop/electron/main.js's 'dialog:pick-directory' handler --
 *    reached through window.hashPatchApi.pickDirectory, the same preload
 *    bridge every other main-process capability goes through).
 * 2. Chromium-based browsers (Chrome/Edge/Brave): the File System Access
 *    API's window.showDirectoryPicker() -- a real, user-permission-gated
 *    native folder browser. IMPORTANT, honestly documented limitation:
 *    browsers never expose the chosen folder's absolute OS path (a
 *    deliberate Web platform security boundary, not a bug or an
 *    oversight here) -- only a FileSystemDirectoryHandle with a leaf
 *    `.name`. Since Hash Patch's scan API takes a server-side path string
 *    hash_patch's own Python walks (POST /api/scan { path }), this picker
 *    can confirm WHICH folder the user means and pre-fill its name, but
 *    the user still has to complete/confirm the full path in the visible
 *    text input -- there is no way to paper over this with client-side
 *    JavaScript, so the UI says so rather than pretending otherwise.
 * 3. Everything else (Firefox/Safari, or permission denied): a plain,
 *    clearly-labeled manual path input -- already exactly what path #2
 *    degrades to for the actual scan trigger, so this is not really a
 *    "worse" fallback, just the same final step without the picker.
 */

export type FolderPickerMode = "electron" | "file-system-access" | "manual";

export function detectFolderPickerMode(): FolderPickerMode {
  if (typeof window !== "undefined" && typeof window.hashPatchApi?.pickDirectory === "function") {
    return "electron";
  }
  if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
    return "file-system-access";
  }
  return "manual";
}

/** Electron path: returns the chosen absolute path, or null if cancelled
 * or the bridge is unavailable. */
export async function pickDirectoryElectron(): Promise<string | null> {
  const pick = window.hashPatchApi?.pickDirectory;
  if (!pick) return null;
  try {
    return await pick();
  } catch {
    return null;
  }
}

/** File System Access API path: returns the picked directory's leaf name
 * (never a full path -- see this module's docstring), or null if the
 * user cancelled, the API isn't actually available at call time, or
 * permission was denied. */
export async function pickDirectoryBrowser(): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> })
    .showDirectoryPicker;
  if (!picker) return null;
  try {
    const handle = await picker();
    return handle.name;
  } catch {
    // AbortError (user cancelled) and any permission failure both resolve
    // to "nothing picked" -- the caller just leaves the manual input as-is.
    return null;
  }
}
