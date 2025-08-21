import React, { useEffect, useMemo, useState } from 'react'
import RadarPentagon from './components/RadarPentagon.jsx'

const LEVERS = [
  'Pipeline Discipline',
  'Deal Execution',
  'Value Co-Creation',
  'Capability Uptake',
  'Data Hygiene',
]

// ---- Demo mapping from LRS topics → levers (edit as you like) ----
const LEVER_TOPIC_MAP = {
  'Pipeline Discipline': ['Discovery', 'Industry'],
  'Deal Execution': ['Demo', 'Objection Handling', 'Negotiation', 'Proposal'],
  'Value Co-Creation': ['ROI', 'Industry'],
  'Capability Uptake': ['Discovery', 'Demo', 'Objection Handling', 'Proposal', 'Negotiation', 'Security', 'ROI', 'Industry'], // overall enablement breadth
  'Data Hygiene': ['Security'], // stand-in topic for CRM/process hygiene
}

// ------------------------------ Data hooks ------------------------------
function useData() {
  const [hris, setHris] = useState([])
  const [crm, setCrm] = useState([])
  const [lrs, setLrs] = useState({ catalog: [], consumption: [] })
  const [lrsEvents, setLrsEvents] = useState([])

  useEffect(() => {
    fetch('/data/hris.json').then((r) => r.json()).then(setHris)
    fetch('/data/crm_agg.json').then((r) => r.json()).then(setCrm)
    fetch('/data/lrs.json').then((r) => r.json()).then(setLrs)
    fetch('/data/lrs_events.json').then((r) => r.json()).then(setLrsEvents).catch(() => setLrsEvents([]))
  }, [])

  return { hris, crm, lrs, lrsEvents }
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

  // CAPABILITY UPTAKE (from LRS)
  let cu = 0
  if (lrsRow) {
    const comp = Math.min(100, (lrsRow.completions / 8) * 100)
    const minutes = Math.min(100, (lrsRow.minutes / 600) * 100) // 10h/mo cap
    const recency = Math.max(0, 100 - lrsRow.recency_days * 2) // fresher is better
    const assess = lrsRow.assessment_score_avg
    const certs = Math.min(100, lrsRow.certifications * 25)
    cu = Math.max(0, Math.min(100, Math.round(0.25 * comp + 0.25 * minutes + 0.2 * recency + 0.2 * assess + 0.1 * certs)))
  }

  // DATA HYGIENE
  let dh = 0
  if (crmRow) {
    const ns = crmRow.hygiene.next_step_filled_pct
    const nm = crmRow.hygiene.next_meeting_set_pct
    const sd = crmRow.hygiene.stage_date_present_pct
    const fc = crmRow.hygiene.forecast_cat_set_pct
    const cd = crmRow.hygiene.close_date_valid_pct
    dh = Math.max(0, Math.min(100, Math.round((ns + nm + sd + fc + cd) / 5)))
  }

  return {
    'Pipeline Discipline': pd,
    'Deal Execution': de,
    'Value Co-Creation': vc,
    'Capability Uptake': cu,
    'Data Hygiene': dh,
  }
}

// Helpers
function indexById(arr, key = 'person_id') {
  return Object.fromEntries(arr.map((r) => [r[key], r]))
}

function averageScoresForPeople(people, crmById, lrsById) {
  if (!people.length) {
    return {
      'Pipeline Discipline': 0,
      'Deal Execution': 0,
      'Value Co-Creation': 0,
      'Capability Uptake': 0,
      'Data Hygiene': 0,
    }
  }
  const sums = {
    'Pipeline Discipline': 0,
    'Deal Execution': 0,
    'Value Co-Creation': 0,
    'Capability Uptake': 0,
    'Data Hygiene': 0,
  }
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
  const comp =
    (s['Pipeline Discipline'] +
      s['Deal Execution'] +
      s['Value Co-Creation'] +
      s['Capability Uptake'] +
      s['Data Hygiene']) /
    5
  return comp
}

// ---- NEW: LRS consumption coverage per lever (0–100) ----
// Coverage = % of available assets (by mapped topics) that have any activity.
function lrsCoverageScores(personIds, lrsEvents, catalog) {
  // Build topic → asset_id[] from catalog
  const byTopicAssets = {}
  ;(catalog || []).forEach(a => {
    if (!byTopicAssets[a.topic]) byTopicAssets[a.topic] = new Set()
    byTopicAssets[a.topic].add(a.asset_id)
  })

  // For selected person set, build topic → consumedAssetIds
  const pidSet = new Set(personIds)
  const consumedByTopic = {}
  ;(lrsEvents || []).forEach(e => {
    if (!pidSet.has(e.person_id)) return
    const t = e.topic
    if (!consumedByTopic[t]) consumedByTopic[t] = new Set()
    consumedByTopic[t].add(e.asset_id)
  })

  const scores = {}
  LEVERS.forEach(lever => {
    const topics = LEVER_TOPIC_MAP
