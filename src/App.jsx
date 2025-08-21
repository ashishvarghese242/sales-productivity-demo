import React, { useEffect, useMemo, useState } from 'react'
import RadarPentagon from './components/RadarPentagon.jsx'

const LEVERS = [
  'Pipeline Discipline',
  'Deal Execution',
  'Value Co-Creation',
  'Capability Uptake',
  'Data Hygiene',
]

// Tune this to make the purple overlay more/less prominent
const LRS_OVERLAY_MULTIPLIER = 1.8

// ------------------------------ Data hooks ------------------------------
function useData() {
  const [hris, setHris] = useState([])
  const [crm, setCrm] = useState([])
  const [lrs, setLrs] = useState({ catalog: [], consumption: [] }) // legacy aggregate (for Capability Uptake)
  const [lrsCatalog, setLrsCatalog] = useState([])                 // activities catalog (lever + impact + fluff)
  const [lrsEvents, setLrsEvents] = useState([])                   // per-person activity events

  useEffect(() => {
    fetch('/data/hris.json').then(r => r.json()).then(setHris)
    fetch('/data/crm_agg.json').then(r => r.json()).then(setCrm)
    fetch('/data/lrs.json').then(r => r.json()).then(setLrs).catch(() => setLrs({ catalog: [], consumption: [] }))
    fetch('/data/lrs_catalog.json').then(r => r.json()).then(setLrsCatalog).catch(() => setLrsCatalog([]))
    fetch('/data/lrs_activity_events.json').then(r => r.json()).then(setLrsEvents).catch(() => setLrsEvents([]))
  }, [])

  return { hris, crm, lrs, lrsCatalog, lrsEvents }
}

