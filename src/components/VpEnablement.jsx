import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

/**
 * VP Enablement panel with chat-like UI + markdown rendering.
 * NOW: maintains a lightweight conversation context (threadCtx)
 *      so follow-ups like “what are THEY consuming?” resolve
 *      to the last referenced person (e.g., top performer).
 */
export default function VpEnablement() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState([
    {
      role: "assistant",
      content:
        "Ask me anything about Productivity.",
    },
  ]);
  const [threadCtx, setThreadCtx] = useState({}); // <-- NEW: sticky context for pronouns/entities
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [conversation, loading]);

  async function askVpEnablement(q) {
    const clean = (q || "").trim();
    if (!clean) return;

    // show user message
    setConversation((prev) => [...prev, { role: "user", content: clean }]);
    setLoading(true);

    try {
      const res = await fetch("/api/ask-vp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // IMPORTANT: send threadCtx so backend can resolve “they / top performer”
        body: JSON.stringify({ question: clean, threadCtx }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Request failed");
      }
      const data = await res.json();

      const answer =
        (data && (data.answer || data.text || data.content)) ||
        "No answer returned.";

      // show assistant message
      setConversation((prev) => [
        ...prev,
        { role: "assistant", content: answer },
      ]);

      // store updated context (if returned)
      if (data && data.ctx) setThreadCtx(data.ctx);
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

  const suggestions = [
    "Which assets correlate most with top performance?",
    "What should bottom performers do first?",
  ];

  return (
    <div className="card w-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">VP Enablement</h2>
        {/* No page-filter binding by default */}
        <div className="text-xs text-slate-500">Org-wide • All history</div>
      </div>

      {/* Conversation */}
      <div ref={chatRef} className="h-80 overflow-y-auto space-y-4 pr-1">
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
                  <ReactMarkdown className="prose max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-strong:text-indigo-600">
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
        
      </div>

      {/* Quick suggestions */}
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
