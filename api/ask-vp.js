// api/ask-vp.js
// Serverless boardroom endpoint: loads your JSONs, computes KPIs, and asks OpenAI with adaptive formatting.

import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";

// ---------- Config ----------
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ---------- Helpers ----------
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
    const url = `${base}${relUrl}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Failed to fetch ${relUrl}: ${r.status}`);
    return await r.json();
  }
}

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

// Content effectiveness (unchanged)
function contentEffectiveness(hris, crm, catalog, events) {
  const crmBy = indexBy(crm, "person_id");

  const scored = hris.map((p) => {
    const s = computeScoresFromCRM(crmBy[p.person_id], null);
    return { id: p.person_id, comp: composite(s) };
  }).sort((a, b) => a.comp - b.comp);

  const n = scored.length;
  const k = Math.max(1, Math.floor(n * 0.2));
  const bottomIds = new Set(scored.slice(0, k).map(x => x.id));
  const topIds = new Set(scored.slice(-k).map(x => x.id));

  const impactfulSet = new Set(catalog.filter(a => !a.is_fluff).map(a => a.asset_id));
  const byAsset = {};
  for (const e of events) {
    if (!impactfulSet.has(e.asset_id)) continue;
    const bucket = bottomIds.has(e.person_id) ? "bottom" : (topIds.has(e.person_id) ? "top" : "mid");
    byAsset[e.asset_id] ||= { title: e.title, lever: e.lever, top: {c:0,m:0}, bottom: {c:0,m:0}, mid: {c:0,m:0} };
    const b = byAsset[e.asset_id][bucket];
    b.c += (e.completed ? 1 : 0);
    b.m += (e.minutes || 0);
  }

  const scores = Object.entries(byAsset).map(([asset_id, v]) => {
    const topLift = v.top.c + v.top.m / 10;
    const bottomLift = v.bottom.c + v.bottom.m / 10;
    return { asset_id, title: v.title, lever: v.lever, lift: +(topLift - bottomLift).toFixed(2) };
  });

  const winners = [...scores].sort((a,b)=>b.lift-a.lift).slice(0,5);
  const laggards = [...scores].sort((a,b)=>a.lift-b.lift).slice(0,5);

  return { winners, laggards, cohortSizes: { top: k, bottom: k } };
}

