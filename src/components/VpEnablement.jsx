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
  <div className="card">
    <div className="gpt-head">
      <h2 className="gpt-title">VP Enablement</h2>
      <div className="gpt-badge">Boardroom Q&amp;A (uses your filters above)</div>
    </div>

    <div className="gpt-body">
      <textarea
        className="gpt-input"
        placeholder="Ask anything about enablement, productivity, performance…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
      />

      <div className="gpt-row">
        <button
          onClick={onAsk}
          disabled={loading}
          className="gpt-btn"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
        {error && <span className="gpt-badge" style={{color:'#dc2626'}}>{error}</span>}
      </div>

      {answer && (
        <div className="gpt-out">
          {answer}
        </div>
      )}
    </div>
  </div>
)

export default VpEnablement

