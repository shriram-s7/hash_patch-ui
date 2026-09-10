import { useState } from "react";
import { CircleCheck } from "lucide-react";

type FeedbackType = "Bug Report" | "Feature Request" | "General";

const TYPES: FeedbackType[] = ["Bug Report", "Feature Request", "General"];

export function FeedbackView() {
  const [type, setType] = useState<FeedbackType>("General");
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!text.trim()) return;
    // No backend endpoint for feedback yet -- this only confirms receipt
    // locally and resets the form, per spec (no redirect, no API call).
    setSubmitted(true);
    setType("General");
    setText("");
  };

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-6 py-10" style={{ background: "#0d1117" }}>
      <div className="w-full max-w-[560px]">
        <h1 className="text-2xl font-bold text-white">Send Feedback</h1>

        <div className="mt-5 flex gap-2">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className="rounded-full border px-4 py-1.5 text-xs font-medium transition-colors"
              style={
                type === t
                  ? { background: "#3b82f6", borderColor: "#3b82f6", color: "#ffffff" }
                  : { background: "transparent", borderColor: "#30363d", color: "#c9d1d9" }
              }
            >
              {t}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your feedback..."
          rows={5}
          style={{ minHeight: 120, background: "#161b22", borderColor: "#21262d" }}
          className="mt-4 w-full resize-y rounded-xl border p-4 text-sm text-white placeholder:text-[#6e7681] focus:outline-none"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="mt-4 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "#3b82f6" }}
        >
          Submit Feedback
        </button>

        {submitted && (
          <div
            className="mt-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm"
            style={{ background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.4)", color: "#4ade80" }}
          >
            <CircleCheck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            Thanks for your feedback! We appreciate you helping improve Hash Patch.
          </div>
        )}
      </div>
    </div>
  );
}