// ---------- NEW: simple intent detector ----------
function inferStyle(question) {
  const q = (question || "").toLowerCase();

  // list/lookup requests => plain list/table
  const listRe = /(list|show|which|give me|display)\s+(the\s+)?(courses|training|assets|catalog|content|people|reps|names)/i;
  if (listRe.test(q)) return "list";

  // exec/board ask => headline/bullets
  const execRe = /(exec|board|summary|summarize|brief|story|gaps?|so what|recommend|priorit(y|ies)|where.+roi)/i;
  if (execRe.test(q)) return "exec";

  // otherwise minimal direct answer
  return "direct";
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Use POST with JSON body: { question, geo, manager, personId }" });
    }
    if (!OPENAI_API_KEY) {
      return json(res, 500, { error: "Missing OPENAI_API_KEY environment variable." });
    }

    // Parse body
    const body = await (async () => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      try { return JSON.parse(raw); } catch { return {}; }
    })();

    const { question = "", geo = "All", manager = "All", personId = "All" } = body;

    // Load data
    const hris = await loadJson(req, "/data/hris.json");
    const crm = await loadJson(req, "/data/crm_agg.json");
    let lrsAgg = { consumption: [] };
    try { lrsAgg = await loadJson(req, "/data/lrs.json"); } catch {}

    const catalog = await loadJson(req, "/data/lrs_catalog.json");
    const events  = await loadJson(req, "/data/lrs_activity_events.json");

    // Filters (Geo / Manager / Person)
    const people = hris
      .filter(p => geo === "All" || p.geo === geo)
      .filter(p => manager === "All" || p.manager_name === manager);

    const visiblePeople = personId === "All" ? people : people.filter(p => p.person_id === personId);
    const visibleIds = new Set(visiblePeople.map(p => p.person_id));

    const crmBy = indexBy(crm, "person_id");
    const lrsBy = indexBy(lrsAgg.consumption || [], "person_id");

    // Compute and rank
    const scored = visiblePeople.map(p => {
      const s = computeScoresFromCRM(crmBy[p.person_id], lrsBy[p.person_id]);
      return { person: p, scores: s, comp: composite(s) };
    }).sort((a,b) => a.comp - b.comp);

    const n = scored.length || 1;
    const k = Math.max(1, Math.floor(n * 0.2));
    const bottom = scored.slice(0, k);
    const top = scored.slice(-k);

    const avg = (arr) => Math.round(arr.reduce((s,v)=>s+v,0) / Math.max(1, arr.length));
    const leverAvg = (arr, lever) => avg(arr.map(x => x.scores[lever] || 0));
    const leverSummary = Object.fromEntries(
      LEVERS.map(l => [l, {
        avg_all: leverAvg(scored, l),
        avg_top: leverAvg(top, l),
        avg_bottom: leverAvg(bottom, l),
        gap_top_vs_bottom: Math.max(0, leverAvg(top, l) - leverAvg(bottom, l))
      }])
    );

    const compAll = avg(scored.map(x => x.comp));
    const compTop = avg(top.map(x => x.comp));
    const compBottom = avg(bottom.map(x => x.comp));

    const eff = contentEffectiveness(visiblePeople, crm, catalog, events);

    // Pick a primary_subject to resolve pronouns like “they/this person”
    let primary = null;
    if (personId !== "All") {
      primary = visiblePeople.find(p => p.person_id === personId) || null;
    } else {
      // top performer in current view
      const topOne = scored[scored.length - 1];
      primary = topOne ? topOne.person : null;
    }

    const brief = {
      filters: { geo, manager, personId, visible_count: n },
      composites: { all: compAll, top: compTop, bottom: compBottom, cohort_size: k },
      levers: leverSummary,
      content_effectiveness: eff,
      primary_subject: primary ? {
        person_id: primary.person_id,
        name: primary.name,
        manager: primary.manager_name,
        geo: primary.geo,
        role: primary.role_type,
      } : null,
      reps: scored.slice(0, 10).map(r => ({
        person_id: r.person.person_id,
        name: r.person.name,
        manager: r.person.manager_name,
        geo: r.person.geo,
        role: r.person.role_type,
        composite: r.comp
      }))
    };

    // ---------- Adaptive prompt ----------
    const style = inferStyle(question);

    const baseRules = `
You are the VP of Enablement. Use ONLY the provided data brief. Be precise and avoid fluff.
If the user uses pronouns (e.g., "they/this person"), assume they refer to primary_subject in the brief when present.
Never repeat boilerplate. Keep answers short and fit the user's intent.
`.trim();

    const styleRules = {
      exec: `
FORMAT: Board-ready.
- Headline (1 short line)
- 2–5 bullet proof points with numbers
- "So what" (impact/decision)
If helpful, include a tiny "Do next" (max 3 items).
`.trim(),
      list: `
FORMAT: Plain list or compact markdown table ONLY (no headline, no bullets section, no "so what").
Return just the items requested (e.g., titles/IDs/levers). No extra commentary.
`.trim(),
      direct: `
FORMAT: Direct answer in 1–4 sentences, no headline, no boilerplate.
If the user asked to "list" something, return a tight bullet list.
`.trim()
    };

    const system = `${baseRules}\n\n${styleRules[style]}`;

    const user = `
STYLE: ${style.toUpperCase()}

QUESTION:
${question || "Summarize enablement, productivity, and performance for this view."}

DATA BRIEF:
${JSON.stringify(brief, null, 2)}
`.trim();

    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    });

    const answer = completion.choices?.[0]?.message?.content || "No answer generated.";
    return json(res, 200, {
      ok: true,
      model: MODEL,
      answer,
      debug: { style, counts: { people: n, top: k, bottom: k } }
    });

  } catch (err) {
    console.error(err);
    return json(res, 500, { error: String(err?.message || err) });
  }
}
