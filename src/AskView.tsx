import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  MessageCircle,
  Wrench,
  ClipboardList,
  BarChart3,
  Paperclip,
  Send,
  Monitor,
  Lightbulb,
  RefreshCw,
  MoreHorizontal,
  Lock,
} from "lucide-react";
import { SERVICE_BASE_URL, type OllamaProvisionState } from "./serviceUrl";
import { MarkdownAnswerRenderer, type AnswerHighlight } from "./MarkdownAnswerRenderer";

interface ChatTurn {
  id: number;
  question: string;
  askedAt: number;
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

function relativeTime(ms: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

const TYPING_PLACEHOLDER_EXAMPLES = [
  "Ask me anything about your scan...",
  "Why is RSA broken by Shor's algorithm?",
  "How do I fix this in my code?",
  "Create a migration plan for this repo...",
  "Explain the blast radius of this finding...",
];

const QUICK_PROMPTS = [
  "Why is RSA broken by Shor?",
  "How do I fix this in my code?",
  "Create a migration plan",
  "Explain blast radius",
];

const TRY_EXAMPLES = [
  "Why is RSA flagged as broken by Shor's algorithm?",
  "Show me how to fix this finding",
  "Create a migration plan for this repository",
  "Explain the shelf life of SHA-256",
  "What is the blast radius of replacing RSA here?",
];

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

  const noScan = rawCbomText === undefined && scanId === undefined;

  // Typewriter placeholder + a highlighted box, purely to point a
  // first-time user at "this is where you type" — stops for good the moment
  // they focus the box or type anything, so it never fights a real answer.
  const [inputFocused, setInputFocused] = useState(false);
  const [hasEverFocused, setHasEverFocused] = useState(false);
  const [typedPlaceholder, setTypedPlaceholder] = useState("");
  const [cursorOn, setCursorOn] = useState(true);

  useEffect(() => {
    if (noScan || hasEverFocused || input.trim().length > 0) return;
    let cancelled = false;
    let timeoutId: number;
    let exampleIndex = 0;
    let charIndex = 0;
    let deleting = false;

    function tick() {
      if (cancelled) return;
      const current = TYPING_PLACEHOLDER_EXAMPLES[exampleIndex]!;
      if (!deleting) {
        charIndex++;
        setTypedPlaceholder(current.slice(0, charIndex));
        if (charIndex === current.length) {
          deleting = true;
          timeoutId = window.setTimeout(tick, 1500);
          return;
        }
        timeoutId = window.setTimeout(tick, 45);
      } else {
        charIndex--;
        setTypedPlaceholder(current.slice(0, charIndex));
        if (charIndex === 0) {
          deleting = false;
          exampleIndex = (exampleIndex + 1) % TYPING_PLACEHOLDER_EXAMPLES.length;
          timeoutId = window.setTimeout(tick, 350);
          return;
        }
        timeoutId = window.setTimeout(tick, 25);
      }
    }
    timeoutId = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [noScan, hasEverFocused, input]);

  useEffect(() => {
    if (noScan || hasEverFocused || input.trim().length > 0) return;
    const blink = window.setInterval(() => setCursorOn((c) => !c), 500);
    return () => window.clearInterval(blink);
  }, [noScan, hasEverFocused, input]);

  const showTypingPlaceholder = !noScan && !hasEverFocused && input.trim().length === 0;
  const livePlaceholder = noScan
    ? "No scan loaded yet"
    : showTypingPlaceholder
      ? typedPlaceholder + (cursorOn ? "▌" : "")
      : "Ask me anything about your scan...";

  const canAsk = (scanId !== undefined || rawCbomText !== undefined) && input.trim().length > 0 && !pending;

  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [showChat, setShowChat] = useState(turns.length > 0);

  function handleClearAll() {
    const newConvId = generateConversationId();
    conversationIdRef.current = newConvId;
    nextId.current = 0;
    setTurns([]);
    setInput("");
    setShowChat(false);
    saveSavedSession({ scanKey: currentScanKey, conversationId: newConvId, turns: [], nextId: 0, input: "" });
  }

  function jumpToTurn(id: number) {
    setShowChat(true);
    requestAnimationFrame(() => {
      turnRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const recentTurns = useMemo(() => [...turns].reverse().slice(0, 4), [turns]);

  async function handleAsk(questionOverride?: string) {
    const question = (questionOverride ?? input).trim();
    if (!question || pending || (scanId === undefined && rawCbomText === undefined)) return;

    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question, askedAt: Date.now() }]);
    setInput("");
    setShowChat(true);
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

  // Real-time local-AI runtime status, unchanged logic — just rendered as a
  // {dot, text} pair so it can be dropped into the new RAM notice bar.
  let statusDot = "#6b7280";
  let statusText: React.ReactNode;
  if (aiSetup?.stage === "error") {
    statusDot = "#ef4444";
    statusText = (
      <>Local AI setup failed{aiSetup.message ? ` — ${aiSetup.message}.` : "."} Answers fall back to verified scan evidence.</>
    );
  } else if (aiSetup?.stage === "importing") {
    statusDot = "#f59e0b";
    statusText = <>Importing local model <span className="font-mono">llama3.2:3b</span> from offline package…</>;
  } else if (aiSetup?.stage === "warming") {
    statusDot = "#f59e0b";
    statusText = <>Initializing local AI model into memory (<span className="font-mono">llama3.2:3b</span>)…</>;
  } else if (aiSetup?.stage === "downloading") {
    statusDot = "#f59e0b";
    statusText = (
      <>
        Setting up local model <span className="font-mono">llama3.2:3b</span> —{" "}
        {aiSetup.percent != null ? `${aiSetup.percent}% downloaded` : "downloading…"} (one-time, ~2 GB).
      </>
    );
  } else if (aiSetup?.stage === "starting" || aiSetup?.stage === "verifying") {
    statusDot = "#f59e0b";
    statusText = <>Setting up local model — {aiSetup.stage === "verifying" ? "verifying download…" : "starting local runtime…"}</>;
  } else if (aiSetup?.stage === "ready" || aiStatus === "ready") {
    statusDot = "#22c55e";
    statusText = <>Local model <span className="font-mono">llama3.2:3b</span> is available.</>;
  } else if (aiStatus === "checking") {
    statusText = <>Checking for local AI model…</>;
  } else if (aiStatus === "missing-model") {
    statusDot = "#f59e0b";
    statusText = <>Ollama is running but <span className="font-mono">llama3.2:3b</span> is not installed — answers fall back to verified scan evidence.</>;
  } else {
    statusDot = "#f59e0b";
    statusText = <>Local AI runtime not yet ready — answers fall back to verified scan evidence.</>;
  }

  return (
    <div className="h-full overflow-y-auto" style={{ background: "#0d1117" }}>
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        {/* Page header */}
        <div
          className="flex items-center gap-4 rounded-xl px-6 py-5"
          style={{ background: "linear-gradient(135deg, #2e1065 0%, #161b22 60%)" }}
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: "#8b5cf6" }}>
            <Sparkles className="h-6 w-6 shrink-0 text-white" strokeWidth={2} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Patch AI</h1>
            <p className="text-sm" style={{ color: "#9ca3af" }}>
              Your AI assistant for cryptographic security, migration planning, and code insights.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          {/* LEFT / CENTER COLUMN */}
          <div className="min-w-0 space-y-4">
            {!showChat && (
              <div className="rounded-xl border p-6" style={{ background: "#1a1f35", borderColor: "#21262d" }}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <PatchAIBot size={120} />
                    <div>
                      <h2 className="text-xl font-bold">
                        <span className="text-white">Hi, I&apos;m </span>
                        <span style={{ color: "#3b82f6" }}>Patch AI</span>
                      </h2>
                      <p className="mt-1 max-w-sm text-sm" style={{ color: "#9ca3af" }}>
                        Ask questions, get clear explanations, and plan your migration to post-quantum security — all
                        from your codebase.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm italic leading-snug" style={{ color: "#9ca3af" }}>
                      "Same code.
                      <br />
                      Safer future."
                    </p>
                    <div className="ml-auto mt-1 h-0.5 w-14" style={{ background: "#22c55e" }} />
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {[
                    { icon: MessageCircle, label: "Explain findings", sub: "in simple terms" },
                    { icon: Wrench, label: "Suggest fixes", sub: "with code examples" },
                    { icon: ClipboardList, label: "Plan migration", sub: "step-by-step" },
                    { icon: BarChart3, label: "Understand impact", sub: "and blast radius" },
                  ].map(({ icon: Icon, label, sub }) => (
                    <div key={label} className="rounded-lg border px-3 py-3" style={{ borderColor: "#30363d", background: "#0d1117" }}>
                      <Icon className="h-4 w-4 shrink-0" style={{ color: "#a78bfa" }} strokeWidth={2} aria-hidden="true" />
                      <div className="mt-1.5 text-xs font-semibold text-white">{label}</div>
                      <div className="text-[11px]" style={{ color: "#8b949e" }}>{sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chat thread */}
            {showChat && (
              <div className="rounded-xl border" style={{ borderColor: "#21262d", background: "#161b22" }}>
                <div className="max-h-[480px] space-y-4 overflow-y-auto p-4">
                  {turns.map((t) => (
                    <div
                      key={t.id}
                      ref={(el) => {
                        if (el) turnRefs.current.set(t.id, el);
                        else turnRefs.current.delete(t.id);
                      }}
                      className="space-y-1.5"
                    >
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-xl px-3.5 py-2 text-sm text-white" style={{ background: "#3b82f6" }}>
                          {t.question}
                        </div>
                      </div>
                      <div className="flex items-start justify-start gap-2">
                        <PatchAIBot size={28} />
                        <div className="max-w-[85%] space-y-1.5">
                          {t.answer === undefined && t.error === undefined && (
                            <div className="rounded-xl px-3.5 py-2 text-xs" style={{ background: "#0d1117", color: "#8b949e" }}>
                              {aiSetup?.stage === "ready" || aiStatus === "ready"
                                ? !hasQueriedLlm
                                  ? "Thinking… (first local model query may take longer while model initializes in memory)"
                                  : "Thinking… (local model call, usually a few seconds)"
                                : "Thinking… (consulting verified scan evidence)"}
                            </div>
                          )}
                          {t.error !== undefined && (
                            <div className="rounded-xl px-3.5 py-2 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                              {t.error}
                            </div>
                          )}
                          {t.answer !== undefined && (
                            <>
                              <div className="rounded-xl px-3.5 py-2.5 text-sm text-white" style={{ background: "#0d1117" }}>
                                <MarkdownAnswerRenderer content={t.answer} highlights={t.highlights} />
                              </div>
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                                  style={
                                    t.category === "conversational"
                                      ? { background: "#21262d", color: "#8b949e" }
                                      : t.grounded
                                        ? { background: "rgba(34,197,94,0.15)", color: "#22c55e" }
                                        : { background: "rgba(245,158,11,0.15)", color: "#f59e0b" }
                                  }
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                  {t.category === "conversational"
                                    ? "Conversational"
                                    : t.grounded
                                      ? `Grounded · ${t.category}`
                                      : "Declined — not in this scan"}
                                </span>
                                {t.sources && t.sources.length > 0 && (
                                  <span className="text-[11px]" style={{ color: "#6e7681" }}>
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
              </div>
            )}

            {/* Input section */}
            <div
              className={`rounded-xl border p-4 transition-all duration-200 ${!noScan && !hasEverFocused ? "animate-ask-input-glow" : ""}`}
              style={{
                background: "#161b22",
                borderColor: inputFocused ? "#3b82f6" : !hasEverFocused && !noScan ? "#3b82f6" : "#21262d",
                boxShadow: inputFocused ? "0 0 0 3px rgba(59,130,246,0.18)" : undefined,
              }}
            >
              <div className="relative">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => {
                    setInputFocused(true);
                    setHasEverFocused(true);
                  }}
                  onBlur={() => setInputFocused(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (canAsk) void handleAsk();
                    }
                  }}
                  placeholder={livePlaceholder}
                  disabled={noScan}
                  rows={3}
                  className="w-full resize-none bg-transparent pb-8 text-sm text-white placeholder:italic placeholder:text-[#8b949e] focus:outline-none disabled:opacity-50"
                  style={{ minHeight: 80 }}
                />
                <div className="absolute bottom-0 right-0 flex items-center gap-2">
                  <button
                    type="button"
                    title="Attachments are not supported in Ask Patch AI"
                    disabled
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-40"
                    style={{ color: "#8b949e" }}
                  >
                    <Paperclip className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAsk()}
                    disabled={!canAsk}
                    title="Send"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ background: "#3b82f6" }}
                  >
                    <Send className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {!showChat && (
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void handleAsk(p)}
                    disabled={noScan || pending}
                    className="rounded-full border px-3 py-1.5 text-xs text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ borderColor: "#30363d" }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            {/* RAM notice bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ background: "#161b22", borderColor: "#21262d" }}>
              <div className="flex items-start gap-3">
                <Monitor className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#3b82f6" }} strokeWidth={2} aria-hidden="true" />
                <div>
                  <div className="flex items-center gap-1.5 text-sm" style={{ color: "#3b82f6" }}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusDot }} aria-hidden="true" />
                    For best performance: 8 GB RAM recommended (6 GB minimum).
                  </div>
                  <p className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>
                    Patch AI runs locally on your machine. No data leaves your system. {statusText}
                  </p>
                </div>
              </div>
              <a href="https://github.com/shriram-s7/hash_patch" target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-medium" style={{ color: "#3b82f6" }}>
                Learn more →
              </a>
            </div>

            {/* Recent conversations */}
            <div className="rounded-xl border p-4" style={{ background: "#161b22", borderColor: "#21262d" }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">Recent Conversations</span>
                {turns.length > 0 && (
                  <button type="button" onClick={handleClearAll} className="text-xs font-medium" style={{ color: "#3b82f6" }}>
                    Clear all
                  </button>
                )}
              </div>
              {recentTurns.length === 0 ? (
                <p className="mt-2 text-xs" style={{ color: "#6e7681" }}>
                  No conversations yet — ask a question above to get started.
                </p>
              ) : (
                <div className="mt-2">
                  {recentTurns.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => jumpToTurn(t.id)}
                      className="flex w-full items-center gap-2.5 border-b py-3 text-left transition-colors hover:bg-white/5"
                      style={{ borderColor: "#21262d" }}
                    >
                      <MessageCircle className="h-4 w-4 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm text-white">{t.question}</span>
                      <span className="shrink-0 text-[11px]" style={{ color: "#6e7681" }}>{relativeTime(t.askedAt)}</span>
                      <MoreHorizontal className="h-4 w-4 shrink-0" style={{ color: "#484f58" }} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border p-4" style={{ background: "#161b22", borderColor: "#21262d" }}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(34,197,94,0.15)" }}>
                <Monitor className="h-4 w-4 shrink-0" style={{ color: "#22c55e" }} strokeWidth={2} aria-hidden="true" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Runs locally on your machine</div>
                <p className="mt-0.5 text-xs" style={{ color: "#8b949e" }}>Uses your local model (e.g., Llama 3.2:3b)</p>
              </div>
            </div>

            <div className="rounded-xl border p-4" style={{ background: "#161b22", borderColor: "#21262d" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 shrink-0" style={{ color: "#f59e0b" }} strokeWidth={2} aria-hidden="true" />
                  <span className="text-sm font-bold text-white">Try these examples</span>
                </div>
                <RefreshCw className="h-3.5 w-3.5 shrink-0" style={{ color: "#8b949e" }} strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="mt-2">
                {TRY_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => void handleAsk(ex)}
                    disabled={noScan || pending}
                    className="flex w-full items-center gap-2 border-b py-2.5 text-left text-xs transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ borderColor: "#21262d", color: "#c9d1d9" }}
                  >
                    <span className="min-w-0 flex-1">{ex}</span>
                    <span className="shrink-0" style={{ color: "#484f58" }}>›</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border p-4" style={{ background: "#161b22", borderColor: "#21262d" }}>
              <h3 className="text-sm font-bold text-white">What can Patch AI do?</h3>
              <div className="mt-2 space-y-3">
                {[
                  { icon: MessageCircle, bg: "rgba(139,92,246,0.15)", color: "#a78bfa", title: "Answer questions about findings", sub: "Get clear, contextual explanations", beta: false },
                  { icon: Wrench, bg: "rgba(59,130,246,0.15)", color: "#3b82f6", title: "Suggest secure replacements", sub: "With ready-to-use code examples", beta: true },
                  { icon: ClipboardList, bg: "rgba(30,58,138,0.4)", color: "#60a5fa", title: "Plan migrations", sub: "Estimate effort and prioritise", beta: false },
                  { icon: Lightbulb, bg: "rgba(245,158,11,0.15)", color: "#f59e0b", title: "Explain complex concepts", sub: "In simple, easy-to-understand terms", beta: true },
                ].map(({ icon: Icon, bg, color, title, sub, beta }) => (
                  <div key={title} className="flex items-start gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: bg }}>
                      <Icon className="h-4 w-4 shrink-0" style={{ color }} strokeWidth={2} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white">
                        {title}
                        {beta && <span style={{ color: "#8b949e" }}> *</span>}
                      </div>
                      <div className="text-[11px]" style={{ color: "#8b949e" }}>{sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border p-4" style={{ background: "#0d2b1a", borderColor: "#1a4d33" }}>
              <Lock className="h-7 w-7 shrink-0" style={{ color: "#22c55e" }} strokeWidth={1.75} aria-hidden="true" />
              <div className="mt-2 text-sm font-semibold text-white">Your code stays private</div>
              <p className="mt-0.5 text-xs" style={{ color: "#c9d1d9" }}>
                All analysis and conversations happen locally on your machine.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Patch AI's mascot — full-body robot with antenna, glowing eyes, and a
 * shield chest emblem, in the app's blue palette. Used large (120) in the
 * pre-conversation hero card and small (28) as the avatar on every AI
 * response bubble once a conversation is underway. */
export function PatchAIBot({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="shrink-0">
      {/* Body */}
      <rect x="30" y="55" width="60" height="50" rx="12" fill="#1d2d44" stroke="#3b82f6" strokeWidth="1.5"/>
      {/* Head */}
      <rect x="25" y="20" width="70" height="45" rx="14" fill="#1d2d44" stroke="#3b82f6" strokeWidth="1.5"/>
      {/* Eyes */}
      <circle cx="43" cy="40" r="8" fill="#0d1117"/>
      <circle cx="77" cy="40" r="8" fill="#0d1117"/>
      <circle cx="43" cy="40" r="5" fill="#3b82f6"/>
      <circle cx="77" cy="40" r="5" fill="#3b82f6"/>
      {/* Eye glow */}
      <circle cx="43" cy="40" r="3" fill="#93c5fd" opacity="0.8"/>
      <circle cx="77" cy="40" r="3" fill="#93c5fd" opacity="0.8"/>
      {/* Mouth */}
      <path d="M 48 52 Q 60 58 72 52" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" fill="none"/>
      {/* Antenna */}
      <line x1="60" y1="20" x2="60" y2="8" stroke="#3b82f6" strokeWidth="2"/>
      <circle cx="60" cy="6" r="4" fill="#3b82f6"/>
      {/* Shield emblem on chest */}
      <path d="M 50 68 L 60 63 L 70 68 L 70 78 Q 60 83 50 78 Z" fill="#3b82f6" opacity="0.8"/>
      <path d="M 55 73 L 58 76 L 65 69" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Arms */}
      <rect x="14" y="58" width="16" height="8" rx="4" fill="#1d2d44" stroke="#3b82f6" strokeWidth="1.5"/>
      <rect x="90" y="58" width="16" height="8" rx="4" fill="#1d2d44" stroke="#3b82f6" strokeWidth="1.5"/>
    </svg>
  );
}
