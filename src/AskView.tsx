import { useEffect, useRef, useState } from "react";
import { SERVICE_BASE_URL, type OllamaProvisionState } from "./serviceUrl";
import { MarkdownAnswerRenderer, type AnswerHighlight } from "./MarkdownAnswerRenderer";

interface ChatTurn {
  id: number;
  question: string;
  answer?: string;
  /** undefined while the request is in flight. */
  grounded?: boolean;
  category?: string;
  sources?: string[];
  highlights?: AnswerHighlight[];
  error?: string;
}

interface AskResponse {
  answer: string;
  grounded: boolean;
  category: string;
  matched_findings: string[];
  sources?: string[];
  scan_id?: string;
  highlights?: AnswerHighlight[];
}

export interface AskViewProps {
  rawCbomText: string | undefined;
  scanId?: string;
  plan?: unknown;
}

function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface SavedAskSession {
  scanKey: string;
  conversationId: string;
  turns: ChatTurn[];
  nextId: number;
  input: string;
}

const STORAGE_PREFIX = "hash_patch_ask_session_";
const memorySessionStore = new Map<string, SavedAskSession>();

function getScanStorageKey(scanId?: string, rawCbomText?: string): string {
  if (scanId && scanId.trim()) return `scan_${scanId.trim()}`;
  if (rawCbomText && rawCbomText.trim()) {
    let hash = 0;
    const len = Math.min(rawCbomText.length, 1000);
    for (let i = 0; i < len; i++) {
      hash = ((hash << 5) - hash) + rawCbomText.charCodeAt(i);
      hash |= 0;
    }
    return `cbom_${hash}_${rawCbomText.length}`;
  }
  return "unloaded";
}

function loadSavedSession(scanKey: string): SavedAskSession | null {
  if (memorySessionStore.has(scanKey)) {
    return memorySessionStore.get(scanKey)!;
  }
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${scanKey}`);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedAskSession;
      if (parsed && Array.isArray(parsed.turns) && typeof parsed.conversationId === "string") {
        memorySessionStore.set(scanKey, parsed);
        return parsed;
      }
    }
  } catch {
    // sessionStorage might be restricted or throw in certain environments
  }
  return null;
}

function saveSavedSession(session: SavedAskSession) {
  memorySessionStore.set(session.scanKey, session);
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${session.scanKey}`, JSON.stringify(session));
  } catch {
    // ignore quota / access errors
  }
}

/** A narrow "ask about this scan" panel — not a general chatbot. Every
 * answer comes from POST /api/ask (hash_patch/service.py).
 *
 * Normal operation sends a scan-scoped request ({ scan_id, question, conversation_id })
 * without transmitting the complete CBOM JSON over the wire on every question.
 *
 * An automatic fallback path ({ scan_id, cbom, question, conversation_id }) is used
 * if the backend restarts or if an uploaded CBOM has not yet been registered.
 */
