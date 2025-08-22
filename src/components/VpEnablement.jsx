import React, { useState } from 'react'

/**
 * Reusable boardroom Q&A panel.
 * Props:
 *  - geo: string ('All' or a geo)
 *  - manager: string ('All' or a manager name)
 *  - personId: string ('All' or a person_id)
 *
 * Calls /api/ask-vp with current filters.
 */
const VpEnablement = ({ geo, manager, personId }) => {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function onAsk() {
    setError('')
    setAnswer('')
    if (!question.trim()) {
      setError('Please enter a question.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/ask-vp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, geo, manager, personId }),
      })
      const data = await res.json()
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'Request failed')
      }
      setAnswer(data.answer || 'No answer returned.')
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 rounded-2xl border">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">VP Enablement</h2>
        <div className="text-xs text-slate-500">Boardroom Q&amp;A (uses your filters above)</div>
      </div>

      <textarea
        className="w-full border rounded-lg px-3 py-2 text-sm min-h-[96px]"
        placeholder="Ask anything about enablement, productivity, performance…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />

      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={onAsk}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {answer && (
        <div className="mt-4 p-4 rounded-xl bg-slate-50 border text-sm whitespace-pre-wrap">
          {answer}
        </div>
      )}
    </div>
  )
}

export default VpEnablement

