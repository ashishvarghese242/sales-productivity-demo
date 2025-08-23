import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

/**
 * VP Enablement panel (Step 1: ChatGPT-like rendering only)
 * - Keeps your /api/ask-vp endpoint
 * - Renders answers with markdown (headings/lists/bold/etc.)
 * - Chat bubbles UI + simple suggestions
 */
export default function VpEnablement({ geo = "All", manager = "All", personId = "All" }) {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState([
    {
      role: "assistant",
      content:
        "Ask me anything about Sales Productivity. I’ll use your current filters (Geo, Manager, Person) and last 90 days by default.",
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
        body: JSON.stringify({
          question: q.trim(),
          filters: { geo, manager, personId, windowDays: 90 },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Request failed");
      }
      const data = await res.json();

      // Expecting { answer: string } from your endpoint
      const answer = (data && (data.answer || data.text || data.content)) || "No answer returned.";
      setConversation((prev) => [...prev, { role: "assistant", content: answer }]);
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

  // Suggested follow-ups (simple + relevant to your domain)
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
        <div className="text-xs text-slate-500">
          Filters → Geo: <strong>{geo}</strong> · Manager: <strong>{manager}</strong> · Person:{" "}
          <strong>{personId}</strong>
        </div>
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
                  // Assistant: render markdown like ChatGPT
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
