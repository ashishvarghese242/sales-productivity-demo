import React, { useEffect, useMemo, useState } from 'react'
import Topbar from './components/Topbar.jsx'
import RadarPentagon from './components/RadarPentagon.jsx'
import VpEnablement from './components/VpEnablement.jsx'

// ---------------------------------- Constants ----------------------------------
export const LEVERS = [
  'Pipeline Discipline',
  'Deal Execution',
  'Value Co-Creation',
  'Capability Uptake',
  'Data Hygiene',
]

// Visual tuning for enablement overlay
const LRS_OVERLAY_MULTIPLIER = 1.0 // keep as 1.0 for truthful visuals
const MINUTES_FOR_FULL_CREDIT = 30 // minutes on a single asset ⇒ full credit
const EVENT_WINDOW_DAYS = 90       // must match UI label

// ---------------------------------- Data Hooks ---------------------------------
function useData() {
  const [hris, setHris] = useState([])
  const [crm, setCrm] = useState([])
  const [lrs, setLrs] = useState({ catalog: [], consumption: [] }) // legacy aggregate (optional)
  const [lrsCatalog, setLrsCatalog] = useState([])
  const [lrsEvents, setLrsEvents] = useState([])

  useEffect(() => {
    fetch('/data/hris.json').then(r => r.json()).then(setHris).catch(() => setHris([]))
    fetch('/data/crm_agg.json').then(r => r.json()).then(setCrm).catch(() => setCrm([]))
    fetch('/data/lrs.json').then(r => r.json()).then(setLrs).catch(() => setLrs({ catalog: [], consumption: [] }))
    fetch('/data/lrs_catalog.json').then(r => r.json()).then(setLrsCatalog).catch(() => setLrsCatalog([]))
    // NOTE: we compute enablement from minutes (consumption) using lrs_events.json
    fetch('/data/lrs_events.json').then(r => r.json()).then(setLrsEvents).catch(() => setLrsEvents([]))
  }, [])

  return { hris, crm, lrs, lrsCatalog, lrsEvents }
}

// ------------------------------ Performance Scores -----------------------------
function clamp100(v) { return Math.max(0, Math.min(100, Math.round(v))) }

function computeScores(personId, crmRow, lrsRow) {
  let pd = 0, de = 0, vc = 0, cu = 0, dh = 0

  if (crmRow) {
    // Pipeline Discipline
    const coverageScore = Math.min(100, (crmRow.pipeline_coverage / 3.5) * 100)
    const stalledScore = (1 - (crmRow.stalled_ratio || 0)) * 100
    const newOppsScore = Math.min(100, (crmRow.new_opps_last_30 / 6) * 100)
    pd = clamp100(0.4 * coverageScore + 0.3 * stalledScore + 0.3 * newOppsScore)

    // Deal Execution
    const winScore = (crmRow.win_rate || 0) * 100
    const cycleScore = Math.max(0, 100 - ((crmRow.avg_cycle_days || 30) - 30) * 2)
    const m = crmRow.meddpicc || { metrics_pct:0,econ_buyer_pct:0,decision_criteria_pct:0,decision_process_pct:0,paper_process_pct:0,identify_pain_pct:0,champion_pct:0 }
    const meddpiccScore = (m.metrics_pct + m.econ_buyer_pct + m.decision_criteria_pct + m.decision_process_pct + m.paper_process_pct + m.identify_pain_pct + m.champion_pct) / 7
    de = clamp100(0.45 * winScore + 0.35 * cycleScore + 0.20 * meddpiccScore)

    // Value Co‑Creation
    const execMtgScore = Math.min(100, (crmRow.exec_meetings_last_60 / 4) * 100)
    const multiThreadScore = Math.min(100, (crmRow.opps_multithreaded_ratio || 0) * 100)
    const revInfluence = Math.min(100, (crmRow.influenced_revenue_last90 / 500000) * 100)
    vc = clamp100(0.4 * execMtgScore + 0.35 * multiThreadScore + 0.25 * revInfluence)

    // Data Hygiene
    const nextStepScore = Math.min(100, (crmRow.missing_next_steps_ratio ? (1 - crmRow.missing_next_steps_ratio) : 1) * 100)
    const staleScore = Math.max(0, 100 - (crmRow.stale_records_over_30 || 0) * 2)
    const activityLogScore = Math.min(100, (crmRow.sales_activities_last_14 / 40) * 100)
    dh = clamp100(0.4 * nextStepScore + 0.3 * staleScore + 0.3 * activityLogScore)
  }

  // Capability Uptake (optional legacy aggregates from lrs.json)
  if (lrsRow) {
    const comp = Math.min(100, ((lrsRow.completions || 0) / 8) * 100)
    const minutes = Math.min(100, ((lrsRow.minutes || 0) / 600) * 100)
    const recency = Math.max(0, 100 - (lrsRow.recency_days || 0) * 2)
    const assess = lrsRow.assessment_score_avg || 0
    const certs = Math.min(100, (lrsRow.certifications || 0) * 25)
    const raw = 0.25 * comp + 0.25 * minutes + 0.2 * recency + 0.2 * assess + 0.1 * certs
    const cuScore = clamp100(raw)
    if (!Number.isNaN(cuScore)) cu = cuScore
  }

  return {
    'Pipeline Discipline': pd,
    'Deal Execution': de,
    'Value Co-Creation': vc,
    'Capability Uptake': cu,
    'Data Hygiene': dh,
  }
}

