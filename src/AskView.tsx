import { useEffect, useRef, useState } from "react";
import { SERVICE_BASE_URL } from "./serviceUrl";
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
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const nextId = useRef(0);
  const conversationIdRef = useRef<string>(generateConversationId());
  const lastScanKeyRef = useRef<string | undefined>(scanId || rawCbomText);

  // When a new scan loads (scanId or rawCbomText changes), reset conversation
  // state so conversational context is strictly isolated to the active scan.
  useEffect(() => {
    const currentKey = scanId || rawCbomText;
    if (currentKey !== lastScanKeyRef.current) {
      lastScanKeyRef.current = currentKey;
      conversationIdRef.current = generateConversationId();
      setTurns([]);
    }
  }, [scanId, rawCbomText]);

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
            ? "Local model unavailable — is Ollama running?"
            : (detail?.detail as string | undefined) ?? `Request failed (HTTP ${res.status}).`;
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: message } : t)));
        return;
      }

      const data = (await res.json()) as AskResponse;
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
          t.id === id ? { ...t, error: "Local model unavailable — is Ollama running?" } : t
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
                    Thinking… (local model call, usually a few seconds)
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
