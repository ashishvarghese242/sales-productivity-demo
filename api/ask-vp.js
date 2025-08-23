// api/ask-vp.js
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

function computeScoresFromCRM(crmRow, lrsRow) {
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

// --------- Simple parsing helpers (as before) ----------
function parseWindowDays(q) {
  if (!q) return null;
  const m = q.toLowerCase().match(/last\s+(\d+)\s*(day|days|week|weeks|month|months)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2];
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("week")) return n * 7;
  if (unit.startsWith("month")) return n * 30;
  return null;
}

function parseConstraintsFromQuestion(q, hris) {
  if (!q) return { mode: "org", windowDays: null, geo: null, manager: null, personId: null, personName: null };
  const lower = q.toLowerCase();

  const geos = Array.from(new Set(hris.map(p => String(p.geo || "")).filter(Boolean)));
  const managers = Array.from(new Set(hris.map(p => String(p.manager_name || "")).filter(Boolean)));

  let geo = null, manager = null, personId = null, personName = null;

  // explicit ID like P0xx
  const pidMatch = lower.match(/\b(p\d{3})\b/);
  if (pidMatch) {
    const pid = pidMatch[1].toUpperCase();
    if (hris.some(p => p.person_id === pid)) personId = pid;
  }

  // person name
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
  const mode = personId ? "person" : (geo || manager) ? "cohort" : "org";

  return { mode, windowDays, geo, manager, personId, personName };
}

// --------- NEW: Resolve references using threadCtx and current results ----------
function resolveReferences(question, parsed, ctx, hris, scored) {
  const q = (question || "").toLowerCase();
  const pronounRef = /\b(they|them|their|that person|he|she)\b/.test(q);
  const mentionsTop = /\b(top performer|best performer|highest performer)\b/.test(q);
  const mentionsBottom = /\b(bottom performer|lowest performer|worst performer)\b/.test(q);

  // If user explicitly named a person this turn, let parsed handle it.
  if (parsed.personId) {
    return {
      mode: "person",
      personId: parsed.personId,
      personName: parsed.personName || (hris.find(p => p.person_id === parsed.personId)?.name || null),
      windowDays: parsed.windowDays ?? null,
    };
  }

  // If they referred to top/bottom performer, pick from current scored list
  if (mentionsTop && scored.length) {
    const top = scored[scored.length - 1];
    return {
      mode: "person",
      personId: top.person.person_id,
      personName: top.person.name,
      windowDays: parsed.windowDays ?? null,
      resolvedFrom: "top-performer",
    };
  }
  if (mentionsBottom && scored.length) {
    const bottom = scored[0];
    return {
      mode: "person",
      personId: bottom.person.person_id,
      personName: bottom.person.name,
      windowDays: parsed.windowDays ?? null,
      resolvedFrom: "bottom-performer",
    };
  }

  // If pronoun and we have a focus person in thread context, use it
  if (pronounRef && ctx?.focus_person?.person_id) {
    const pid = ctx.focus_person.person_id;
    const p = hris.find(x => x.person_id === pid);
    if (p) {
      return {
        mode: "person",
        personId: p.person_id,
        personName: p.name,
        windowDays: parsed.windowDays ?? null,
        resolvedFrom: "threadCtx-pronoun",
      };
    }
  }

  // Fall back to the original parsed scope (org/cohort) with any time window
  if (parsed.mode === "cohort") {
    return { mode: "cohort", geo: parsed.geo, manager: parsed.manager, windowDays: parsed.windowDays ?? null };
  }
  return { mode: "org", windowDays: parsed.windowDays ?? null };
}

