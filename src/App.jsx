import React, { useEffect, useMemo, useState } from 'react'
import RadarPentagon from './components/RadarPentagon.jsx'

const LEVERS = [
  'Pipeline Discipline',
  'Deal Execution',
  'Value Co-Creation',
  'Capability Uptake',
  'Data Hygiene',
]

// ------------------------------ Data hooks ------------------------------
function useData() {
  const [hris, setHris] = useState([])
  const [crm, setCrm] = useState([])
  const [lrs, setLrs] = useState({ catalog: [], consumption: [] })

  useEffect(() => {
    fetch('/data/hris.json').then((r) => r.json()).then(setHris)
    fetch('/data/crm_agg.json').then((r) => r.json()).then(setCrm)
    fetch('/data/lrs.json').then((r) => r.json()).then(setLrs)
  }, [])

  return { hris, crm, lrs }
}

// ------------------------------ Scoring logic ------------------------------
function computeScores(personId, crmRow, lrsRow) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)))

  // PIPELINE DISCIPLINE
  let pd = 0
  if (crmRow) {
    const coverageScore = Math.min(100, (crmRow.pipeline_coverage / 3.5) * 100) // 3.5x target
    const stalledScore = (1 - crmRow.stalled_ratio) * 100 // lower stalled is better
    const newOppsScore = Math.min(100, (crmRow.new_opps_last_30 / 6) * 100) // 6/mo is strong
    pd = clamp(0.4 * coverageScore + 0.3 * stalledScore + 0.3 * newOppsScore)
  }

  // DEAL EXECUTION
  let de = 0
  if (crmRow) {
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
        crmRow.meddpicc.competition_pct) /
      8
    de = clamp(0.4 * winScore + 0.3 * cycleScore + 0.3 * meddpiccScore)
  }

  // VALUE CO-CREATION
  let vc = 0
  if (crmRow) {
    const bc = crmRow.value_co.business_case_rate * 100
    const qi = crmRow.value_co.quantified_impact_rate * 100
    const execMtg = Math.min(100, (crmRow.value_co.exec_meetings_90d / 8) * 100)
    const msp = crmRow.value_co.mutual_success_plan_rate * 100
    vc = clamp(0.3 * bc + 0.3 * qi + 0.2 * execMtg + 0.2 * msp)
  }

  // CAPABILITY UPTAKE
  let cu = 0
  if (lrsRow) {
    const comp = Math.min(100, (lrsRow.completions / 8) * 100)
    const minutes = Math.min(100, (lrsRow.minutes / 600) * 100) // 10h/mo cap
    const recency = Math.max(0, 100 - lrsRow.recency_days * 2) // fresher is better
    const assess = lrsRow.assessment_score_avg
    const certs = Math.min(100, lrsRow.certifications * 25)
    cu = clamp(0.25 * comp + 0.25 * minutes + 0.2 * recency + 0.2 * assess + 0.1 * certs)
  }

  // DATA HYGIENE
  let dh = 0
  if (crmRow) {
    const ns = crmRow.hygiene.next_step_filled_pct
    const nm = crmRow.hygiene.next_meeting_set_pct
    const sd = crmRow.hygiene.stage_date_present_pct
    const fc = crmRow.hygiene.forecast_cat_set_pct
    const cd = crmRow.hygiene.close_date_valid_pct
    dh = clamp((ns + nm + sd + fc + cd) / 5)
  }

  return {
    'Pipeline Discipline': pd,
    'Deal Execution': de,
    'Value Co-Creation': vc,
    'Capability Uptake': cu,
    'Data Hygiene': dh,
  }
}

// --- NEW: Composite index + 75th percentile cutoff for Top Performers ---
function buildCompositeIndex(hris, crm, lrs) {
  if (!hris?.length) return { byId: {}, cutoff: 0 }

  const crmById = Object.fromEntries(crm.map((r) => [r.person_id, r]))
  const lrsById = Object.fromEntries(lrs.consumption.map((r) => [r.person_id, r]))

  const rows = hris.map((h) => {
    const s = computeScores(h.person_id, crmById[h.person_id], lrsById[h.person_id])
    const composite =
      (s['Pipeline Discipline'] +
        s['Deal Execution'] +
        s['Value Co-Creation'] +
        s['Capability Uptake'] +
        s['Data Hygiene']) /
      5
    return { person_id: h.person_id, composite }
  })

  const sorted = [...rows].sort((a, b) => a.composite - b.composite)
  const idx = Math.floor(0.75 * (sorted.length - 1)) // 75th percentile
  const cutoff = sorted[idx]?.composite ?? 0

  const byId = Object.fromEntries(rows.map((r) => [r.person_id, r.composite]))
  return { byId, cutoff }
}

