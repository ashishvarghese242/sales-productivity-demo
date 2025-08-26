// /api/summary.js
// Executive 2–3 sentence summary for the selection in App.jsx (VP/C-level tone)

import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";

// ---------- Config ----------
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Utility: respond JSON
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function resolveBaseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

// Load JSON from /public (local) or fall back to deployed static URL
async function loadJson(req, relUrl) {
  try {
    const filePath = path.join(process.cwd(), "public", relUrl.replace(/^\//, ""));
    const txt = await fs.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch {
    const base = resolveBaseUrl(req);
    const url = `${base}${relUrl}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to fetch ${relUrl}: ${r.status}`);
    return await r.json();
  }
}

// ---------- Domain helpers (mirror the app) ----------
const LEVERS = [
  "Pipeline Discipline",
  "Deal Execution",
  "Value Co-Creation",
  "Capability Uptake",
  "Data Hygiene",
];
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

function computeScoresFromCRM(crmRow, lrsRow /* legacy CU optional */) {
  let pd = 0, de = 0, vc = 0, cu = 0, dh = 0;

  if (crmRow) {
    // Pipeline Discipline
    const coverageScore = Math.min(100, (crmRow.pipeline_coverage / 3.5) * 100);
    const stalledScore  = (1 - crmRow.stalled_ratio) * 100;
    const newOppsScore  = Math.min(100, (crmRow.new_opps_last_30 / 6) * 100);
    pd = clamp(0.4 * coverageScore + 0.3 * stalledScore + 0.3 * newOppsScore);

    // Deal Execution
    const winScore   = (crmRow.win_rate || 0) * 100;
    const cycleScore = Math.max(0, 100 - ((crmRow.avg_cycle_days || 30) - 30) * 2);
    const m = crmRow.meddpicc || {};
    const meddpiccScore =
      ((m.metrics_pct || 0) +
       (m.econ_buyer_pct || 0) +
       (m.decision_criteria_pct || 0) +
       (m.decision_process_pct || 0) +
       (m.paper_process_pct || 0) +
       (m.identify_pain_pct || 0) +
       (m.champion_pct || 0) +
       (m.competition_pct || 0)) / 8;
    de = clamp(0.4 * winScore + 0.3 * cycleScore + 0.3 * meddpiccScore);

    // Value Co-Creation
    const v = crmRow.value_co || {};
    const bc      = (v.business_case_rate || 0) * 100;
    const qi      = (v.quantified_impact_rate || 0) * 100;
    const execMtg = Math.min(100, ((v.exec_meetings_90d || 0) / 8) * 100);
    const msp     = (v.mutual_success_plan_rate || 0) * 100;
    vc = clamp(0.3 * bc + 0.3 * qi + 0.2 * execMtg + 0.2 * msp);

    // Data Hygiene
    const h  = crmRow.hygiene || {};
    const ns = h.next_step_filled_pct || 0;
    const nm = h.next_meeting_set_pct || 0;
    const sd = h.stage_date_present_pct || 0;
    const fc = h.forecast_cat_set_pct || 0;
    const cd = h.close_date_valid_pct || 0;
    dh = clamp((ns + nm + sd + fc + cd) / 5);
  }

  // Capability Uptake (legacy LRS aggregate, if present)
  if (lrsRow) {
    const comp    = Math.min(100, ((lrsRow.completions || 0) / 8) * 100);
    const minutes = Math.min(100, ((lrsRow.minutes || 0) / 600) * 100);
    const recency = Math.max(0, 100 - (lrsRow.recency_days || 0) * 2);
    const assess  = lrsRow.assessment_score_avg || 0;
    const certs   = Math.min(100, (lrsRow.certifications || 0) * 25);
    const raw     = 0.25 * comp + 0.25 * minutes + 0.2 * recency + 0.2 * assess + 0.1 * certs;
    const cuScore = clamp(raw);
    if (!Number.isNaN(cuScore)) cu = cuScore;
  }

  return {
    "Pipeline Discipline": pd,
    "Deal Execution": de,
    "Value Co-Creation": vc,
    "Capability Uptake": cu,
    "Data Hygiene": dh,
  };
}

function composite(s) {
  return Math.round(
    (s["Pipeline Discipline"] +
     s["Deal Execution"] +
     s["Value Co-Creation"] +
     s["Capability Uptake"] +
     s["Data Hygiene"]) / 5
  );
}

function indexBy(arr, key = "person_id") {
  const o = {};
  for (const r of arr) o[r[key]] = r;
  return o;
}

// Impact-weighted enablement coverage per lever, averaged across personIds
function lrsImpactCoverageForPeople(personIds, catalog, events) {
  const EVENT_WINDOW_DAYS = 120; // keep consistent with UI feel
  if (!personIds?.length || !catalog?.length) {
    return Object.fromEntries(LEVERS.map(l => [l, 0]));
  }

  // Denominator per lever (exclude fluff)
  const leverDenom = Object.fromEntries(LEVERS.map(l => [l, 0]));
  const assetsByLever = Object.fromEntries(LEVERS.map(l => [l, []]));
  for (const a of catalog) {
    if (!LEVERS.includes(a.lever)) continue;
    if (a.is_fluff) continue;
    const impact = Number(a.impact_score || 0);
    leverDenom[a.lever] += impact;
    assetsByLever[a.lever].push({ asset_id: a.asset_id, impact });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EVENT_WINDOW_DAYS);

  // Which assets each person completed recently
  const completedBy = {};
  for (const pid of personIds) completedBy[pid] = new Set();
  for (const e of events) {
    if (!completedBy[e.person_id]) continue;
    if (!e.completed) continue;
    if (e.date) {
      const d = new Date(e.date);
      if (isNaN(d.getTime())) continue;
      if (d < cutoff) continue;
    }
    completedBy[e.person_id].add(e.asset_id);
  }

  const LRS_OVERLAY_MULTIPLIER = 2.4; // same as UI
  const sums = Object.fromEntries(LEVERS.map(l => [l, 0]));
  for (const pid of personIds) {
    for (const lever of LEVERS) {
      const denom = leverDenom[lever] || 0;
      if (denom === 0) continue;
      let num = 0, hasAny = false;
      for (const a of assetsByLever[lever]) {
        if (completedBy[pid].has(a.asset_id)) {
          num += a.impact;
          hasAny = true;
        }
      }
      let pct = Math.round((num * LRS_OVERLAY_MULTIPLIER / denom) * 100);
      if (hasAny && pct > 0 && pct < 12) pct = 12; // minimum visible shade when present
      pct = Math.max(0, Math.min(100, pct));
      sums[lever] += pct;
    }
  }

  const avg = {};
  for (const lever of LEVERS) {
    avg[lever] = Math.round((sums[lever] || 0) / personIds.length);
  }
  return avg;
}

// ---------- API handler ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Use POST with JSON body: { geo, manager, personId }" });
    }

    if (!OPENAI_API_KEY) {
      return json(res, 500, { error: "Missing OPENAI_API_KEY environment variable." });
    }

    // Read body
    const body = await (async () => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      try { return JSON.parse(raw); } catch { return {}; }
    })();

    const { geo = "All", manager = "All", personId = "All" } = body;

    // Load data
    const hris     = await loadJson(req, "/data/hris.json");
    const crm      = await loadJson(req, "/data/crm_agg.json");
    let   lrsAgg   = { consumption: [] };
    try { lrsAgg   = await loadJson(req, "/data/lrs.json"); } catch {}
    const catalog  = await loadJson(req, "/data/lrs_catalog.json");
    const events   = await loadJson(req, "/data/lrs_activity_events.json");

    // Filter people for selection
    const selectedPeople = hris
      .filter(p => geo === "All" || p.geo === geo)
      .filter(p => manager === "All" || p.manager_name === manager)
      .filter(p => personId === "All" || p.person_id === personId);

    if (selectedPeople.length === 0) {
      return json(res, 200, { summary: "No people match the current selection." });
    }

    const crmBy = indexBy(crm, "person_id");
    const lrsBy = indexBy(lrsAgg.consumption || [], "person_id");

    // Compute scores + composites
    const scored = selectedPeople.map(p => {
      const s = computeScoresFromCRM(crmBy[p.person_id], lrsBy[p.person_id]);
      return { person: p, scores: s, comp: composite(s) };
    }).sort((a, b) => a.comp - b.comp);

    // Top/Bottom within selection (for baseline context)
    const n = scored.length;
    const k = Math.max(1, Math.floor(n * 0.2));
    const top    = scored.slice(-k);
    const bottom = scored.slice(0,  k);

    const avg = (arr) => Math.round(arr.reduce((s,v)=>s+v,0) / Math.max(1, arr.length));
    const compAll    = avg(scored.map(x => x.comp));
    const compTop    = avg(top.map(x => x.comp));
    const compBottom = avg(bottom.map(x => x.comp));

    // Enablement overlay (impact-weighted coverage by lever) for the selection
    const personIds = selectedPeople.map(p => p.person_id);
    const enablementByLever = lrsImpactCoverageForPeople(personIds, catalog, events);

    // Performance avg by lever for the selection
    const perfAvgByLever = Object.fromEntries(
      LEVERS.map(l => [l, avg(scored.map(x => x.scores[l] || 0))])
    );

    // Simple signals of alignment/misalignment per lever
    const leverSignals = {};
    for (const lever of LEVERS) {
      const perf = perfAvgByLever[lever] || 0;
      const enab = enablementByLever[lever] || 0;

      let signal = "neutral";
      if (perf < 65 && enab < 30) signal = "under-enabled";
      else if (perf < 65 && enab >= 30) signal = "training-ineffective-or-misaligned";
      else if (perf >= 75 && enab >= 30) signal = "working";

      leverSignals[lever] = { perf, enab, signal };
    }

    // Personalization label
    let who = "this cohort";
    if (personId !== "All" && scored.length === 1) {
      const p = scored[0].person;
      who = `${p.name}, ${p.role_type} under ${p.manager_name}`;
    } else if (geo !== "All" || manager !== "All") {
      who = `${geo !== "All" ? geo : "All geos"}${manager !== "All" ? ` · ${manager}` : ""}`.replace(/^All geos · /, "");
    }

    // Build a tight brief for the model
    const brief = {
      selection: { label: who, counts: { people: n, top_k: k } },
      composite: { all: compAll, top: compTop, bottom: compBottom },
      levers: LEVERS.map(l => ({
        lever: l,
        performance_avg: perfAvgByLever[l] || 0,
        enablement_impact_covg: enablementByLever[l] || 0,
        signal: leverSignals[l].signal
      })),
    };

    // Prompt for 2–3 sentence executive summary with action
    const system = `
You are a VP of Enablement with years of experience and Ph. D. holder in performance gap analysis addressing executives. 
Write a crisp 2–3 sentence summary: 
1) Say what the selection is (person or cohort) and the *story* (e.g., strengths/gaps).
2) Compare performance vs enablement only if it supports the story (alignment or misalignment).
3) End with 1 clear recommended action for impact (coach/invest/remove/redirect), not a list.
Do NOT invent. Do not restate too many numbers; pick only those that support the narrative. Recommend using the chat below for more insigts.
`.trim();

    const user = `
DATA BRIEF (selection-level):
${JSON.stringify(brief, null, 2)}

Write the summary now. Avoid buzzwords. Action must be specific.
`.trim();

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user   },
      ],
      temperature: 0.2,
    });

    const summary =
      completion.choices?.[0]?.message?.content?.trim() ||
      "On track overall; no acute enablement or performance signal. Monitor next cycle.";

    return json(res, 200, { summary });

  } catch (err) {
    console.error(err);
    return json(res, 500, { error: String(err?.message || err) });
  }
}
