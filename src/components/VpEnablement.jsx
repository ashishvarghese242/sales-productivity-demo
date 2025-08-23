import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

/**
 * VP Enablement panel
 * - DEFAULTS: Entire org, all available history (no cap) unless user specifies constraints in the question.
 * - Ignores page filters (geo/manager/person) entirely.
 * - Sends only { question } to /api/ask-vp.
 * - Renders answers with markdown in chat-style bubbles.
 */
export default function VpEnablement() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState([
    {
      role: "assistant",
      content:
        "I’m your VP of Enablement. I default to the **entire org** and **all available history** unless you specify constraints in your question.\n\n" +
        "**Examples you can ask:**\n" +
        "- *Top 10 reps by composite score and why?*\n" +
        "- *Compare Top vs Bottom across the 5 levers.*\n" +
        "- *What enablement moved the needle the most? What didn’t?*\n" +
        "- *Focus on LATAM last 60 days—where are the gaps?*\n" +
        "- *List bottom performers and what they should do first.*",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Smooth scroll to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation, loading]);

  async function askVpEnablement(q) {
    if (!q?.trim()) return;
    const userMsg = { role: "user", content: q.trim() };
    setConversation((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/ask-vp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // IMPORTANT: no filters sent; API will parse constraints from natural language if present
        body: JSON.stringify({ question: q.trim() }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Request failed");
      }
      const data = await res.json();

      // Expecting { answer: string } from your endpoint
      const answer =
        (data && (data.answer || data.text || data.content)) ||
        "No answer returned.";
      setConversation((prev) => [
        ...prev,
        { role: "assistant", content: answer },
      ]);
    } catch (err) {
      setConversation((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I hit an error calling the endpoint. Please try again or refine your question.\n\n```\n" +
            String(err?.message || err) +
            "\n```",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Suggested follow-ups (kept simple; you can tune later)
  const suggestions = [
    "Where is the biggest execution gap and why?",
    "Which enablement assets correlate most with top performance?",
    "Who are bottom performers and what should they do first?",
    "How do Top vs Bottom differ across the 5 levers?",
    "If I invest in enablement, where’s the highest ROI?",
  ];

  return (
    <div className="card w-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">VP Enablement</h2>
        {/* Removed filters summary — chat ignores page filters by design */}
      </div>

      {/* Conversation area */}
      <div className="h-80 overflow-y-auto space-y-4 pr-1">
        {conversation.map((msg, i) => {
          const isUser = msg.role === "user";
          return (
            <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                  isUser
                    ? "bg-blue-600 text-white"
                    : "bg-white text-slate-800 border border-slate-200"
                }`}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                ) : (
                  <ReactMarkdown
                    className="prose max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-indigo-600"
                  >
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          );
        })}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-white text-slate-800 border border-slate-200 shadow-sm">
              <p className="animate-pulse text-slate-500">Thinking…</p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {suggestions.map((s, idx) => (
          <button
            key={idx}
            onClick={() => askVpEnablement(s)}
            className="text-sm px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Ask row */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              askVpEnablement(question);
              setQuestion("");
            }
          }}
          placeholder="Ask…"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => {
            askVpEnablement(question);
            setQuestion("");
          }}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2"
        >
          Ask
        </button>
      </div>
    </div>
  );
}
