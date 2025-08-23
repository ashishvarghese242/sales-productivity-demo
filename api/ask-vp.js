// api/ask-vp.js
// Serverless boardroom endpoint: loads your JSONs, computes KPIs, and asks OpenAI for a board-ready answer.

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

// Resolve a safe base URL to fetch static JSON if fs read fails
function resolveBaseUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

// Try fs first (for local dev), else fall back to HTTP fetch
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

// ----- Scoring logic (match your app) -----
const LEVERS = [
  "Pipeline Discipline",
  "Deal Execution",
  "Value Co-Creation",
  "Capability Uptake",
  "Data Hygiene",
];

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

function computeScoresFromCRM(crmRow, lrsRow /* optional legacy CU */) {
  let pd = 0, de = 0, vc = 0, cu = 0, dh = 0;

  if (crmRow) {
    // Pipeline Discipline
    const coverageScore = Math.min(100, (crmRow.pipeline_coverage / 3.5) * 100); // target ~3.5x
    const stalledScore = (1 - crmRow.stalled_ratio) * 100;
    const newOppsScore = Math.min(100, (crmRow.new_opps_last_30 / 6) * 100);
    pd = clamp(0.4 * coverageScore + 0.3 * stalledScore + 0.3 * newOppsScore);

    // Deal Execution
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

    // Value Co-Creation
    const v = crmRow.value_co || {};
    const bc = (v.business_case_rate || 0) * 100;
    const qi = (v.quantified_impact_rate || 0) * 100;
    const execMtg = Math.min(100, ((v.exec_meetings_90d || 0) / 8) * 100);
    const msp = (v.mutual_success_plan_rate || 0) * 100;
    vc = clamp(0.3 * bc + 0.3 * qi + 0.2 * execMtg + 0.2 * msp);

    // Data Hygiene
    const h = crmRow.hygiene || {};
    const ns = h.next_step_filled_pct || 0;
    const nm = h.next_meeting_set_pct || 0;
    const sd = h.stage_date_present_pct || 0;
    const fc = h.forecast_cat_set_pct || 0;
    const cd = h.close_date_valid_pct || 0;
    dh = clamp((ns + nm + sd + fc + cd) / 5);
  }

  // Capability Uptake (from legacy LRS agg if present)
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

// ---------------- Natural-language constraint parsing ----------------
function parseWindowDays(q) {
  if (!q) return null;
  const m = q.toLowerCase().match(/last\s+(\d+)\s*(day|days|week|weeks|month|months)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("week")) return n * 7;
  if (unit.startsWith("month")) return n * 30; // simple month ≈ 30d
  return null;
}

function parseConstraintsFromQuestion(q, hris) {
  if (!q) return { mode: "org", windowDays: null, geo: null, manager: null, personId: null, personName: null };
  const lower = q.toLowerCase();

  const geos = Array.from(new Set(hris.map(p => String(p.geo || "")).filter(Boolean)));
  const managers = Array.from(new Set(hris.map(p => String(p.manager_name || "")).filter(Boolean)));

  let geo = null, manager = null, personId = null, personName = null;
  // match person_id like P0xx
  const pidMatch = lower.match(/\b(p\d{3})\b/);
  if (pidMatch) {
    const pid = pidMatch[1].toUpperCase();
    if (hris.some(p => p.person_id === pid)) personId = pid;
  }

  // match person name (case-insensitive, whole word)
  if (!personId) {
    for (const p of hris) {
      const name = String(p.name || "");
      if (!name) continue;
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(q)) {
        personId = p.person_id;
        personName = p.name;
        break;
      }
    }
  }

  // geo
  for (const g of geos) {
    if (!g) continue;
    const re = new RegExp(`\\b${String(g).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(q)) { geo = g; break; }
  }

  // manager
  for (const m of managers) {
    if (!m) continue;
    const re = new RegExp(`\\b${String(m).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(q)) { manager = m; break; }
  }

  const windowDays = parseWindowDays(q);

  const mode = personId ? "person"
    : (geo || manager) ? "cohort"
    : "org";

  return { mode, windowDays, geo, manager, personId, personName };
}

// Content effectiveness: compare top vs bottom completions/minutes on impactful assets
function contentEffectiveness(hrisPeople, crm, catalog, events, windowDays /* may be null */) {
  const crmBy = indexBy(crm, "person_id");

  // Time filter on events if windowDays requested
  let filteredEvents = events;
  if (windowDays && Number.isFinite(windowDays)) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);
    filteredEvents = events.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return !isNaN(d.getTime()) && d >= cutoff;
    });
  }

  // Scores -> rank -> top/bottom
  const scored = hrisPeople.map((p) => {
    const s = computeScoresFromCRM(crmBy[p.person_id], null);
    return { id: p.person_id, comp: composite(s) };
  }).sort((a, b) => a.comp - b.comp);

  const n = scored.length;
  const k = Math.max(1, Math.floor(n * 0.2));
  const bottomIds = new Set(scored.slice(0, k).map(x => x.id));
  const topIds = new Set(scored.slice(-k).map(x => x.id));

  // Impactful assets only
  const impactfulSet = new Set(catalog.filter(a => !a.is_fluff).map(a => a.asset_id));
  const byAsset = {};
  for (const e of filteredEvents) {
    if (!impactfulSet.has(e.asset_id)) continue;
    if (!hrisPeople.some(p => p.person_id === e.person_id)) continue; // ensure in cohort
    const bucket = bottomIds.has(e.person_id) ? "bottom" : (topIds.has(e.person_id) ? "top" : "mid");
    byAsset[e.asset_id] ||= { title: e.title, lever: e.lever, top: {c:0,m:0}, bottom: {c:0,m:0}, mid: {c:0,m:0} };
    const b = byAsset[e.asset_id][bucket];
    b.c += (e.completed ? 1 : 0);
    b.m += (e.minutes || 0);
  }

  // Rank winners/laggards
  const scores = Object.entries(byAsset).map(([asset_id, v]) => {
    const topLift = v.top.c + v.top.m / 10;
    const bottomLift = v.bottom.c + v.bottom.m / 10;
    return { asset_id, title: v.title, lever: v.lever, lift: +(topLift - bottomLift).toFixed(2) };
  });

  const winners = [...scores].sort((a,b)=>b.lift-a.lift).slice(0,5);
  const laggards = [...scores].sort((a,b)=>a.lift-b.lift).slice(0,5);

  return { winners, laggards, cohortSizes: { top: k, bottom: k } };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Use POST with JSON body: { question }" });
    }

    if (!OPENAI_API_KEY) {
      return json(res, 500, { error: "Missing OPENAI_API_KEY environment variable." });
    }

    const body = await (async () => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      try { return JSON.parse(raw); } catch { return {}; }
    })();

    const { question = "" } = body;

    // Load data (full org, all history by default)
    const hris = await loadJson(req, "/data/hris.json");
    const crm = await loadJson(req, "/data/crm_agg.json");
    // Optional legacy LRS aggregate (for CU): tolerate missing file
    let lrsAgg = { consumption: [] };
    try { lrsAgg = await loadJson(req, "/data/lrs.json"); } catch {}

    const catalog = await loadJson(req, "/data/lrs_catalog.json");
    const events = await loadJson(req, "/data/lrs_activity_events.json");

    // Parse constraints from natural language
    const parsed = parseConstraintsFromQuestion(question, hris);

    // Build cohort
    let cohort = hris;
    if (parsed.mode === "cohort") {
      cohort = hris
        .filter(p => (parsed.geo ? p.geo === parsed.geo : true))
        .filter(p => (parsed.manager ? p.manager_name === parsed.manager : true));
    } else if (parsed.mode === "person") {
      cohort = hris.filter(p => p.person_id === parsed.personId);
    }
    const visibleIds = new Set(cohort.map(p => p.person_id));

    // Indexes
    const crmBy = indexBy(crm, "person_id");
    const lrsBy = indexBy(lrsAgg.consumption || [], "person_id");

    // Compute scores per person in cohort
    const scored = cohort.map(p => {
      const s = computeScoresFromCRM(crmBy[p.person_id], lrsBy[p.person_id]);
      return { person: p, scores: s, comp: composite(s) };
    }).sort((a,b) => a.comp - b.comp);

    // Top/Bottom cohorts
    const n = scored.length || 1;
    const k = Math.max(1, Math.floor(n * 0.2));
    const bottom = scored.slice(0, k);
    const top = scored.slice(-k);

    // Averages for the board
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

    // Overall composite summary
    const compAll = avg(scored.map(x => x.comp));
    const compTop = avg(top.map(x => x.comp));
    const compBottom = avg(bottom.map(x => x.comp));

    // Enablement content effectiveness (respect parsed.windowDays if specified; else all history)
    const eff = contentEffectiveness(cohort, crm, catalog, events, parsed.windowDays);

    // Build a compact “brief” for the model
    const brief = {
      parsed_constraints: {
        scope: parsed.mode,           // "org" | "cohort" | "person"
        geo: parsed.geo || null,
        manager: parsed.manager || null,
        person_id: parsed.personId || null,
        person_name: parsed.personName || null,
        window_days: parsed.windowDays || null,  // null = all history
        cohort_size: n
      },
      composites: { all: compAll, top: compTop, bottom: compBottom, cohort_bucket_size: k },
      levers: leverSummary,
      content_effectiveness: eff,
      reps_sample: scored.slice(0, 10).map(r => ({
        person_id: r.person.person_id,
        name: r.person.name,
        manager: r.person.manager_name,
        geo: r.person.geo,
        role: r.person.role_type,
        composite: r.comp
      }))
    };

    // Call OpenAI
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const system = `
You are the VP of Enablement in a board meeting.
Speak in concise, executive language. Structure answers as:
• Headline (1 line)
• 2–5 bullet proof points with numbers
• “So what” (impact/risk/decision)
If helpful, give a short “Do next” list (max 3 items).
Use ONLY the data I give you. Do not invent.
If constraints are parsed, honor them. If none, treat as org-wide and all history.
    `.trim();

    const user = `
Question: ${question || "Summarize enablement, productivity, and performance for this org."}

DATA BRIEF:
${JSON.stringify(brief, null, 2)}
    `.trim();

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
      debug: {
        parsed_constraints: brief.parsed_constraints,
        counts: { people: n, top: k, bottom: k }
      }
    });

  } catch (err) {
    console.error(err);
    return json(res, 500, { error: String(err?.message || err) });
  }
}