// --------- Person-focused enablement summary (for “what are THEY consuming?”) ----------
function personEnablementSummary(personId, events, catalog, windowDays /* may be null */) {
  const catBy = Object.fromEntries(catalog.map(a => [a.asset_id, a]));
  let filtered = events.filter(e => e.person_id === personId);

  if (windowDays && Number.isFinite(windowDays)) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - windowDays);
    filtered = filtered.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return !isNaN(d.getTime()) && d >= cutoff;
    });
  }

  const byLever = {};
  let completedCount = 0;
  let minutes = 0;
  const recent = [];

  for (const e of filtered) {
    const meta = catBy[e.asset_id] || { lever: e.lever, title: e.title, is_fluff: false };
    const lever = meta.lever || e.lever || "Unknown";
    byLever[lever] ||= { completed: 0, minutes: 0 };
    if (e.completed) {
      byLever[lever].completed += 1;
      completedCount += 1;
    }
    minutes += (e.minutes || 0);
    byLever[lever].minutes += (e.minutes || 0);

    if (e.completed && e.date) {
      recent.push({ date: e.date, title: meta.title || e.title || e.asset_id, lever });
    }
  }

  recent.sort((a,b)=> new Date(b.date) - new Date(a.date));
  const top5 = recent.slice(0,5);

  return { completedCount, minutes, byLever, recent: top5 };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Use POST with JSON body: { question, threadCtx? }" });
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

    const { question = "", threadCtx = {} } = body;

    // Load data (org-wide by default)
    const hris = await loadJson(req, "/data/hris.json");
    const crm = await loadJson(req, "/data/crm_agg.json");
    let lrsAgg = { consumption: [] };
    try { lrsAgg = await loadJson(req, "/data/lrs.json"); } catch {}
    const catalog = await loadJson(req, "/data/lrs_catalog.json");
    const events = await loadJson(req, "/data/lrs_activity_events.json");

    // Baseline: org-wide scored list (for “top/bottom performer” resolution)
    const crmBy = indexBy(crm, "person_id");
    const lrsBy = indexBy(lrsAgg.consumption || [], "person_id");

    const scoredOrg = hris
      .map(p => {
        const s = computeScoresFromCRM(crmBy[p.person_id], lrsBy[p.person_id]);
        return { person: p, scores: s, comp: composite(s) };
      })
      .sort((a,b)=> a.comp - b.comp);

    // Step 1: parse constraints from the current question
    const parsed = parseConstraintsFromQuestion(question, hris);

    // Step 2: resolve references using threadCtx + current scored list
    const resolved = resolveReferences(question, parsed, threadCtx, hris, scoredOrg);

    // Build cohort for this turn
    let cohort = hris;
    if (resolved.mode === "cohort") {
      cohort = hris
        .filter(p => (resolved.geo ? p.geo === resolved.geo : true))
        .filter(p => (resolved.manager ? p.manager_name === resolved.manager : true));
    } else if (resolved.mode === "person") {
      cohort = hris.filter(p => p.person_id === resolved.personId);
    }

    // Re-score within this cohort (used for top/bottom within cohort if asked)
    const scored = cohort
      .map(p => {
        const s = computeScoresFromCRM(crmBy[p.person_id], lrsBy[p.person_id]);
        return { person: p, scores: s, comp: composite(s) };
      })
      .sort((a,b)=> a.comp - b.comp);

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

    // If this turn is person-focused, pre-compute their enablement summary for the model
    let personFocus = null;
    if (resolved.mode === "person" && resolved.personId) {
      const p = hris.find(x => x.person_id === resolved.personId);
      if (p) {
        const en = personEnablementSummary(resolved.personId, events, catalog, resolved.windowDays);
        personFocus = {
          person_id: p.person_id,
          name: p.name,
          manager: p.manager_name,
          geo: p.geo,
          role: p.role_type,
          composite: scored.find(s => s.person.person_id === p.person_id)?.comp || null,
          enablement: en,
        };
      }
    }

    // Build brief for the model
    const brief = {
      resolved_scope: resolved,
      cohort_size: n,
      composites: { all: compAll, top: compTop, bottom: compBottom, bucket_size: k },
      levers: leverSummary,
      person_focus: personFocus, // null unless the turn is about a single person
      // small sample to cite names if needed
      sample: scored.slice(0, 10).map(r => ({
        person_id: r.person.person_id,
        name: r.person.name,
        manager: r.person.manager_name,
        geo: r.person.geo,
        role: r.person.role_type,
        composite: r.comp
      }))
    };

    // Maintain/return a tiny thread context so next turn can say “they”
    const newCtx = {
      ...threadCtx,
      // If this question asked about a person (explicitly or via “top performer”), remember them
      ...(personFocus
        ? { focus_person: { person_id: personFocus.person_id, name: personFocus.name } }
        : threadCtx?.focus_person
        ? { focus_person: threadCtx.focus_person }
        : {}),
      // Also handy: last computed top/bottom in this scope
      last_top: top.length ? { person_id: top[top.length - 1].person.person_id, name: top[top.length - 1].person.name } : null,
      last_bottom: bottom.length ? { person_id: bottom[0].person.person_id, name: bottom[0].person.name } : null,
    };

    // Ask OpenAI (executive style)
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const system = `
You are a boardroom-level VP of Enablement with Ph.D.-level mastery in instructional design, adult education, finance, program management, SaaS, certifications, and manufacturing. 
You possess elite analytical abilities, immediate access to best-in-class data, and deliver concise, actionable recommendations. 
Your insight spotlights root causes, gaps, risks, and opportunities with relentless precision. Every response translates complex challenges into targeted actions, maximizing measurable business impact. 
Trusted by CEOs and boards, your guidance is incisive and strategic, driving continuous optimization of talent, performance, COI, and ROI in dynamic enterprise environments.
• Headline (1 line)
• 2–5 bullet proof points with numbers
• “Brutal Truth” (impact/risk/decision)
Optionally: “Do next” (max 3, only if asked)
Use ONLY the data you have access to. Do not invent. Or Hallucinate.
Honor the resolved_scope: if it's a single person, talk about THAT person specifically.
If person_focus.enablement is present, cite the most relevant lever(s)/assets.
`.trim();

    const user = `
Question: ${question || "(no question provided)"}

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
      ctx: newCtx, // <-- return updated context so the next question can say “they”
      debug: { resolved_scope: resolved, counts: { people: n, top: k, bottom: k } }
    });

  } catch (err) {
    console.error(err);
    return json(res, 500, { error: String(err?.message || err) });
  }
}