function indexById(arr, key = 'person_id') { return Object.fromEntries(arr.map(r => [r[key], r])) }

function averageScoresForPeople(people, crmById, lrsById) {
  if (!people.length) return Object.fromEntries(LEVERS.map(l => [l, 0]))
  const sums = Object.fromEntries(LEVERS.map(l => [l, 0]))
  people.forEach((p) => {
    const s = computeScores(p.person_id, crmById[p.person_id], lrsById[p.person_id])
    LEVERS.forEach((l) => { sums[l] += (s[l] || 0) })
  })
  const avg = {}; LEVERS.forEach(l => { avg[l] = Math.round(sums[l] / people.length) })
  return avg
}

// ----------------- Enablement Overlay (consumption-based, minutes) -------------
function lrsImpactCoverageForPeople(personIds, lrsCatalog, lrsEvents) {
  if (!personIds?.length || !lrsCatalog?.length) return Object.fromEntries(LEVERS.map(l => [l, 0]))

  // Build lever catalogs & denominators (sum of impact for non-fluff assets)
  const leverAssets = {}; const leverDenom = {}
  LEVERS.forEach(l => { leverAssets[l] = []; leverDenom[l] = 0 })
  lrsCatalog.forEach(a => {
    if (!LEVERS.includes(a.lever)) return
    if (a.is_fluff) return
    const impact = Number(a.impact_score || 0)
    leverAssets[a.lever].push({ asset_id: a.asset_id, impact })
    leverDenom[a.lever] += impact
  })

  // Build minutes map within the window (non-fluff only)
  const cutoff = new Date(Date.now() - EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const minutesByPersonAsset = {}; personIds.forEach(pid => { minutesByPersonAsset[pid] = {} })
  ;(lrsEvents || []).forEach(e => {
    if (!personIds.includes(e.person_id)) return
    const dt = new Date(e.date); if (!(dt >= cutoff)) return
    if (e.is_fluff) return // defensive; denom already excludes
    const pid = e.person_id, aid = e.asset_id
    const prev = minutesByPersonAsset[pid][aid] || 0
    minutesByPersonAsset[pid][aid] = prev + (Number(e.minutes) || 0)
  })

  // Compute impact-weighted consumption percentage per lever
  const sums = Object.fromEntries(LEVERS.map(l => [l, 0]))
  personIds.forEach(pid => {
    LEVERS.forEach(lever => {
      const denom = leverDenom[lever]; if (denom === 0) return
      let num = 0
      leverAssets[lever].forEach(a => {
        const mins = minutesByPersonAsset[pid][a.asset_id] || 0
        const credit = Math.min(1, mins / MINUTES_FOR_FULL_CREDIT) // 30m ⇒ full credit
        num += a.impact * credit
      })
      let pct = Math.round((num / denom) * 100)
      pct = Math.max(0, Math.min(100, pct))
      sums[lever] += pct
    })
  })

  const avg = {}; LEVERS.forEach(lever => { avg[lever] = Math.round((sums[lever] || 0) / personIds.length) })
  return avg
}

// ------------------------------------ App -------------------------------------
export default function App() {
  const { hris, crm, lrs, lrsCatalog, lrsEvents } = useData()

  // filters
  const [geo, setGeo] = useState('All')
  const [manager, setManager] = useState('All')
  const [personId, setPersonId] = useState('All')

  // toggles
  const [showPerformance, setShowPerformance] = useState(false)
  const [showTop, setShowTop] = useState(false)
  const [showBottom, setShowBottom] = useState(false)
  const [showLRS, setShowLRS] = useState(true)

  // summary panel
  const [summary, setSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const managers = useMemo(() => Array.from(new Set(hris.map(h => h.manager_name))), [hris])
  const geos = useMemo(() => Array.from(new Set(hris.map(h => h.geo))), [hris])

  const crmById = useMemo(() => indexById(crm), [crm])
  const lrsById = useMemo(() => indexById(lrs.consumption || []), [lrs])

  const filteredPeople = useMemo(() => hris
    .filter(h => (geo === 'All' || h.geo === geo))
    .filter(h => (manager === 'All' || h.manager_name === manager)), [hris, geo, manager])

  const peopleOptions = useMemo(() => [{ person_id: 'All', name: 'All', role_type: '' }, ...filteredPeople], [filteredPeople])

  const selectedScores = useMemo(() => {
    if (personId === 'All') return averageScoresForPeople(filteredPeople, crmById, lrsById)
    return computeScores(personId, crmById[personId], lrsById[personId])
  }, [personId, filteredPeople, crmById, lrsById])

  const topAvg = useMemo(() => {
    const cohort = filteredPeople.map(p => {
      const s = computeScores(p.person_id, crmById[p.person_id], lrsById[p.person_id])
      const composite = (s['Pipeline Discipline'] + s['Deal Execution'] + s['Value Co-Creation'] + s['Capability Uptake'] + s['Data Hygiene']) / 5
      return { person: p, composite }
    })
    const sorted = cohort.sort((a, b) => b.composite - a.composite)
    const top = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.25))).map(x => x.person)
    return averageScoresForPeople(top, crmById, lrsById)
  }, [filteredPeople, crmById, lrsById])

  const bottomAvg = useMemo(() => {
    const cohort = filteredPeople.map(p => {
      const s = computeScores(p.person_id, crmById[p.person_id], lrsById[p.person_id])
      const composite = (s['Pipeline Discipline'] + s['Deal Execution'] + s['Value Co-Creation'] + s['Capability Uptake'] + s['Data Hygiene']) / 5
      return { person: p, composite }
    })
    const sorted = cohort.sort((a, b) => a.composite - b.composite)
    const bot = sorted.slice(0, Math.max(1, Math.round(sorted.length * 0.25))).map(x => x.person)
    return averageScoresForPeople(bot, crmById, lrsById)
  }, [filteredPeople, crmById, lrsById])

  const lrsOverlay = useMemo(() => {
    const personIds = personId === 'All' ? filteredPeople.map(p => p.person_id) : [personId]
    return lrsImpactCoverageForPeople(personIds, lrsCatalog, lrsEvents)
  }, [personId, filteredPeople, lrsCatalog, lrsEvents])

  useEffect(() => { setIsDirty(true) }, [geo, manager, personId, showPerformance, showTop, showBottom, showLRS])

  async function runSummary() {
    try {
      setSummaryLoading(true)
      const res = await fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geo, manager, personId, showPerformance, showTop, showBottom, showLRS }) })
      const data = await res.json()
      if (!data || !data.summary) throw new Error('No summary')
      setSummary(data.summary)
      setIsDirty(false)
    } catch (e) {
      setSummary('(Could not generate summary. Try again.)')
    } finally {
      setSummaryLoading(false)
    }
  }

  return (
    <>
      <Topbar />
      <div className="mx-auto max-w-7xl p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Filters & Summary */}
          <div>
            <div className="rounded-xl border border-slate-200 p-4 bg-white shadow-sm">
              <h2 className="text-lg font-semibold mb-3">Filters</h2>

              <label className="block text-sm mb-2">
                <span className="block text-slate-600 mb-1">Geo</span>
                <select value={geo} onChange={e => setGeo(e.target.value)} className="w-full rounded-md border px-3 py-2">
                  <option>All</option>
                  {geos.map(g => (<option key={g}>{g}</option>))}
                </select>
              </label>

              <label className="block text-sm mb-2">
                <span className="block text-slate-600 mb-1">Manager</span>
                <select value={manager} onChange={e => setManager(e.target.value)} className="w-full rounded-md border px-3 py-2">
                  <option>All</option>
                  {managers.map(m => (<option key={m}>{m}</option>))}
                </select>
              </label>

              <label className="block text-sm mb-2">
                <span className="block text-slate-600 mb-1">Person</span>
                <select value={personId} onChange={e => setPersonId(e.target.value)} className="w-full rounded-md border px-3 py-2">
                  {peopleOptions.map(p => (
                    <option key={p.person_id} value={p.person_id}>{p.name} {p.role_type ? `(${p.role_type})` : ''}</option>
                  ))}
                </select>
              </label>

              {/* Toggles */}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm col-span-2">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={showPerformance} onChange={e => setShowPerformance(e.target.checked)} />
                  <span>Performance</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={showTop} onChange={e => setShowTop(e.target.checked)} />
                  <span>Top</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={showBottom} onChange={e => setShowBottom(e.target.checked)} />
                  <span>Bottom</span>
                </label>
                <label className="flex items-center gap-2 text-sm col-span-2">
                  <input type="checkbox" className="h-4 w-4 accent-purple-600" checked={showLRS} onChange={e => setShowLRS(e.target.checked)} />
                  <span>Enablement (Impact-weighted)</span>
                </label>
              </div>
            </div>

            {/* Executive Summary */}
            <div className="rounded-xl border border-slate-200 p-4 mt-4 bg-white shadow-sm">
              <h2 className="text-lg font-semibold mb-2">Executive Summary</h2>
              <p className="text-sm text-slate-600 mb-3">Adjust the filters and toggles above to focus on a person, team, or cohort. Then generate a quick summary of performance and enablement alignment.</p>
              <div className="text-xs text-slate-500 mb-3">
                Person: {personId === 'All' ? 'All' : (hris.find(h => h.person_id === personId)?.name || '—')} · {' '}
                {personId === 'All' ? '' : (hris.find(h => h.person_id === personId)?.role_type || '—')} · {' '}
                {personId === 'All' ? '' : (hris.find(h => h.person_id === personId)?.geo || '—')} · {' '}
                Manager: {personId === 'All' ? (manager === 'All' ? 'All' : manager) : (hris.find(h => h.person_id === personId)?.manager_name || '—')}
              </div>
              <div className="mt-3">
                <button onClick={runSummary} disabled={summaryLoading} className="px-4 py-2 rounded-lg text-white font-medium shadow-sm disabled:opacity-60 disabled:cursor-not-allowed" style={{ background: 'linear-gradient(90deg,#6d28d9,#2563eb)' }}>
                  {summary ? (isDirty ? 'Re-analyze' : (summaryLoading ? 'Analyzing…' : 'Analyze again')) : (summaryLoading ? 'Analyzing…' : 'Analyze')}
                </button>
                {summary && isDirty && (<span className="ml-2 text-xs text-amber-600 align-middle">Filters/toggles changed — summary may be out of date.</span>)}
              </div>
              {summary && (<div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap">{summary}</div>)}
            </div>
          </div>

          {/* Right: Radar */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-200 p-4 bg-white shadow-sm">
              <h2 className="text-lg font-semibold mb-2">Sales Productivity</h2>
              <RadarPentagon
                data={LEVERS.map(lever => ({
                  lever,
                  selectedScore: selectedScores[lever] || 0,
                  topAvg: showTop ? (topAvg[lever] || 0) : undefined,
                  bottomAvg: showBottom ? (bottomAvg[lever] || 0) : undefined,
                  lrsOverlay: showLRS ? Math.round((lrsOverlay[lever] || 0) * LRS_OVERLAY_MULTIPLIER) : undefined,
                }))}
                showPerformance={showPerformance}
                showTop={showTop}
                showBottom={showBottom}
                showLRS={showLRS}
              />
            </div>
          </div>
        </div>

        {/* Full-width panel */}
        <VpEnablement geo={geo} manager={manager} personId={personId} />
      </div>
    </>
  )
}