// ------------------------------ App ------------------------------
export default function App() {
  const { hris, crm, lrs } = useData()

  const [geo, setGeo] = useState('All')
  const [manager, setManager] = useState('All')
  const [personId, setPersonId] = useState(null)
  const [topFilter, setTopFilter] = useState('All') // 'All' | 'Top Performers'

  // Distinct filter values
  const managers = useMemo(() => Array.from(new Set(hris.map((h) => h.manager_name))), [hris])
  const geos = useMemo(() => Array.from(new Set(hris.map((h) => h.geo))), [hris])

  // Build composite index + cutoff for "Top Performers"
  const compositeIndex = useMemo(() => buildCompositeIndex(hris, crm, lrs), [hris, crm, lrs])

  // People list with filters applied
  const people = useMemo(() => {
    let list = hris
      .filter((h) => (geo === 'All' || h.geo === geo))
      .filter((h) => (manager === 'All' || h.manager_name === manager))

    if (topFilter === 'Top Performers') {
      list = list.filter((p) => {
        const comp = compositeIndex.byId[p.person_id] ?? 0
        return comp >= compositeIndex.cutoff
      })
    }
    return list
  }, [hris, geo, manager, topFilter, compositeIndex])

  // Ensure a person is selected
  useEffect(() => {
    if (!personId && people.length > 0) setPersonId(people[0].person_id)
    // If the current person falls out of the filtered list, reset
    if (personId && people.length > 0 && !people.find((p) => p.person_id === personId)) {
      setPersonId(people[0].person_id)
    }
  }, [people, personId])

  // Selected person and their rows
  const selected = useMemo(() => hris.find((h) => h.person_id === personId), [hris, personId])
  const crmRow = useMemo(() => crm.find((c) => c.person_id === personId), [crm, personId])
  const lrsRow = useMemo(() => lrs.consumption.find((c) => c.person_id === personId), [lrs, personId])

  // Scores + radar data
  const scores = useMemo(() => computeScores(personId, crmRow, lrsRow), [personId, crmRow, lrsRow])
  const radarData = useMemo(
    () => LEVERS.map((l) => ({ lever: l, score: scores[l] || 0 })),
    [scores]
  )

  const selectedComposite = useMemo(() => {
    if (!selected) return 0
    const comp =
      (scores['Pipeline Discipline'] +
        scores['Deal Execution'] +
        scores['Value Co-Creation'] +
        scores['Capability Uptake'] +
        scores['Data Hygiene']) /
      5
    return Math.round(comp)
  }, [selected, scores])

  return (
    <div className="min-h-screen p-6 bg-white text-slate-900">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Sales Productivity Demo</h1>
        <p className="text-sm text-slate-600">
          Pentagon radar with fake HRIS / CRM / LRS data (Last 90 Days)
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Filters + Person card */}
        <div className="lg:col-span-1 space-y-4">
          {/* Filters */}
          <div className="p-4 rounded-2xl border">
            <h2 className="font-semibold mb-3">Filters</h2>
            <div className="space-y-3">
              <label className="block text-sm">
                Geo
                <select
                  className="w-full border rounded-lg px-2 py-1 mt-1"
                  value={geo}
                  onChange={(e) => setGeo(e.target.value)}
                >
                  <option>All</option>
                  {geos.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                Manager
                <select
                  className="w-full border rounded-lg px-2 py-1 mt-1"
                  value={manager}
                  onChange={(e) => setManager(e.target.value)}
                >
                  <option>All</option>
                  {managers.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>

              {/* NEW: Top Performers toggle */}
              <label className="block text-sm">
                Show
                <select
                  className="w-full border rounded-lg px-2 py-1 mt-1"
                  value={topFilter}
                  onChange={(e) => setTopFilter(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="Top Performers">Top Performers</option>
                </select>
              </label>

              <label className="block text-sm">
                Person
                <select
                  className="w-full border rounded-lg px-2 py-1 mt-1"
                  value={personId || ''}
                  onChange={(e) => setPersonId(e.target.value)}
                >
                  {people.map((p) => (
                    <option key={p.person_id} value={p.person_id}>
                      {p.name} ({p.role_type})
                    </option>
                  ))}
                </select>
              </label>

              {/* Cutoff helper (small, subtle note) */}
              <div className="text-xs text-slate-500">
                Top Performer Cutoff:&nbsp;
                <span className="font-medium">
                  {Math.round(compositeIndex.cutoff)} / 100
                </span>
              </div>
            </div>
          </div>

          {/* Person card */}
          {selected && (
            <div className="p-4 rounded-2xl border">
              <h3 className="font-semibold mb-2">Person</h3>
              <div className="text-sm space-y-1">
                <div>
                  <strong>{selected.name}</strong> — {selected.title}
                </div>
                <div>Manager: {selected.manager_name}</div>
                <div>Geo: {selected.geo}</div>
                <div>Role: {selected.role_type}</div>
                <div className="pt-2">
                  Composite: <span className="font-semibold">{selectedComposite}</span>/100
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Radar */}
        <div className="lg:col-span-2 p-4 rounded-2xl border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Sales Productivity Pentagon</h2>
            <div className="text-xs text-slate-500">
              Scores: PD / DE / VC / CU / DH
            </div>
          </div>
          <RadarPentagon data={radarData} />

          {/* Quick score stripes below the chart */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-2 text-sm">
            {LEVERS.map((l) => (
              <div key={l} className="rounded-lg border p-2">
                <div className="text-slate-500">{l}</div>
                <div className="text-lg font-semibold">{Math.round(scores[l] || 0)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