export function AskView({ rawCbomText, scanId, plan }: AskViewProps) {
  const currentScanKey = getScanStorageKey(scanId, rawCbomText);
  const initialSession = loadSavedSession(currentScanKey);

  const [turns, setTurns] = useState<ChatTurn[]>(() => initialSession?.turns ?? []);
  const [input, setInput] = useState<string>(() => initialSession?.input ?? "");
  const [pending, setPending] = useState(false);
  const [aiStatus, setAiStatus] = useState<"checking" | "ready" | "missing-model" | "unavailable">("checking");
  const [aiSetup, setAiSetup] = useState<OllamaProvisionState | null>(null);
  const [hasQueriedLlm, setHasQueriedLlm] = useState(false);
  const nextId = useRef<number>(
    initialSession?.nextId ??
      (initialSession?.turns && initialSession.turns.length > 0
        ? Math.max(...initialSession.turns.map((t) => t.id)) + 1
        : 0)
  );
  const conversationIdRef = useRef<string>(initialSession?.conversationId ?? generateConversationId());
  const lastScanKeyRef = useRef<string>(currentScanKey);

  // Sync state to memory and sessionStorage whenever turns, input, or nextId updates
  useEffect(() => {
    saveSavedSession({
      scanKey: currentScanKey,
      conversationId: conversationIdRef.current,
      turns,
      nextId: nextId.current,
      input,
    });
  }, [currentScanKey, turns, input]);

  // Bundled local AI runtime provisioning (desktop only). The Electron main
  // process pushes stage/progress as it starts the bundled Ollama and, on
  // first launch, downloads llama3.2:3b into the per-user cache. Poll the
  // backend's /api/ollama-status independently (below) for the authoritative
  // ask-availability state; this channel only adds the in-flight progress UI.
  useEffect(() => {
    let active = true;
    window.hashPatchApi?.getOllamaState?.().then((s) => {
      if (active) setAiSetup(s);
    });
    const off = window.hashPatchApi?.onOllamaProgress?.((s) => {
      if (active) setAiSetup(s);
    });
    return () => {
      active = false;
      off?.();
    };
  }, []);

  // Ollama availability, surfaced as a non-blocking status line. The Ask API
  // itself degrades gracefully whenever the local model is unreachable, so
  // this is purely informational — it must never prevent the panel from working.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${SERVICE_BASE_URL}/api/ollama-status`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as {
          available?: boolean;
          model_available?: boolean;
          model?: string;
        };
        if (cancelled) return;
        if (data.available && data.model_available) setAiStatus("ready");
        else if (data.available) setAiStatus("missing-model");
        else setAiStatus("unavailable");
      } catch {
        if (!cancelled) setAiStatus("unavailable");
      }
    };
    void check();
    const interval = setInterval(() => void check(), 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // When a new scan loads (scanId or rawCbomText changes), load that scan's
  // saved session if one exists or initialize a clean one, isolating context.
  useEffect(() => {
    if (currentScanKey !== lastScanKeyRef.current) {
      lastScanKeyRef.current = currentScanKey;
      const loaded = loadSavedSession(currentScanKey);
      if (loaded) {
        setTurns(loaded.turns);
        setInput(loaded.input);
        conversationIdRef.current = loaded.conversationId;
        nextId.current = loaded.nextId;
      } else {
        const newConvId = generateConversationId();
        conversationIdRef.current = newConvId;
        nextId.current = 0;
        setTurns([]);
        setInput("");
        saveSavedSession({
          scanKey: currentScanKey,
          conversationId: newConvId,
          turns: [],
          nextId: 0,
          input: "",
        });
      }
    }
  }, [currentScanKey]);

  const canAsk = (scanId !== undefined || rawCbomText !== undefined) && input.trim().length > 0 && !pending;

  async function handleAsk() {
    const question = input.trim();
    if (!question || (scanId === undefined && rawCbomText === undefined)) return;

    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question }]);
    setInput("");
    setPending(true);

    const convId = conversationIdRef.current;

    // Normal scan-scoped payload: sends ONLY scan_id, question, and conversation_id.
    // The complete CBOM is NOT transmitted on normal questions.
    let payload: Record<string, unknown>;
    if (scanId) {
      payload = {
        scan_id: scanId,
        question,
        conversation_id: convId,
      };
    } else {
      // Fallback if scanId was not available in CBOM metadata:
      try {
        const parsed = JSON.parse(rawCbomText || "{}");
        payload = {
          cbom: parsed,
          question,
          conversation_id: convId,
        };
        if (plan) {
          payload.plan = plan;
        }
      } catch {
        setTurns((prev) =>
          prev.map((t) => (t.id === id ? { ...t, error: "Could not read the current scan's CBOM data." } : t))
        );
        setPending(false);
        return;
      }
    }

    try {
      let res = await fetch(`${SERVICE_BASE_URL}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Fallback on 404: if the backend restarted or the scan is an uploaded CBOM
      // not yet indexed in memory, retry once with the CBOM included alongside scan_id.
      if (res.status === 404 && scanId && rawCbomText) {
        try {
          const parsedCbom = JSON.parse(rawCbomText);
          const fallbackPayload: Record<string, unknown> = {
            scan_id: scanId,
            cbom: parsedCbom,
            question,
            conversation_id: convId,
          };
          if (plan) {
            fallbackPayload.plan = plan;
          }
          res = await fetch(`${SERVICE_BASE_URL}/api/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fallbackPayload),
          });
        } catch {
          // If JSON parse fails, maintain the original response
        }
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => undefined);
        const message =
          res.status === 502
            ? "Local AI runtime unavailable — answers fall back to verified scan evidence."
            : (detail?.detail as string | undefined) ?? `Request failed (HTTP ${res.status}).`;
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: message } : t)));
        return;
      }

      const data = (await res.json()) as AskResponse;
      if (data.answer && !data.answer.startsWith("[Local Ollama model unavailable")) {
        setHasQueriedLlm(true);
      }
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                answer: data.answer,
                grounded: data.grounded,
                category: data.category,
                sources: data.sources,
                highlights: data.highlights,
              }
            : t
        )
      );
    } catch {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, error: "Local AI runtime unavailable — answers fall back to verified scan evidence." } : t
        )
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="border-b border-line pb-3 mb-4">
        <h2 className="font-heading text-[22px] font-medium text-ink tracking-tight">Ask about this scan</h2>
        <p className="mt-1 font-sans text-sm text-ink-muted leading-relaxed max-w-2xl">
          Answers are drawn ONLY from this scan's own data (a local Ollama model, strictly
          limited to retrieved CBOM context — never its own knowledge of cryptography or
          compliance). A question with no grounded answer gets an honest decline, not a guess.
        </p>
        <div className="mt-2 flex items-center gap-1.5 font-sans text-xs text-ink-muted">
          {aiSetup?.stage === "error" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-status-critical" aria-hidden="true" />
              <span>
                Local AI setup failed{aiSetup.message ? ` — ${aiSetup.message}.` : "."} Answers fall
                back to verified scan evidence. All other features are unaffected.
              </span>
            </>
          ) : aiSetup?.stage === "importing" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-status-warning animate-pulse" aria-hidden="true" />
              <span>
                Importing local model <span className="font-mono text-ink">llama3.2:3b</span> from offline package…
                You can keep using Hash Patch meanwhile (questions use verified scan evidence).
              </span>
            </>
          ) : aiSetup?.stage === "warming" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-status-warning animate-pulse" aria-hidden="true" />
              <span>
                Initializing local AI model into memory (<span className="font-mono text-ink">llama3.2:3b</span>)…
                Questions asked now use verified scan evidence.
              </span>
            </>
          ) : aiSetup?.stage === "downloading" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-status-warning" aria-hidden="true" />
              <span>
                Setting up local AI model <span className="font-mono text-ink">llama3.2:3b</span> —{" "}
                {aiSetup.percent != null
                  ? `${aiSetup.percent}% downloaded (one-time, ~2 GB)`
                  : "downloading… (one-time, ~2 GB)"}
                . You can keep using Hash Patch meanwhile (questions use verified scan evidence).
              </span>
            </>
          ) : aiSetup?.stage === "starting" || aiSetup?.stage === "verifying" ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-status-warning" aria-hidden="true" />
              <span>
                Setting up local AI model <span className="font-mono text-ink">llama3.2:3b</span> —{" "}
                {aiSetup.stage === "verifying" ? "verifying download…" : "starting local runtime…"}
                . Questions fall back to verified scan evidence.
              </span>
            </>
          ) : (
            <>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  aiStatus === "ready" || aiSetup?.stage === "ready"
                    ? "bg-status-good"
                    : aiStatus === "missing-model" || aiStatus === "unavailable"
                      ? "bg-status-warning"
                      : "bg-ink-muted"
                }`}
                aria-hidden="true"
              />
              {aiSetup?.stage === "ready" || aiStatus === "ready" ? (
                <span>Local model <span className="font-mono text-ink">llama3.2:3b</span> is available.</span>
              ) : aiStatus === "checking" ? (
                <span>Checking for local AI model…</span>
              ) : aiStatus === "missing-model" ? (
                <span>
                  Ollama is running but the <span className="font-mono text-ink">llama3.2:3b</span> model is
                  not installed — answers fall back to verified scan evidence.
                </span>
              ) : (
                <span>
                  Local AI runtime not yet ready — answers fall back to verified scan evidence (all other
                  features are unaffected).
                </span>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {turns.length === 0 && (
          <p className="font-mono text-xs text-ink-muted">
            No questions asked yet. Try: "Why is RSA flagged as broken by Shor?", "What's the
            most urgent finding?", or "What CVE does this correspond to?"
          </p>
        )}
        {turns.map((t) => (
          <div key={t.id} className="space-y-1.5">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-sm border border-line bg-surface-2 px-3 py-1.5 font-sans text-sm text-ink">
                {t.question}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[85%] space-y-1">
                {t.answer === undefined && t.error === undefined && (
                  <div className="rounded-sm border border-line bg-surface px-3 py-1.5 font-mono text-xs text-ink-muted">
                    {aiSetup?.stage === "ready" || aiStatus === "ready"
                      ? !hasQueriedLlm
                        ? "Thinking… (first local model query may take longer while model initializes in memory)"
                        : "Thinking… (local model call, usually a few seconds)"
                      : "Thinking… (consulting verified scan evidence)"}
                  </div>
                )}
                {t.error !== undefined && (
                  <div className="rounded-sm border border-status-critical/40 bg-status-critical/10 px-3 py-1.5 font-mono text-xs text-status-critical">
                    {t.error}
                  </div>
                )}
                {t.answer !== undefined && (
                  <>
                    <div className="rounded-sm border border-line bg-surface px-3.5 py-2.5 font-sans text-sm text-ink">
                      <MarkdownAnswerRenderer content={t.answer} highlights={t.highlights} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-heading text-[10px] font-semibold uppercase tracking-wider ${
                          t.category === "conversational"
                            ? "border border-ink-muted/60 text-ink-muted"
                            : t.grounded
                              ? "border border-status-good/60 text-status-good"
                              : "border border-status-warning/60 text-status-warning"
                        }`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {t.category === "conversational"
                          ? "Conversational"
                          : t.grounded
                            ? `Grounded · ${t.category}`
                            : "Declined — not in this scan"}
                      </span>
                      {t.sources && t.sources.length > 0 && (
                        <span className="font-mono text-[11px] text-ink-muted">
                          {t.sources.length} source{t.sources.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAsk) handleAsk();
          }}
          placeholder={rawCbomText === undefined && scanId === undefined ? "No scan loaded yet" : "Ask a question about this scan…"}
          disabled={rawCbomText === undefined && scanId === undefined}
          className="flex-1 rounded-sm border border-line bg-page px-3 py-2 font-sans text-sm text-ink placeholder:text-ink-muted focus:border-line-strong focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleAsk}
          disabled={!canAsk}
          className="rounded-sm border border-line bg-surface-2 px-4 py-2 font-heading text-xs font-semibold uppercase tracking-wider text-ink hover:border-line-strong disabled:opacity-40 disabled:hover:border-line transition-colors"
        >
          {pending ? "Asking…" : "Ask"}
        </button>
      </div>
    </div>
  );
}
