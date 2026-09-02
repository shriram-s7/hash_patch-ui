import { useEffect, useState } from "react";
import { ScanIndicator } from "./ScanIndicator";

const SNIPPET_LEN = 300;

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Flips one digit (or, failing that, one letter) somewhere in the first
 * portion of the text — a real, visible, reproducible single-character
 * mutation of the actual loaded content, not a cosmetic-only change. */
function flipOneCharacter(text: string): { text: string; index: number } {
  const chars = [...text];
  let idx = chars.findIndex((c, i) => i >= 80 && /[0-9]/.test(c));
  if (idx === -1) idx = chars.findIndex((c) => /[a-zA-Z0-9]/.test(c));
  if (idx === -1) return { text, index: -1 };
  const c = chars[idx];
  chars[idx] = /[0-9]/.test(c) ? String((Number(c) + 1) % 10) : c.toLowerCase() === "a" ? "b" : "a";
  return { text: chars.join(""), index: idx };
}

export function VerifyMode({ rawText, sourceName }: { rawText: string | undefined; sourceName: string }) {
  const [originalHash, setOriginalHash] = useState<string | undefined>(undefined);
  const [currentHash, setCurrentHash] = useState<string | undefined>(undefined);
  const [workingText, setWorkingText] = useState<string | undefined>(undefined);
  const [flippedIndex, setFlippedIndex] = useState<number | undefined>(undefined);
  const [computing, setComputing] = useState(false);

  // Recompute the stored/original hash whenever a new CBOM is loaded.
  useEffect(() => {
    if (rawText === undefined) return;
    setComputing(true);
    setWorkingText(undefined);
    setFlippedIndex(undefined);
    sha256Hex(rawText).then((hash) => {
      setOriginalHash(hash);
      setCurrentHash(hash);
      setComputing(false);
    });
  }, [rawText]);

  function handleTamper() {
    if (rawText === undefined) return;
    const source = workingText ?? rawText;
    const { text, index } = flipOneCharacter(source);
    setWorkingText(text);
    setFlippedIndex(index);
    setComputing(true);
    sha256Hex(text).then((hash) => {
      setCurrentHash(hash);
      setComputing(false);
    });
  }

  function handleReset() {
    if (rawText === undefined) return;
    setWorkingText(undefined);
    setFlippedIndex(undefined);
    setComputing(true);
    sha256Hex(rawText).then((hash) => {
      setCurrentHash(hash);
      setComputing(false);
    });
  }

  if (rawText === undefined) {
    return (
      <div className="rounded-sm border border-line bg-surface p-6 text-sm text-ink-muted">
        No CBOM loaded yet.
      </div>
    );
  }

  const displayText = workingText ?? rawText;
  const snippet = displayText.slice(0, SNIPPET_LEN);
  const isValid = currentHash !== undefined && originalHash !== undefined && currentHash === originalHash;
  const tampered = workingText !== undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-sm border border-line bg-surface p-4">
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          <span>Content hash — {sourceName}</span>
          {computing && <ScanIndicator label="Hashing" />}
        </div>
        <div
          key={currentHash}
          className="animate-hash-flash break-all rounded-sm px-1 py-0.5 font-mono text-sm text-ink"
        >
          {currentHash ?? "—"}
        </div>
        <p className="mt-2 text-[11px] text-ink-muted">
          Real SHA-256 of the loaded file's raw text, computed client-side via the Web Crypto API
          (<code className="font-mono">crypto.subtle.digest</code>).
        </p>
      </div>

      <div className="rounded-sm border border-line bg-surface p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            File content — first {SNIPPET_LEN} characters shown (hash covers the full file)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleTamper}
              className="rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink"
            >
              Simulate tamper
            </button>
            {tampered && (
              <button
                type="button"
                onClick={handleReset}
                className="rounded-sm border border-line px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-secondary hover:border-line-strong hover:text-ink"
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-page p-3 font-mono text-xs text-ink-secondary">
          {flippedIndex !== undefined && flippedIndex < SNIPPET_LEN ? (
            <>
              {snippet.slice(0, flippedIndex)}
              <span className="rounded-sm bg-status-critical/30 text-ink">{snippet[flippedIndex]}</span>
              {snippet.slice(flippedIndex + 1)}
            </>
          ) : (
            snippet
          )}
        </pre>
      </div>

      <div
        className={`rounded-sm border p-4 ${
          isValid ? "border-status-good bg-status-good/10" : "border-status-critical bg-status-critical/10"
        }`}
      >
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${isValid ? "bg-status-good" : "bg-status-critical"}`}
            aria-hidden="true"
          />
          <span
            className={`text-sm font-semibold uppercase tracking-wide ${
              isValid ? "text-status-good" : "text-status-critical"
            }`}
          >
            {isValid ? "Valid" : "Invalid"}
          </span>
        </div>
        <p className="text-sm text-ink-secondary">
          {isValid
            ? "Content hash matches the value captured when this CBOM was loaded."
            : "content hash does not match - file was modified after the stored hash was captured"}
        </p>
      </div>

      <p className="text-[11px] text-ink-muted">
        This is a client-side integrity-hash demonstration of the same tamper-detection principle the
        real backend implements with full ML-DSA-65 post-quantum signatures — it is not post-quantum
        signature verification itself, which requires the Python backend's cryptography library and
        cannot run in a browser.
      </p>
    </div>
  );
}
