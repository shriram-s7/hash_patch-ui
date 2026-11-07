import { FEATURE_GUIDED_UI } from "./flags";

export type ClipboardWriteResult =
  | { ok: true; text: string }
  | { ok: false; error: unknown };

type Listener = (result: ClipboardWriteResult) => void;

let pendingListener: Listener | null = null;
let listenerTimeout: ReturnType<typeof setTimeout> | null = null;
let isInitialized = false;

/** Truncates a string by keeping the beginning and end, inserting '…' in the middle. */
export function middleEllipsis(str: string, maxLen = 52): string {
  if (str.length <= maxLen) return str;
  const charsToShow = maxLen - 1; // 1 char for '…'
  const frontChars = Math.ceil(charsToShow / 2);
  const backChars = Math.floor(charsToShow / 2);
  return str.slice(0, frontChars) + "…" + str.slice(str.length - backChars);
}

/** Formats a preview of the copied content:
 * - Multi-line summary: first line + "+N more lines", middle-ellipsised to ~52 chars
 * - Single-line / URL: middle-ellipsised to ~52 chars
 */
export function formatCopiedPreview(val: string): string {
  if (!val) return "";
  const lines = val.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const extra = lines.length - 1;
    const suffix = ` (+${extra} more line${extra > 1 ? "s" : ""})`;
    const targetLen = Math.max(10, 52 - suffix.length);
    const firstLinePreview = middleEllipsis(lines[0], targetLen);
    return `${firstLinePreview}${suffix}`;
  }
  return middleEllipsis(lines[0] || val.trim(), 52);
}

/** Subscribe to the outcome of the very next clipboard write.
 * Automatically clears after 3 seconds if no write occurs. */
export function listenForNextClipboardWrite(cb: Listener): void {
  if (!FEATURE_GUIDED_UI) return;
  pendingListener = cb;
  if (listenerTimeout) clearTimeout(listenerTimeout);
  listenerTimeout = setTimeout(() => {
    if (pendingListener === cb) {
      pendingListener = null;
    }
  }, 3000);
}

/** Wraps navigator.clipboard.writeText non-intrusively to notify pending listeners.
 * The original promise, return value, and exceptions are 100% preserved. */
export function initClipboardSubscriber(): void {
  if (!FEATURE_GUIDED_UI || isInitialized || typeof window === "undefined" || !navigator?.clipboard) {
    return;
  }
  isInitialized = true;
  const originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
  if (!originalWriteText) return;

  navigator.clipboard.writeText = async function (text: string): Promise<void> {
    const cb = pendingListener;
    pendingListener = null;
    try {
      const res = await originalWriteText(text);
      if (cb) {
        cb({ ok: true, text });
      }
      return res;
    } catch (err) {
      if (cb) {
        cb({ ok: false, error: err });
      }
      throw err;
    }
  };
}