// ------------------------------ Scoring logic (performance) ------------------------------
function computeScores(personId, crmRow, lrsRow) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)))

  let pd = 0, de = 0, vc = 0, cu = 0, dh = 0

  if (crmRow) {
    // PIPELINE DISCIPLINE
    const coverageScore = Math.min(100, (crmRow.pipeline_coverage / 3.5) * 100) // 3.5x target
    const stalledScore = (1 - crmRow.stalled_ratio) * 100 // lower stalled is better
    const newOppsScore = Math.min(100, (crmRow.new_opps_last_30 / 6) * 100) // 6/mo is strong
    pd = clamp(0.4 * coverageScore + 0.3 * stalledScore + 0.3 * newOppsScore)

    // DEAL EXECUTION
    const winScore = crmRow.win_rate * 100
    const cycleScore = Math.max(0, 100 - (crmRow.avg_cycle_days - 30) * 2) // 30 days ideal
    const meddpiccScore =
      (crmRow.meddpicc.metrics_pct +
        crmRow.meddpicc.econ_buyer_pct +
        crmRow.meddpicc.decision_criteria_pct +
        crmRow.meddpicc.decision_process_pct +
        crmRow.meddpicc.paper_process_pct +
        crmRow.meddpicc.identify_pain_pct +
        crmRow.meddpicc.champion_pct +
        crmRow.meddpicc.competition_pct) / 8
    de = clamp(0.4 * winScore + 0.3 * cycleScore + 0.3 * meddpiccScore)

    // VALUE CO-CREATION
    const bc = crmRow.value_co.business_case_rate * 100
    const qi = crmRow.value_co.quantified_impact_rate * 100
    const execMtg = Math.min(100, (crmRow.value_co.exec_meetings_90d / 8) * 100)
    const msp = crmRow.value_co.mutual_success_plan_rate * 100
    vc = clamp(0.3 * bc + 0.3 * qi + 0.2 * execMtg + 0.2 * msp)

    // DATA HYGIENE
    const ns = crmRow.hygiene.next_step_filled_pct
    const nm = crmRow.hygiene.next_meeting_set_pct
    const sd = crmRow.hygiene.stage_date_present_pct
    const fc = crmRow.hygiene.forecast_cat_set_pct
    const cd = crmRow.hygiene.close_date_valid_pct
    dh = clamp((ns + nm + sd + fc + cd) / 5)
  }

  // CAPABILITY UPTAKE (from legacy LRS aggregates)
  if (lrsRow) {
    const comp = Math.min(100, (lrsRow.completions / 8) * 100)
    const minutes = Math.min(100, (lrsRow.minutes / 600) * 100) // 10h cap
    const recency = Math.max(0, 100 - lrsRow.recency_days * 2)
    const assess = lrsRow.assessment_score_avg
    const certs = Math.min(100, lrsRow.certifications * 25)
    const raw = 0.25 * comp + 0.25 * minutes + 0.2 * recency + 0.2 * assess + 0.1 * certs
    const cuScore = Math.max(0, Math.min(100, Math.round(raw)))
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

// ------------------------------ Helpers ------------------------------
function indexById(arr, key = 'person_id') {
  return Object.fromEntries(arr.map((r) => [r[key], r]))
}

function averageScoresForPeople(people, crmById, lrsById) {
  if (!people.length) return Object.fromEntries(LEVERS.map(l => [l, 0]))
  const sums = Object.fromEntries(LEVERS.map(l => [l, 0]))
  people.forEach((p) => {
    const s = computeScores(p.person_id, crmById[p.person_id], lrsById[p.person_id])
    LEVERS.forEach((l) => (sums[l] += s[l] || 0))
  })
  const avg = {}
  LEVERS.forEach((l) => (avg[l] = Math.round(sums[l] / people.length)))
  return avg
}

function compositeOf(person, crmById, lrsById) {
  const s = computeScores(person.person_id, crmById[person.person_id], lrsById[person.person_id])
  return (s['Pipeline Discipline'] + s['Deal Execution'] + s['Value Co-Creation'] + s['Capability Uptake'] + s['Data Hygiene']) / 5
}

// ------------------------------ NEW: Impact-weighted LRS overlay per lever ------------------------------
/**
 * coverage_person_lever =
 *   ( SUM impact_score of COMPLETED, NON-FLUFF assets for lever × LRS_OVERLAY_MULTIPLIER )
 * / ( SUM impact_score of ALL NON-FLUFF assets for that lever )
 * -> clamp 0..100
 *
 * Group view (“All”) = average of people’s coverage.
 */
function lrsImpactCoverageForPeople(personIds, lrsCatalog, lrsEvents) {
  if (!personIds?.length || !lrsCatalog?.length) {
    return Object.fromEntries(LEVERS.map(l => [l, 0]))
  }

  const leverAssets = {}
  const leverDenom = {}
  LEVERS.forEach(l => { leverAssets[l] = []; leverDenom[l] = 0 })
  lrsCatalog.forEach(a => {
    if (!LEVERS.includes(a.lever)) return
    if (a.is_fluff) return
    leverAssets[a.lever].push(a)
    leverDenom[a.lever] += (a.impact_score || 0)
  })

  const completedByPerson = {}
  personIds.forEach(pid => completedByPerson[pid] = new Set())
  lrsEvents.forEach(e => {
    if (!completedByPerson.hasOwnProperty(e.person_id)) return
    if (e.completed) completedByPerson[e.person_id].add(e.asset_id)
  })

  const perLeverSums = Object.fromEntries(LEVERS.map(l => [l, 0]))
  personIds.forEach(pid => {
    LEVERS.forEach(lever => {
      const denom = leverDenom[lever] || 0
      if (denom === 0) return
      let num = 0
      leverAssets[lever].forEach(a => {
        if (completedByPerson[pid].has(a.asset_id)) num += (a.impact_score || 0)
      })
      const boosted = num * LRS_OVERLAY_MULTIPLIER
      const pct = Math.max(0, Math.min(100, Math.round((boosted / denom) * 100)))
      perLeverSums[lever] += pct
    })
  })

  const avgCoverage = {}
  LEVERS.forEach(lever => {
    avgCoverage[lever] = Math.round((perLeverSums[lever] || 0) / personIds.length)
  })
  return avgCoverage
}

// ------------------------------ App ------------------------------
export default function App() {
  const { hris, crm, lrs, lrsCatalog, lrsEvents } = useData()

  const [geo, setGeo] = useState('All')
  const [manager, setManager] = useState('All')
  const [personId, setPersonId] = useState('All') // default: aggregate

  const [showTop, setShowTop] = useState(false)
  const [showBottom, setShowBottom] = useState(false)
  const [showLRS, setShowLRS] = useState(false)

  const managers = useMemo(() => Array.from(new Set(hris.map((h) => h.manager_name))), [hris])
  const geos = useMemo(() => Array.from(new Set(hris.map((h) => h.geo))), [hris])

  const crmById = useMemo(() => indexById(crm), [crm])
  const lrsById = useMemo(() => indexById(lrs.consumption || []), [lrs])

  const filteredPeople = useMemo(() => {
    return hris
      .filter((h) => (geo === 'All' || h.geo === geo))
      .filter((h) => (manager === 'All' || h.manager_name === manager))
  }, [hris, geo, manager])

  useEffect(() => {
    if (personId === 'All') return
    const stillVisible = filteredPeople.find((p) => p.person_id === personId)
    if (!stillVisible) setPersonId('All')
  }, [filteredPeople, personId])

  const selected = useMemo(
    () => (personId === 'All' ? null : hris.find((h) => h.person_id === personId)),
    [hris, personId]
  )
  const crmRow = useMemo(
    () => (personId === 'All' ? null : crm.find((c) => c.person_id === personId)),
    [crm, personId]
  )
  const lrsRow = useMemo(
    () => (personId === 'All' ? null : lrs.consumption.find((c) => c.person_id === personId)),
    [lrs, personId]
  )

  const selectedScores = useMemo(() => {
    if (personId === 'All') {
      return averageScoresForPeople(filteredPeople, crmById, lrsById)
    }
    return computeScores(personId, crmRow, lrsRow)
  }, [personId, filteredPeople, crmById, lrsById, crmRow, lrsRow])

  const { topAvgScores, bottomAvgScores, topCut, bottomCut } = useMemo(() => {
    if (!filteredPeople.length) {
      return { topAvgScores: null, bottomAvgScores: null, topCut: 0, bottomCut: 0 }
    }
    const scored = filteredPeople.map((p) => ({
      person: p,
      comp: compositeOf(p, crmById, lrsById),
    }))
    scored.sort((a, b) => a.comp - b.comp)
    const n = scored.length
    const groupSize = Math.max(1, Math.floor(n * 0.2))
    const bottomGroup = scored.slice(0, groupSize).map(x => x.person)
    const topGroup = scored.slice(-groupSize).map(x => x.person)

    return {
      topAvgScores: averageScoresForPeople(topGroup, crmById, lrsById),
      bottomAvgScores: averageScoresForPeople(bottomGroup, crmById, lrsById),
      topCut: Math.round(scored[n - groupSize]?.comp || 0),
      bottomCut: Math.round(scored[groupSize - 1]?.comp || 0),
    }
  }, [filteredPeople, crmById, lrsById])

  const lrsOverlay = useMemo(() => {
    const personIds = personId === 'All' ? filteredPeople.map(p => p.person_id) : [personId]
    return lrsImpactCoverageForPeople(personIds, lrsCatalog, lrsEvents)
  }, [personId, filteredPeople, lrsCatalog, lrsEvents])

  const radarData = useMemo(() => {
    return LEVERS.map((l) => ({
      lever: l,
      selectedScore: selectedScores[l] || 0,
      topAvg: showTop && topAvgScores ? topAvgScores[l] : undefined,
      bottomAvg: showBottom && bottomAvgScores ? bottomAvgScores[l] : undefined,
      lrsOverlay: showLRS && lrsOverlay ? lrsOverlay[l] : undefined,
    }))
  }, [selectedScores, showTop, showBottom, showLRS, topAvgScores, bottomAvgScores, lrsOverlay])

  const selectedComposite = useMemo(() => {
    const s = selectedScores
    const comp =
      (s['Pipeline Discipline'] + s['Deal Execution'] + s['Value Co-Creation'] + s['Capability Uptake'] + s['Data Hygiene']) / 5
    return Math.round(comp || 0)
  }, [selectedScores])

  return (
    <div className="min-h-screen p-6 bg-white text-slate-900">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Sales Productivity Demo</h1>
        <p className="text-sm text-slate-600">
          Pentagon radar with HRIS / CRM / LRS (impact-weighted overlay, last 90 days)
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Filters + Card */}
        <div className="lg:col-span-1 space-y-4">
          <div className="p-4 rounded-2xl border">
            <h2 className="font-semibold mb-3">Filters</h2>
            <div className="space-y-3">
              <label className="block text-sm">
                Geo
                <select className="w-full border rounded-lg px-2 py-1 mt-1" value={geo} onChange={(e) => setGeo(e.target.value)}>
                  <option>All</option>
                  {geos.map((g) => (<option key={g}>{g}</option>))}
                </select>
              </label>

              <label className="block text-sm">
                Manager
                <select className="w-full border rounded-lg px-2 py-1 mt-1" value={manager} onChange={(e) => setManager(e.target.value)}>
                  <option>All</option>
                  {managers.map((m) => (<option key={m}>{m}</option>))}
                </select>
              </label>

              <label className="block text-sm">
                Person
                <select className="w-full border rounded-lg px-2 py-1 mt-1" value={personId || 'All'} onChange={(e) => setPersonId(e.target.value)}>
                  <option value="All">All</option>
                  {filteredPeople.map((p) => (
                    <option key={p.person_id} value={p.person_id}>
                      {p.name} ({p.role_type})
                    </option>
                  ))}
                </select>
              </label>

              {/* Toggles */}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-green-600" checked={showTop} onChange={(e) => setShowTop(e.target.checked)} />
                  <span>Top Performers</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-red-600" checked={showBottom} onChange={(e) => setShowBottom(e.target.checked)} />
                  <span>Bottom Performers</span>
                </label>
                <label className="flex items-center gap-2 text-sm col-span-2">
                  <input type="checkbox" className="h-4 w-4 accent-purple-600" checked={showLRS} onChange={(e) => setShowLRS(e.target.checked)} />
                  <span>Enablement</span>
                </label>
              </div>

              <div className="text-xs text-slate-500 mt-1">
                Top ≥ {Math.round(topCut)}/100 &nbsp;|&nbsp; Bottom ≤ {Math.round(bottomCut)}/100 (within current filters)
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl border">
            <h3 className="font-semibold mb-2">{personId === 'All' ? 'Aggregate (All)' : 'Person'}</h3>
            <div className="text-sm space-y-1">
              {personId === 'All' ? (
                <>
                  <div>People in view: <strong>{filteredPeople.length}</strong></div>
                  <div>Geo filter: {geo}</div>
                  <div>Manager filter: {manager}</div>
                  <div className="pt-2">Avg Composite: <span className="font-semibold">{selectedComposite}</span>/100</div>
                </>
              ) : (
                (() => {
                  const s = selected
                  if (!s) return null
                  return (
                    <>
                      <div><strong>{s.name}</strong> — {s.title}</div>
                      <div>Manager: {s.manager_name}</div>
                      <div>Geo: {s.geo}</div>
                      <div>Role: {s.role_type}</div>
                      <div className="pt-2">Composite: <span className="font-semibold">{selectedComposite}</span>/100</div>
                    </>
                  )
                })()
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: Radar */}
        <div className="lg:col-span-2 p-4 rounded-2xl border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Sales Productivity Pentagon</h2>
            <div className="text-xs text-slate-500">PD / DE / VC / CU / DH</div>
          </div>

          <RadarPentagon
            data={LE
 ​:contentReference[oaicite:0]{index=0}​
