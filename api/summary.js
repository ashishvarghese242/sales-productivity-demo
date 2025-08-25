// api/summary.js
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---------- helpers ----------
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
async function loadJson(req, relUrl) {
  try {
    const filePath = path.join(process.cwd(), "public", relUrl.replace(/^\//, ""));
    const txt = await fs.readFile(filePath, "utf8");
    return JSON.parse(txt);
  } catch {
    const base = resolveBaseUrl(req);
    const r = await fetch(`${base}${relUrl}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to fetch ${relUrl}: ${r.status}`);
    return await r.json();
  }
}

// ---------- scoring (matches your app) ----------
const LEVERS = [
  "Pipeline Discipline",
  "Deal Execution",
  "Value Co-Creation",
  "Capability Uptake",
  "Data Hygiene",
];
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

function computeScoresFromCRM(crmRow, lrsRow /* optional */) {
  let pd = 0, de = 0, vc = 0, cu = 0, dh = 0;

  if (crmRow) {
    const coverageScore = Math.min(100, (crmRow.pipeline_coverage / 3.5) * 100);
    const stalledScore = (1 - crmRow.stalled_ratio) * 100;
    const newOppsScore = Math.min(100, (crmRow.new_opps_last_30 / 6) * 100);
    pd = clamp(0.4 * coverageScore + 0.3 * stalledScore + 0.3 * newOppsScore);

    const winScore = (crmRow.win_rate || 0) * 100;
    const cycleScore = Math.max(0, 100 - ((crmRow.avg_cycle_days || 30) - 30) * 2);
    const m = crmRow.meddpicc || {};
    const meddpiccScore = (
      (m.metrics_pct || 0) + (m.econ_buyer_pct || 0) + (m.decision_criteria_pct || 0) +
      (m.decision_process_pct || 0) + (m.paper_process_pct || 0) + (m.identify_pain_pct || 0) +
      (m.champion_pct || 0) + (m.competition_pct || 0)
    ) / 8;
    de = clamp(0.4 * winScore + 0.3 * cycleScore + 0.3 * meddpiccScore);

    const v = crmRow.value_co || {};
    const bc = (v.business_case_rate || 0) * 100;
    const qi = (v.quantified_impact_rate || 0) * 100;
    const execMtg = Math.min(100, ((v.exec_meetings_90d || 0) / 8) * 100);
    const msp = (v.mutual_success_plan_rate || 0) * 100;
    vc = clamp(0.3 * bc + 0.3 * qi + 0.2 * execMtg + 0.2 * msp);

    const h = crmRow.hygiene || {};
    const ns = h.next_step_filled_pct || 0;
    const nm = h.next_meeting_set_pct || 0;
    const sd = h.stage_date_present_pct || 0;
    const fc = h.forecast_cat_set_pct || 0;
    const cd = h.close_date_valid_pct || 0;
    dh = clamp((ns + nm + sd + fc + cd) / 5);
  }

  if (lrsRow) {
    const comp = Math.min(100, ((lrsRow.completions || 0) / 8) * 100);
    const minutes = Math.min(100, ((lrsRow.minutes || 0) / 600) * 100);
    const recency = Math.max(0, 100 - (lrsRow.recency_days || 0) * 2);
    const assess = lrsRow.assessment_score_avg || 0;
    const certs = Math.min(100, (lrsRow.certifications || 0) * 25);
    const raw = 0.25 * comp + 0.25 * minutes + 0.2 * recency + 0.2 * assess + 0.1 * certs;
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
const composite = (s) =>
  Math.round((s["Pipeline Discipline"] + s["Deal Execution"] + s["Value Co-Creation"] + s["Capability Uptake"] + s["Data Hygiene"]) / 5);

const indexBy = (arr, key = "person_id") => Object.fromEntries(arr.map((r) => [r[key], r]));

// ---------- enablement overlay (same notion as UI) ----------
const LRS_OVERLAY_MULTIPLIER = 2.4;
function overlayForPeople(personIds, catalog, events) {
  const EVENT_WINDOW_DAYS = 120;
  if (!personIds?.length) {
    return { perLever: Object.fromEntries(LEVERS.map(l => [l, 0])), avg: 0 };
  }

  const leverAssets = {}; const leverDen = {};
  LEVERS.forEach(l => { leverAssets[l] = []; leverDen[l] = 0; });
  for (const a of catalog) {
    if (!LEVERS.includes(a.lever)) continue;
    if (a.is_fluff) continue;
    const impact = Number(a.impact_score || 0);
    leverAssets[a.lever].push({ asset_id: a.asset_id, impact });
    leverDen[a.lever] += impact;
  }

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - EVENT_WINDOW_DAYS);
  const completedBy = Object.fromEntries(personIds.map(id => [id, new Set()]));
  for (const e of events) {
    if (!completedBy[e.person_id]) continue;
    if (!e.completed) continue;
    if (e.date) {
      const d = new Date(e.date);
      if (isNaN(d.getTime()) || d < cutoff) continue;
    }
    completedBy[e.person_id].add(e.asset_id);
  }

  const sums = Object.fromEntries(LEVERS.map(l => [l, 0]));
  for (const pid of personIds) {
    for (const lever of LEVERS) {
      const den = leverDen[lever] || 0; if (!den) continue;
      let num = 0, hasAny = false;
      for (const a of leverAssets[lever]) {
        if (completedBy[pid].has(a.asset_id)) { num += a.impact; hasAny = true; }
      }
      let pct = Math.round((num * LRS_OVERLAY_MULTIPLIER / den) * 100);
      if (hasAny && pct > 0 && pct < 12) pct = 12;
      pct = Math.max(0, Math.min(100, pct));
      sums[lever] += pct;
    }
  }
  const perLever = {};
  LEVERS.forEach(l => perLever[l] = Math.round((sums[l] || 0) / personIds.length));
  const avg = Math.round(LEVERS.reduce((s, l) => s + (perLever[l] || 0), 0) / LEVERS.length);
  return { perLever, avg };
}

// ---------- handler ----------
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    if (!OPENAI_API_KEY) return json(res, 500, { error: "Missing OPENAI_API_KEY" });

    const body = await (async () => {
      const chunks = []; for await (const c of req) chunks.push(c);
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
    })();

    const { geo = "All", manager = "All", personId = "All" } = body;

    // Load data
    const hris = await loadJson(req, "/data/hris.json");
    const crm = await loadJson(req, "/data/crm_agg.json");
    let lrsAgg = { consumption: [] }; try { lrsAgg = await loadJson(req, "/data/lrs.json"); } catch {}
    const catalog = await loadJson(req, "/data/lrs_catalog.json");
    const events = await loadJson(req, "/data/lrs_activity_events.json");

    // Filter cohort
    const cohort = hris
      .filter(p => geo === "All" || p.geo === geo)
      .filter(p => manager === "All" || p.manager_name === manager);

    const crmBy = indexBy(crm);
    const lrsBy = indexBy(lrsAgg.consumption || []);

    // Score cohort
    const scored = cohort.map(p => {
      const s = computeScoresFromCRM(crmBy[p.person_id], lrsBy[p.person_id]);
      return { person: p, scores: s, comp: composite(s) };
    }).sort((a,b) => a.comp - b.comp);

    const n = scored.length || 1;
    const k = Math.max(1, Math.floor(n * 0.2));
    const top = scored.slice(-k);
    const topCompAvg = Math.round(top.reduce((s,v)=>s+v.comp,0)/k);

    // Selected target (person or cohort avg)
    let targetLabel = "this cohort";
    let targetRole = "";
    let targetManager = "";
    let targetGeo = geo;
    let targetScores = {};
    let targetComp = 0;
    let targetIds = [];

    if (personId !== "All") {
      const one = scored.find(x => x.person.person_id === personId);
      const p = one?.person || cohort.find(p => p.person_id === personId) || {};
      targetLabel = p.name || "Selected person";
      targetRole = p.role_type || "";
      targetManager = p.manager_name || "";
      targetGeo = p.geo || geo;
      targetScores = one ? one.scores : computeScoresFromCRM(crmBy[personId], lrsBy[personId]);
      targetComp = one ? one.comp : composite(targetScores);
      targetIds = [personId];
    } else {
      // cohort average
      targetScores = LEVERS.reduce((o,l)=> (o[l] = Math.round(scored.reduce((s,v)=>s+(v.scores[l]||0),0)/Math.max(1,n)), o), {});
      targetComp = Math.round(scored.reduce((s,v)=>s+v.comp,0)/Math.max(1,n));
      targetIds = cohort.map(p=>p.person_id);
    }

    // Enablement overlay comparison
    const selectedOverlay = overlayForPeople(targetIds, catalog, events);
    const topOverlay = overlayForPeople(top.map(x=>x.person.person_id), catalog, events);

    // Lever gaps (vs top)
    const leverTopAvg = LEVERS.reduce((o,l)=> (o[l] = Math.round(top.reduce((s,v)=>s+(v.scores[l]||0),0)/k), o), {});
    const leverDiffs = LEVERS.map(l => ({ lever: l, gap: (leverTopAvg[l] || 0) - (targetScores[l] || 0) }))
      .sort((a,b)=> b.gap - a.gap)
      .slice(0,2);

    const brief = {
      selection: {
        type: personId !== "All" ? "person" : "cohort",
        label: targetLabel,
        role: targetRole,
        manager: targetManager,
        geo: targetGeo
      },
      performance: {
        comp_selected: targetComp,
        comp_top_avg: topCompAvg,
        comp_gap_points: topCompAvg - targetComp
      },
      enablement_overlay_avg: {
        selected: selectedOverlay.avg,
        top: topOverlay.avg,
        gap_points: topOverlay.avg - selectedOverlay.avg
      },
      biggest_gaps_vs_top: leverDiffs, // top 2 levers
    };

    const system = `
You are a VP of Enablement. Write a crisp executive summary of 2–3 sentences, no bullets.
Mention the selection (person or cohort) and state whether performance is above/on-par/below the top baseline.
Comment on enablement consumption vs top and the implication (e.g., under-consumption, misalignment, or good correlation).
Finish with: "Use the chat below to dig deeper and take action."
`.trim();

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `DATA BRIEF:\n${JSON.stringify(brief, null, 2)}` }
      ],
    });

    const summary = completion.choices?.[0]?.message?.content?.trim() || "";
    return json(res, 200, { ok: true, summary, debug: brief });

  } catch (err) {
    console.error(err);
    return json(res, 500, { error: String(err?.message || err) });
  }
}
