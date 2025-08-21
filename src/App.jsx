import React, { useEffect, useMemo, useState } from 'react'
import RadarPentagon from './components/RadarPentagon.jsx'

const LEVERS = ['Pipeline Discipline','Deal Execution','Value Co-Creation','Capability Uptake','Data Hygiene']

function useData() {
  const [hris, setHris] = useState([])
  const [crm, setCrm] = useState([])
  const [lrs, setLrs] = useState({catalog: [], consumption: []})
  useEffect(() => {
    fetch('/data/hris.json').then(r=>r.json()).then(setHris)
    fetch('/data/crm_agg.json').then(r=>r.json()).then(setCrm)
    fetch('/data/lrs.json').then(r=>r.json()).then(setLrs)
  }, [])
  return {hris, crm, lrs}
}

function computeScores(personId, crmRow, lrsRow) {
  const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)))
  let pd = 0, de = 0, vc = 0, cu = 0, dh = 0
  if (crmRow) {
    const coverageScore = Math.min(100, (crmRow.pipeline_coverage / 3.5) * 100)
    const stalledScore = (1 - crmRow.stalled_ratio) * 100
    const newOppsScore = Math.min(100, (crmRow.new_opps_last_30 / 6) * 100)
    pd = clamp(0.4*coverageScore + 0.3*stalledScore + 0.3*newOppsScore)

    const winScore = crmRow.win_rate * 100
    const cycleScore = Math.max(0, 100 - (crmRow.avg_cycle_days - 30) * 2)
    const meddpiccScore = (
      crmRow.meddpicc.metrics_pct +
      crmRow.meddpicc.econ_buyer_pct +
      crmRow.meddpicc.decision_criteria_pct +
      crmRow.meddpicc.decision_process_pct +
      crmRow.meddpicc.paper_process_pct +
      crmRow.meddpicc.identify_pain_pct +
      crmRow.meddpicc.champion_pct +
      crmRow.meddpicc.competition_pct
    )/8
    de = clamp(0.4*winScore + 0.3*cycleScore + 0.3*meddpiccScore)

    const bc = crmRow.value_co.business_case_rate * 100
    const qi = crmRow.value_co.quantified_impact_rate * 100
    const execMtg = Math.min(100, (crmRow.value_co.exec_meetings_90d / 8) * 100)
    const msp = crmRow.value_co.mutual_success_plan_rate * 100
    vc = clamp(0.3*bc + 0.3*qi + 0.2*execMtg + 0.2*msp)

    const ns = crmRow.hygiene.next_step_filled_pct
    const nm = crmRow.hygiene.next_meeting_set_pct
    const sd = crmRow.hygiene.stage_date_present_pct
    const fc = crmRow.hygiene.forecast_cat_set_pct
    const cd = crmRow.hygiene.close_date_valid_pct
    dh = clamp((ns + nm + sd + fc + cd) / 5)
  }
  if (lrsRow) {
    const comp = Math.min(100, (lrsRow.completions / 8) * 100)
    const minutes = Math.min(100, (lrsRow.minutes / 600) * 100)
    const recency = Math.max(0, 100 - (lrsRow.recency_days * 2))
    const assess = lrsRow.assessment_score_avg
    const certs = Math.min(100, lrsRow.certifications * 25)
    cu = clamp(0.25*comp + 0.25*minutes + 0.2*recency + 0.2*assess + 0.1*certs)
  }
  return {
    'Pipeline Discipline': pd,
    'Deal Execution': de,
    'Value Co-Creation': vc,
    'Capability Uptake': cu,
    'Data Hygiene': dh,
  }
}

export default function App() {
  const {hris, crm, lrs} = useData()
  const [geo, setGeo] = useState('All')
  const [manager, setManager] = useState('All')
  const [personId, setPersonId] = useState(null)

  const managers = useMemo(() => Array.from(new Set(hris.map(h=>h.manager_name))), [hris])
  const geos = useMemo(() => Array.from(new Set(hris.map(h=>h.geo))), [hris])

  const people = useMemo(() => {
    return hris
      .filter(h => (geo==='All' || h.geo===geo))
      .filter(h => (manager==='All' || h.manager_name===manager))
  }, [hris, geo, manager])

  React.useEffect(() => {
    if (!personId && people.length>0) setPersonId(people[0].person_id)
  }, [people, personId])

  const selected = useMemo(() => hris.find(h=>h.person_id===personId), [hris, personId])
  const crmRow = useMemo(() => crm.find(c=>c.person_id===personId), [crm, personId])
  const lrsRow = useMemo(() => lrs.consumption.find(c=>c.person_id===personId), [lrs, personId])
  const scores = useMemo(() => computeScores(personId, crmRow, lrsRow), [personId, crmRow, lrsRow])

  const radarData = useMemo(() => LEVERS.map(l => ({ lever: l, score: scores[l]||0 })), [scores])

  return (
    <div className="min-h-screen p-6 bg-white text-slate-900">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Sales Productivity Demo</h1>
        <p className="text-sm text-slate-600">Pentagon radar with fake HRIS / CRM / LRS data</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="p-4 rounded-2xl border">
            <h2 className="font-semibold mb-3">Filters</h2>
            <div className="space-y-3">
              <label className="block text-sm">
                Geo
                <select className="w-full border rounded-lg px-2 py-1 mt-1" value={geo} onChange={e=>setGeo(e.target.value)}>
                  <option>All</option>
                  {geos.map(g => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                Manager
                <select className="w-full border rounded-lg px-2 py-1 mt-1" value={manager} onChange={e=>setManager(e.target.value)}>
                  <option>All</option>
                  {managers.map(m => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                Person
                <select className="w-full border rounded-lg px-2 py-1 mt-1" value={personId || ''} onChange={e=>setPersonId(e.target.value)}>
                  {people.map(p => <option key={p.person_id} value={p.person_id}>{p.name} ({p.role_type})</option>)}
                </select>
              </label>
            </div>
          </div>

          {selected && (
            <div className="p-4 rounded-2xl border">
              <h3 className="font-semibold mb-2">Person</h3>
              <div className="text-sm">
                <div><strong>{selected.name}</strong> — {selected.title}</div>
                <div>Manager: {selected.manager_name}</div>
                <div>Geo: {selected.geo}</div>
                <div>Role: {selected.role_type}</div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 p-4 rounded-2xl border">
          <RadarPentagon data={radarData} />
        </div>
      </div>
    </div>
  )
}
