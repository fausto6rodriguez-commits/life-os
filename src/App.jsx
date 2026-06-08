import React, { useState, useRef, useEffect, useCallback } from "react";

// Inject Inter font
if (typeof document !== "undefined" && !document.getElementById("inter-font")) {
  const link = document.createElement("link");
  link.id = "inter-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
  document.head.appendChild(link);
}

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SUPA_URL = "https://qghuysyxvjukiwapbijh.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnaHV5c3l4dmp1a2l3YXBiaWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NjAzODgsImV4cCI6MjA5NTMzNjM4OH0.dMmv4TzmVXU-eKRTuoKdFG8D2v1Psb9rqyVHuRLkfdo";

const supa = {
  async from(table) {
    const base = `${SUPA_URL}/rest/v1/${table}`;
    const headers = {
      "apikey": SUPA_KEY,
      "Authorization": `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    };
    return {
      async select(query = "*") {
        const res = await fetch(`${base}?select=${query}`, { headers });
        return res.json();
      },
      async upsert(data) {
        const res = await fetch(base, {
          method: "POST",
          headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(Array.isArray(data) ? data : [data]),
        });
        return res.json();
      },
      async delete(match) {
        const params = Object.entries(match).map(([k,v]) => `${k}=eq.${encodeURIComponent(v)}`).join("&");
        const res = await fetch(`${base}?${params}`, { method: "DELETE", headers });
        return res.ok;
      },
      async deleteIn(field, values) {
        if (!values.length) return true;
        const params = `${field}=in.(${values.map(v => encodeURIComponent(v)).join(",")})`;
        const res = await fetch(`${base}?${params}`, { method: "DELETE", headers });
        return res.ok;
      },
    };
  }
};

// Delete a record from a Supabase table by id
async function deleteFromDb(table, id) {
  try {
    await (await supa.from(table)).delete({ id });
  } catch(e) { console.error(`Delete from ${table} failed:`, e); }
}

// Save entire domain state to Supabase
async function saveDomainToDb(domain) {
  try {
    const result = await (await supa.from("domains")).upsert({
      id: domain.id, rating: domain.rating,
      crm_stages: domain.crmStages || null,
      projects: domain.id === "work" ? (domain.projects || []) : null,
    });
    if (domain.id === "work") {
      console.log("Saved projects to DB:", (domain.projects||[]).length, "projects", result);
    }

    if (domain.goals?.length) {
      await (await supa.from("goals")).upsert(domain.goals.map(g => ({
        id: g.id, domain_id: domain.id, text: g.text,
        quarter: g.quarter, progress: g.progress,
        pillar: g.pillar || null, krs: g.krs || [],
      })));
    }
    if (domain.kpis?.length) {
      await (await supa.from("kpis")).upsert(domain.kpis.map(k => ({
        id: k.id, domain_id: domain.id, label: k.label,
        value: k.value, unit: k.unit || null,
        delta: k.delta || null, pillar: k.pillar || null,
      })));
    }
    if (domain.activities?.length) {
      await (await supa.from("activities")).upsert(domain.activities.map(a => ({
        id: a.id, domain_id: domain.id, text: a.text,
        days: a.days || [], time: a.time || null,
        duration: a.duration || 30, pillar: a.pillar || null,
      })));
    }

    if (domain.id === "work") {
      // Sync todos — upsert all, then delete any in DB not in current list
      const todoDb = await supa.from("todos");
      if (domain.todos?.length) {
        await todoDb.upsert(domain.todos.map(t => ({
          id: t.id, text: t.text, horizon: t.horizon,
          duration: t.duration || "30min",
          project: t.project || null,
          contact_id: t.contactId || null,
          done: t.done || false,
        })));
      }
      // Delete todos removed from state
      const allTodosDb = await todoDb.select("id");
      if (Array.isArray(allTodosDb)) {
        const currentIds = new Set((domain.todos||[]).map(t => t.id));
        const toDelete = allTodosDb.filter(r => !currentIds.has(r.id)).map(r => r.id);
        if (toDelete.length) await todoDb.deleteIn("id", toDelete);
      }

      if (domain.contacts?.length) {
        await (await supa.from("contacts")).upsert(domain.contacts.map(c => ({
          id: c.id, name: c.name, company: c.company || null,
          role: c.role || null, stage: c.stage || "prospect",
          last_contact: c.lastContact || null,
          email: c.email || null, phone: c.phone || null,
          linkedin: c.linkedin || null, personal: c.personal || null,
          notes: c.notes || null, ai_summary: c.aiSummary || null,
        })));
      }
      // Delete contacts removed from state
      const contactsDb = await (await supa.from("contacts")).select("id");
      if (Array.isArray(contactsDb)) {
        const currentIds = new Set((domain.contacts||[]).map(c => c.id));
        const toDelete = contactsDb.filter(r => !currentIds.has(r.id)).map(r => r.id);
        if (toDelete.length) await (await supa.from("contacts")).deleteIn("id", toDelete);
      }

      if (domain.calls?.length) {
        await (await supa.from("calls")).upsert(domain.calls.map(cl => ({
          id: cl.id, contact_id: cl.contactId,
          date: cl.date, notes: cl.notes,
        })));
      }
      // Delete calls removed from state
      const callsDb = await (await supa.from("calls")).select("id");
      if (Array.isArray(callsDb)) {
        const currentIds = new Set((domain.calls||[]).map(cl => cl.id));
        const toDelete = callsDb.filter(r => !currentIds.has(r.id)).map(r => r.id);
        if (toDelete.length) await (await supa.from("calls")).deleteIn("id", toDelete);
      }
    }
  } catch (e) {
    console.error("Save to DB failed:", e);
  }
}

// Load all data from Supabase and merge into DOMAINS
async function loadFromDb() {
  try {
    const [
      domainsDb, goalsDb, kpisDb, activitiesDb,
      todosDb, contactsDb, callsDb
    ] = await Promise.all([
      (await supa.from("domains")).select("*"),
      (await supa.from("goals")).select("*"),
      (await supa.from("kpis")).select("*"),
      (await supa.from("activities")).select("*"),
      (await supa.from("todos")).select("*"),
      (await supa.from("contacts")).select("*"),
      (await supa.from("calls")).select("*"),
    ]);

    return (d) => {
      const dbDomain = Array.isArray(domainsDb) ? domainsDb.find(x => x.id === d.id) : null;
      const dbGoals = Array.isArray(goalsDb) ? goalsDb.filter(x => x.domain_id === d.id) : [];
      const dbKpis = Array.isArray(kpisDb) ? kpisDb.filter(x => x.domain_id === d.id) : [];
      const dbActivities = Array.isArray(activitiesDb) ? activitiesDb.filter(x => x.domain_id === d.id) : [];

      const merged = { ...d };
      if (dbDomain) {
        merged.rating = dbDomain.rating;
        if (dbDomain.crm_stages) merged.crmStages = dbDomain.crm_stages;
        if (dbDomain.projects)   merged.projects   = dbDomain.projects;
        if (d.id === "work") console.log("Loaded from DB:", { rating: dbDomain.rating, projects: dbDomain.projects?.length, crm_stages: dbDomain.crm_stages });
      }
      if (dbGoals.length) merged.goals = dbGoals.map(g => ({
        id: g.id, text: g.text, quarter: g.quarter,
        progress: g.progress, pillar: g.pillar,
        krs: g.krs || [],
      }));
      if (dbKpis.length) merged.kpis = dbKpis.map(k => ({
        id: k.id, label: k.label, value: k.value,
        unit: k.unit, delta: k.delta, pillar: k.pillar,
      }));
      if (dbActivities.length) merged.activities = dbActivities.map(a => ({
        id: a.id, text: a.text, days: a.days || [],
        time: a.time, duration: a.duration, pillar: a.pillar,
      }));

      if (d.id === "work") {
        if (Array.isArray(todosDb) && todosDb.length) {
          merged.todos = todosDb.map(t => ({
            id: t.id, text: t.text, horizon: t.horizon,
            duration: t.duration, project: t.project,
            contactId: t.contact_id, done: t.done,
          }));
        }
        if (Array.isArray(contactsDb) && contactsDb.length) {
          merged.contacts = contactsDb.map(c => ({
            id: c.id, name: c.name, company: c.company,
            role: c.role, stage: c.stage,
            lastContact: c.last_contact,
            email: c.email, phone: c.phone,
            linkedin: c.linkedin, personal: c.personal,
            notes: c.notes, aiSummary: c.ai_summary,
          }));
        }
        if (Array.isArray(callsDb) && callsDb.length) {
          merged.calls = callsDb.map(cl => ({
            id: cl.id, contactId: cl.contact_id,
            date: cl.date, notes: cl.notes,
          }));
        }
      }
      return merged;
    };
  } catch (e) {
    console.error("Load from DB failed:", e);
    return null;
  }
}

const C = {
  bg:        "#f1f5f9",
  surface:   "#ffffff",
  border:    "#e2e8f0",
  borderMid: "#cbd5e1",
  navy:      "#0f172a",
  caqi:      "#0d9488",
  caqiLight: "#f0fdfa",
  ink:       "#0f172a",
  inkMid:    "#334155",
  inkLight:  "#64748b",
  inkFaint:  "#94a3b8",
  green:     "#059669",
  red:       "#dc2626",
  gold:      "#d97706",
  shadow:    "0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.06)",
  shadowMd:  "0 4px 6px rgba(15,23,42,0.07), 0 2px 4px rgba(15,23,42,0.06)",
};

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Body pillars
const BODY_PILLARS = [
  { id: "sleep",    label: "Sleep",    desc: "Rest & recovery through the night" },
  { id: "movement", label: "Movement", desc: "Training, sport, endurance" },
  { id: "nutrition",label: "Nutrition",desc: "Fuel — what and when you eat" },
  { id: "recovery", label: "Recovery", desc: "Stretching, rest days, bodywork" },
  { id: "health",   label: "Health",   desc: "Preventive care, medical, monitoring" },
];

const DOMAINS = [
  {
    id: "body", label: "Body", glyph: "◎",
    question: "Am I well?",
    color: "#0d9488", colorLight: "#f0fdfa",
    identity: "I treat my body as a precision instrument. Physical integrity is the foundation of everything else.",
    pillars: BODY_PILLARS,
    goals: [
      { id: "bg1", text: "Complete first marathon", quarter: "Q3", progress: 35, pillar: "movement",
        krs: ["16-week plan with < 2 missed long runs", "Race registered and completed by Nov 30", "Average 40+ mi/wk during peak block"] },
      { id: "bg2", text: "Build sleep as a discipline", quarter: "Q2", progress: 60, pillar: "sleep",
        krs: ["7.5+ hrs average per night", "No screens after 10pm on 5 nights/wk", "Wake time consistent within 30 min, 6 days/wk"] },
      { id: "bg3", text: "Establish nutrition protocol", quarter: "Q3", progress: 20, pillar: "nutrition",
        krs: ["Define fueling protocol for training days", "Alcohol-free weekdays this quarter", "Hydration — 2L minimum daily"] },
      { id: "bg4", text: "Injury prevention practice", quarter: "Q2", progress: 40, pillar: "recovery",
        krs: ["Stretch or mobility work 4x/wk", "Rest days respected — no running through pain", "Book one sports massage per month"] },
      { id: "bg5", text: "Annual health baseline", quarter: "Q2", progress: 80, pillar: "health",
        krs: ["Full bloodwork done", "Resting HR and HRV tracked weekly", "GP checkup completed"] },
    ],
    kpis: [
      { id: "bk1", label: "Weekly miles",   value: "22", unit: "mi",  delta: "+4",  pillar: "movement" },
      { id: "bk2", label: "Sleep avg",      value: "7.2",unit: "hrs", delta: "+0.3",pillar: "sleep" },
      { id: "bk3", label: "Gym sessions",   value: "3",  unit: "/wk", delta: null,  pillar: "movement" },
      { id: "bk4", label: "Energy",         value: "4",  unit: "/5",  delta: null,  pillar: "sleep" },
      { id: "bk5", label: "Alcohol-free",   value: "5",  unit: "days",delta: null,  pillar: "nutrition" },
      { id: "bk6", label: "Mobility sessions",value:"3", unit: "/wk", delta: null,  pillar: "recovery" },
      { id: "bk7", label: "Resting HR",     value: "52", unit: "bpm", delta: "-2",  pillar: "health" },
      { id: "bk8", label: "Hydration",      value: "2.1",unit: "L/d", delta: null,  pillar: "nutrition" },
    ],
    activities: [
      { id: "ba1", text: "Morning run",        days: ["Mon","Wed","Fri","Sun"], pillar: "movement", time: "06:00", duration: 60 },
      { id: "ba2", text: "Gym — strength",     days: ["Tue","Thu"],            pillar: "movement", time: "06:30", duration: 60 },
      { id: "ba3", text: "No screens by 10pm", days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], pillar: "sleep", time: "22:00", duration: 30 },
      { id: "ba4", text: "Mobility / stretch", days: ["Mon","Wed","Fri"],      pillar: "recovery", time: "07:30", duration: 30 },
      { id: "ba5", text: "Prep food / meal",   days: ["Sun","Wed"],            pillar: "nutrition", time: "18:00", duration: 60 },
    ],
    rating: 4,
  },
  {
    id: "mind", label: "Mind", glyph: "◈",
    question: "Am I growing?",
    color: "#3b82f6", colorLight: "#eff6ff",
    identity: "I read widely, think slowly, and resist reactive consumption. I build mental models, not just opinions.",
    pillars: null,
    goals: [
      { id: "mg1", text: "Read 15 books this year", quarter: "Q4", progress: 53,
        krs: ["15 books by Dec 31 across 3+ genres", "One-page reflection on 6 of them", "Feed consumption to 2 windows/day"] },
      { id: "mg2", text: "Develop one new mental framework", quarter: "Q2", progress: 30,
        krs: ["Identify the domain by end of month 1", "Read 2 primary sources", "Apply to one real decision and write it up"] },
    ],
    kpis: [
      { id: "mk1", label: "Books (YTD)",    value: "8",  unit: "",    delta: "+1"  },
      { id: "mk2", label: "Reading hrs",    value: "4.5",unit: "/wk", delta: null  },
      { id: "mk3", label: "Ideas captured", value: "6",  unit: "/wk", delta: null  },
      { id: "mk4", label: "Deep focus",     value: "3",  unit: "/5",  delta: null  },
    ],
    activities: [
      { id: "ma1", text: "Evening reading",          days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], time: "21:00", duration: 60 },
      { id: "ma2", text: "Weekly reflection journal", days: ["Sun"], time: "10:00", duration: 30 },
    ],
    rating: 3,
  },
  {
    id: "soul", label: "Soul", glyph: "◇",
    question: "Am I aligned?",
    color: "#8b5cf6", colorLight: "#f5f3ff",
    identity: "My decisions are legible to my values even when they're costly. I am building a life I can account for.",
    pillars: null,
    goals: [
      { id: "sg1", text: "Write my personal principles", quarter: "Q2", progress: 15,
        krs: ["Principles document — descriptive not aspirational", "Review against last 90 days of decisions", "Share with one person who knows me well"] },
      { id: "sg2", text: "Establish contemplative practice", quarter: "Q2", progress: 45,
        krs: ["Define the practice by week 1", "5 days/wk for the full quarter", "End-of-quarter written reflection"] },
    ],
    kpis: [
      { id: "sk1", label: "Practice sessions", value: "4", unit: "/wk", delta: null },
      { id: "sk2", label: "Alignment",         value: "3", unit: "/5",  delta: null },
      { id: "sk3", label: "Integrity notes",   value: "2", unit: "/mo", delta: null },
      { id: "sk4", label: "Reflection done",   value: "Y", unit: "",    delta: null },
    ],
    activities: [
      { id: "sa1", text: "Morning meditation", days: ["Mon","Tue","Wed","Thu","Fri"], time: "06:00", duration: 20 },
      { id: "sa2", text: "Principles review",  days: ["Sun"], time: "09:00", duration: 30 },
    ],
    rating: 3,
  },
  {
    id: "heart", label: "Heart", glyph: "◉",
    question: "Am I honest with myself?",
    color: "#ef4444", colorLight: "#fef2f2",
    identity: "I feel things clearly, name them accurately, and don't let unexamined emotion drive consequential decisions.",
    pillars: null,
    goals: [
      { id: "hg1", text: "Journaling practice — patterns not events", quarter: "Q2", progress: 40,
        krs: ["5 entries/wk for the full quarter", "Monthly pattern review written", "Name one recurring emotional pattern by quarter end"] },
      { id: "hg2", text: "Emotional presence before high-stakes moments", quarter: "Q3", progress: 20,
        krs: ["60-second pause before 3 difficult conversations", "Note and review 2 reactivity incidents"] },
    ],
    kpis: [
      { id: "hk1", label: "Journal entries",     value: "4", unit: "/wk", delta: null },
      { id: "hk2", label: "Clarity",             value: "3", unit: "/5",  delta: null },
      { id: "hk3", label: "Reactivity notes",    value: "1", unit: "/mo", delta: null },
      { id: "hk4", label: "Reflection sessions", value: "2", unit: "/mo", delta: null },
    ],
    activities: [
      { id: "ha1", text: "Morning pages",        days: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], time: "07:00", duration: 30 },
      { id: "ha2", text: "Monthly letter to self",days: [], time: "10:00", duration: 60 },
    ],
    rating: 3,
  },
  {
    id: "roots", label: "Roots", glyph: "⬡",
    question: "Am I present with the people I love?",
    color: "#b87a2a", colorLight: "#faf2e6",
    identity: "I am a present father, partner, and son. The people closest to me know they are chosen, not assumed.",
    pillars: null,
    goals: [
      { id: "rg1", text: "Present with my children", quarter: "Q2", progress: 50,
        krs: ["Weekly ritual — their choice, my full attention", "Bedtime 4 nights/wk", "One full day/mo with no work"] },
      { id: "rg2", text: "Invest in my partnership", quarter: "Q3", progress: 25,
        krs: ["One real conversation/wk — not logistics", "Dedicated evening together/wk", "One trip this quarter"] },
    ],
    kpis: [
      { id: "rk1", label: "Family dinners", value: "4", unit: "/wk", delta: null },
      { id: "rk2", label: "1:1 with kids",  value: "3", unit: "/wk", delta: null },
      { id: "rk3", label: "Parent contact", value: "Y", unit: "/wk", delta: null },
      { id: "rk4", label: "Presence",       value: "4", unit: "/5",  delta: null },
    ],
    activities: [
      { id: "ra1", text: "Family breakfast",    days: ["Mon","Tue","Wed","Thu","Fri"], time: "07:30", duration: 30 },
      { id: "ra2", text: "Bedtime with kids",   days: ["Mon","Tue","Wed","Thu","Fri"], time: "20:00", duration: 30 },
      { id: "ra3", text: "Date night",          days: ["Fri"], time: "19:00", duration: 120 },
    ],
    rating: 4,
  },
  {
    id: "social", label: "Social", glyph: "◌",
    question: "Am I alive to the world?",
    color: "#3a8a5a", colorLight: "#e8f5ee",
    identity: "I invest in friendships with intention and stay curious about the world beyond my immediate context.",
    pillars: null,
    goals: [
      { id: "sog1", text: "Actively maintain friendships", quarter: "Q2", progress: 30,
        krs: ["Reach out to 1 person outside my circle each month", "One real in-person conversation with a close friend/mo", "Revive 2 atrophied friendships"] },
      { id: "sog2", text: "Stay alive to culture", quarter: "Q3", progress: 20,
        krs: ["One cultural experience/mo outside my default", "One new shared experience this quarter"] },
    ],
    kpis: [
      { id: "sok1", label: "Real conversations", value: "3", unit: "/wk", delta: null },
      { id: "sok2", label: "New people met",     value: "1", unit: "/mo", delta: null },
      { id: "sok3", label: "Cultural exp.",      value: "1", unit: "/mo", delta: null },
      { id: "sok4", label: "Friendship maint.",  value: "3", unit: "/5",  delta: null },
    ],
    activities: [
      { id: "soa1", text: "Monthly friend outreach", days: [], time: "12:00", duration: 30 },
      { id: "soa2", text: "Cultural outing",         days: [], time: "14:00", duration: 120 },
    ],
    rating: 2,
  },
  {
    id: "work", label: "Work", glyph: "◫",
    question: "Am I building something that matters?",
    color: "#1a6080", colorLight: "#e6f2f8",
    identity: "I build things that matter and lead people well. I define success on my own terms — contribution and craft.",
    pillars: null,
    goals: [],
    kpis: [
      { id: "wk1", label: "Deep work hrs", value: "18", unit: "/wk", delta: null },
      { id: "wk2", label: "Open todos",    value: "12", unit: "",    delta: null },
      { id: "wk3", label: "Follow-ups due",value: "4",  unit: "",    delta: null },
      { id: "wk4", label: "Calls this wk", value: "6",  unit: "",    delta: null },
    ],
    activities: [
      { id: "wa1", text: "Deep work block",    days: ["Mon","Tue","Wed","Thu"], time: "09:00", duration: 120 },
      { id: "wa2", text: "Weekly review (Fri)", days: ["Fri"],                  time: "16:00", duration: 30 },
      { id: "wa3", text: "Team sync",           days: ["Mon"],                  time: "08:30", duration: 30 },
    ],
    rating: 4,
    // Work-specific data
    todos: [
      { id: "t1", text: "Finalize Maro bank outreach list", horizon: "today",   duration: "30min",   project: "Maro",       contactId: "c1", done: false },
      { id: "t2", text: "Review Immersiv lender package",   horizon: "today",   duration: "1hr",     project: "Immersiv",   contactId: null,  done: false },
      { id: "t3", text: "Respond to Weave Finance re: OSI", horizon: "today",   duration: "30min",   project: "OSI",        contactId: "c4",  done: false },
      { id: "t4", text: "Build Team scorecard update",      horizon: "this week",    duration: "30min",   project: "DCG",        contactId: null,  done: false },
      { id: "t5", text: "Patent IP follow-up — Maro",       horizon: "this week",    duration: "1hr",     project: "Maro",       contactId: "c1",  done: false },
      { id: "t6", text: "Wellnest fundraising check-in",    horizon: "this week",    duration: "30min",   project: "Wellnest",   contactId: null,  done: false },
      { id: "t7", text: "Write 3-year direction memo",      horizon: "someday", duration: "half-day",project: "DCG",        contactId: null,  done: false },
      { id: "t8", text: "Portoro equity grants — finalize", horizon: "this week",    duration: "1hr",     project: "Portoro",    contactId: null,  done: false },
      { id: "t9", text: "Calibright lease renewal review",  horizon: "someday", duration: "2hr",     project: "Calibright", contactId: null,  done: false },
    ],
    contacts: [
      { id: "c1", name: "Jadon",           company: "Maro",          role: "CEO",              stage: "portfolio", lastContact: "May 20", email: "jadon@maro.com",          phone: "",              linkedin: "linkedin.com/in/jadon",        personal: "Has two kids. Very driven, competitive. Grew up in Atlanta.",        notes: "Strategic sale process. Tight loop needed." },
      { id: "c2", name: "Michael Harrison",company: "Troutman",      role: "Partner",          stage: "advisor",   lastContact: "May 15", email: "harrison@troutman.com",   phone: "+1 212 555 0100", linkedin: "",                             personal: "Meticulous. Prefers email over calls. Long-time relationship.",      notes: "Primary outside counsel. Reliable." },
      { id: "c3", name: "Justin Williams", company: "Seae Ventures", role: "Partner",          stage: "investor",  lastContact: "May 12", email: "justin@seaeventures.com", phone: "",              linkedin: "linkedin.com/in/justinwilliams", personal: "Surfs. Based in SF. Has a daughter. Fund closes Q3.",               notes: "Met re Bloomwell Series A. Follow up." },
      { id: "c4", name: "Weave Finance",   company: "Weave",         role: "Investor",         stage: "prospect",  lastContact: "May 10", email: "",                        phone: "",              linkedin: "",                             personal: "",                                                                  notes: "OSI / Ownershift investor. Pending response." },
      { id: "c5", name: "Renata",          company: "DCG",           role: "Build Team",       stage: "team",      lastContact: "May 21", email: "renata@dcg.com",          phone: "",              linkedin: "",                             personal: "Detail-oriented. Prefers Slack. Loves data.",                       notes: "Build Pod ops, outreach tracking." },
      { id: "c6", name: "Leo",             company: "DCG",           role: "Research & Ops",   stage: "team",      lastContact: "May 21", email: "leo@dcg.com",             phone: "",              linkedin: "",                             personal: "",                                                                  notes: "Research and operations support." },
      { id: "c7", name: "Sean",            company: "DCG",           role: "Key Role Searches",stage: "team",      lastContact: "May 18", email: "sean@dcg.com",            phone: "",              linkedin: "",                             personal: "Former recruiter at Korn Ferry. Good instincts.",                   notes: "Recruiting lead for portfolio." },
    ],
    calls: [
      { id: "cl1", contactId: "c1", date: "May 20",
        notes: "Spoke with Jadon for about 45 mins. He's feeling good about the strategic sale process overall but nervous about timing — wants to close before end of year. We aligned on a shortlist of 3 cyber-focused banks. He's going to prep the management presentation by June 1. I need to send him the confirmed bank list by end of this week. Also briefly touched on the patent IP matter — he said their counsel is reviewing but it's not urgent.",
        summary: "" },
      { id: "cl2", contactId: "c3", date: "May 12",
        notes: "Justin called me actually, which is a good sign. He's been tracking Bloomwell for a few months and the Q1 numbers got his attention. He wants an updated deck with current metrics before he takes it to his IC. Mentioned that Series A timing is tight for them — they close their next fund in Q3 so any new investments need to happen before then. Felt like a warm conversation. Worth moving fast.",
        summary: "" },
      { id: "cl3", contactId: "c4", date: "May 10",
        notes: "Weave sent over a preliminary term sheet for OSI. Valuation is below what we were hoping — about 15% under our internal target. The structure isn't bad but the price needs work. I want to have a board discussion before I respond. Need to understand if there are other interested parties we could use as leverage or if Weave is our best option right now.",
        summary: "" },
    ],
    projects: [
      { id:"p1", name:"Maro", status:"active",
        goal:"Complete strategic sale to a cybersecurity-focused acquirer at a strong valuation.",
        northStar:"LOI signed by Q3 2026",
        milestones:[
          { id:"m1", text:"Bank shortlist finalized", due:"Jun 15", owner:"Fausto", done:true },
          { id:"m2", text:"Management presentation ready", due:"Jul 1", owner:"Jadon", done:false },
          { id:"m3", text:"First round bids received", due:"Aug 1", owner:"Fausto", done:false },
          { id:"m4", text:"LOI signed", due:"Sep 15", owner:"Fausto", done:false },
        ],
        weeklyStatus:[ { id:"ws1", date:"May 26", text:"Banks shortlisted to 3. Jadon aligned on process." } ],
        notes:[], files:[] },
      { id:"p2", name:"Immersiv", status:"active",
        goal:"Secure non-dilutive financing to fund clinic expansion.",
        northStar:"$2M credit facility closed by Q2",
        milestones:[
          { id:"m1", text:"Lender package complete", due:"Jun 10", owner:"Fausto", done:false },
          { id:"m2", text:"3 lender conversations", due:"Jun 30", owner:"Fausto", done:false },
          { id:"m3", text:"Term sheet received", due:"Jul 15", owner:"Fausto", done:false },
        ],
        weeklyStatus:[],
        notes:[], files:[] },
      { id:"p3", name:"Bloomwell", status:"active",
        goal:"Close Series A and resolve Wilson Sonsini billing dispute.",
        northStar:"Series A term sheet signed",
        milestones:[
          { id:"m1", text:"Updated deck to Justin Williams", due:"Jun 5", owner:"Fausto", done:false },
          { id:"m2", text:"Billing dispute resolved", due:"Jun 15", owner:"Michael H.", done:false },
          { id:"m3", text:"Series A closed", due:"Sep 1", owner:"Fausto", done:false },
        ],
        weeklyStatus:[],
        notes:[], files:[] },
      { id:"p4", name:"DCG Fund Operations", status:"active",
        goal:"Strengthen LP relationships and build institutional fund infrastructure.",
        northStar:"Fund II first close by Q4 2026",
        milestones:[
          { id:"m1", text:"Q2 LP newsletter out", due:"Jun 30", owner:"Fausto", done:false },
          { id:"m2", text:"Carry program doc finalized", due:"Jun 15", owner:"Fausto", done:false },
          { id:"m3", text:"Build Pod Leader hired", due:"Aug 1", owner:"Sean", done:false },
        ],
        weeklyStatus:[],
        notes:[], files:[] },
    ],
  },
];

// ── HEPTAGON ──────────────────────────────────────────────────────────────────
function Heptagon({ domains, onSelect, onCalendar }) {
  const [hovered, setHovered] = useState(null);
  const [centerHov, setCenterHov] = useState(false);
  const cx = 195, cy = 195, r = 118, innerR = 36, n = 7;
  const labelDist = r + 44;

  const vertex = (i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  const segmentPath = (i, scale) => {
    const vp = vertex((i - 1 + n) % n), vc = vertex(i), vn = vertex((i + 1) % n);
    const lm = { x: (vp.x + vc.x) / 2, y: (vp.y + vc.y) / 2 };
    const rm = { x: (vc.x + vn.x) / 2, y: (vc.y + vn.y) / 2 };
    const s = (p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale });
    const slm = s(lm), sv = s(vc), srm = s(rm);
    return `M${cx},${cy} L${slm.x.toFixed(1)},${slm.y.toFixed(1)} L${sv.x.toFixed(1)},${sv.y.toFixed(1)} L${srm.x.toFixed(1)},${srm.y.toFixed(1)} Z`;
  };

  const outerPath = domains.map((_, i) => {
    const v = vertex(i);
    return `${i === 0 ? "M" : "L"}${v.x.toFixed(1)},${v.y.toFixed(1)}`;
  }).join(" ") + "Z";

  const labelAnchor = (i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + labelDist * Math.cos(a), y: cy + labelDist * Math.sin(a) };
  };

  return (
    <svg width="100%" viewBox="0 0 390 390" style={{ display: "block", margin: "0 auto" }}>
      <path d={outerPath} fill="#edeae3" stroke={C.borderMid} strokeWidth="1" />
      {domains.map((d, i) => {
        const scale = (innerR / r) + ((1 - innerR / r) * d.rating) / 5;
        const isHov = hovered === d.id;
        return (
          <path key={d.id} d={segmentPath(i, scale)} fill={d.color}
            opacity={isHov ? 0.88 : 0.58}
            style={{ cursor: "pointer", transition: "opacity 0.15s" }}
            onMouseEnter={() => setHovered(d.id)} onMouseLeave={() => setHovered(null)}
            onClick={() => onSelect(d.id)} />
        );
      })}
      {domains.map((_, i) => {
        const vc = vertex(i), vn = vertex((i + 1) % n);
        const mid = { x: (vc.x + vn.x) / 2, y: (vc.y + vn.y) / 2 };
        return <line key={i} x1={cx} y1={cy} x2={mid.x.toFixed(1)} y2={mid.y.toFixed(1)}
          stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />;
      })}
      {[2, 4].map(v => {
        const sc = (innerR / r) + ((1 - innerR / r) * v) / 5;
        const pts = domains.map((_, i) => {
          const a = (2 * Math.PI * i) / n - Math.PI / 2;
          return `${i === 0 ? "M" : "L"}${(cx + r * sc * Math.cos(a)).toFixed(1)},${(cy + r * sc * Math.sin(a)).toFixed(1)}`;
        }).join(" ") + "Z";
        return <path key={v} d={pts} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.8" strokeDasharray="2,4" />;
      })}
      {domains.map((d, i) => {
        const v = vertex(i);
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        const lineEnd = { x: cx + (r + 10) * Math.cos(a), y: cy + (r + 10) * Math.sin(a) };
        return <line key={i} x1={v.x.toFixed(1)} y1={v.y.toFixed(1)}
          x2={lineEnd.x.toFixed(1)} y2={lineEnd.y.toFixed(1)}
          stroke={d.color} strokeWidth="1" opacity="0.5" />;
      })}
      {domains.map((d, i) => {
        const la = labelAnchor(i);
        const isHov = hovered === d.id;
        const anchor = la.x < cx - 10 ? "end" : la.x > cx + 10 ? "start" : "middle";
        const dotCount = 5, dotGap = 8, dotR = 2.8;
        const totalDotW = (dotCount - 1) * dotGap;
        const dotStartX = anchor === "end" ? la.x - totalDotW : anchor === "start" ? la.x : la.x - totalDotW / 2;
        return (
          <g key={d.id} onClick={() => onSelect(d.id)}
            onMouseEnter={() => setHovered(d.id)} onMouseLeave={() => setHovered(null)}
            style={{ cursor: "pointer" }}>
            <text x={la.x} y={la.y - 3} textAnchor={anchor}
              fontSize="11.5" fontFamily="-apple-system,BlinkMacSystemFont,'Inter',sans-serif"
              fontWeight={isHov ? "700" : "400"}
              fill={isHov ? d.color : C.inkMid}
              style={{ pointerEvents: "none", transition: "fill 0.15s" }}>
              {d.label}
            </text>
            {Array.from({ length: dotCount }).map((_, j) => (
              <circle key={j} cx={dotStartX + j * dotGap} cy={la.y + 10}
                r={j < d.rating ? dotR : dotR - 0.8}
                fill={j < d.rating ? d.color : "none"}
                stroke={j < d.rating ? d.color : C.borderMid}
                strokeWidth="1" opacity={isHov ? 1 : 0.7}
                style={{ pointerEvents: "none" }} />
            ))}
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={innerR}
        fill={centerHov ? C.caqi : C.navy} stroke="none"
        style={{ cursor: "pointer", transition: "fill 0.18s" }}
        onMouseEnter={() => setCenterHov(true)}
        onMouseLeave={() => setCenterHov(false)}
        onClick={onCalendar} />
      <text x={cx} y={cy - 5} textAnchor="middle" dominantBaseline="middle"
        fontSize="10" fill={centerHov ? C.navy : "rgba(255,255,255,0.5)"}
        fontFamily="-apple-system,BlinkMacSystemFont,'Inter',sans-serif" letterSpacing="2.5"
        style={{ pointerEvents: "none", transition: "fill 0.18s" }}>be</text>
      <text x={cx} y={cy + 9} textAnchor="middle" dominantBaseline="middle"
        fontSize="10" fill={centerHov ? C.navy : "rgba(255,255,255,0.5)"}
        fontFamily="-apple-system,BlinkMacSystemFont,'Inter',sans-serif" letterSpacing="2.5"
        style={{ pointerEvents: "none", transition: "fill 0.18s" }}>whole</text>
    </svg>
  );
}

// ── SHARED MICRO COMPONENTS ───────────────────────────────────────────────────

// Ruled section heading — matches front page editorial feel
function SectionRule({ label, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "20px 0 12px" }}>
      <div style={{ width: 3, height: 14, borderRadius: 2, background: color || C.caqi, flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: C.inkMid, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
        fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function AddButton({ onClick, label }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", background: "transparent",
      border: `1px dashed ${C.borderMid}`, borderRadius: 6,
      padding: "10px", color: C.inkFaint, fontSize: 12,
      cursor: "pointer", fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
      fontWeight: 500, marginTop: 8,
    }}>+ {label}</button>
  );
}

function GhostInput({ value, onChange, placeholder, onKeyDown }) {
  return (
    <input dir="ltr" value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder}
      style={{ flex: 1, background: "transparent", border: "none",
        borderBottom: `1px solid ${C.border}`, color: C.ink,
        fontSize: 14, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif", padding: "4px 0",
        outline: "none", fontStyle: "italic" }} />
  );
}

// ── PILLAR HEALTH BAR (Body only for now) ─────────────────────────────────────
function PillarBar({ pillars, goals, kpis, color }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <SectionRule label="pillars" color={color} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pillars.map(p => {
          const pGoals = goals.filter(g => g.pillar === p.id);
          const pKPIs  = kpis.filter(k => k.pillar === p.id);
          const avgProgress = pGoals.length
            ? Math.round(pGoals.reduce((a, g) => a + g.progress, 0) / pGoals.length)
            : null;
          return (
            <div key={p.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 13, color: C.ink, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif" }}>{p.label}</span>
                  <span style={{ fontSize: 11, color: C.inkFaint }}>{p.desc}</span>
                </div>
                {avgProgress !== null && (
                  <span style={{ fontSize: 10, color: color, fontFamily: "'SF Mono','Fira Code',monospace", fontWeight: 700 }}>{avgProgress}%</span>
                )}
              </div>
              {avgProgress !== null && (
                <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${avgProgress}%`, background: color, borderRadius: 2, opacity: 0.7 }} />
                </div>
              )}
              {pKPIs.length > 0 && (
                <div style={{ display: "flex", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
                  {pKPIs.map(k => (
                    <span key={k.id} style={{ fontSize: 11, color: C.inkLight, fontFamily: "'SF Mono','Fira Code',monospace" }}>
                      <span style={{ color: C.ink, fontWeight: 700 }}>{k.value}</span>{k.unit} {k.label.toLowerCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── GOALS ─────────────────────────────────────────────────────────────────────
function GoalsSection({ goals, color, colorLight, pillars, onUpdate }) {
  const [expanded, setExpanded] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newGoal, setNewGoal] = useState({ text: "", quarter: "Q2", progress: 0, pillar: pillars?.[0]?.id || null });

  const addGoal = () => {
    if (!newGoal.text.trim()) return;
    onUpdate([...goals, { ...newGoal, id: `g${Date.now()}`, krs: [] }]);
    setNewGoal({ text: "", quarter: "Q2", progress: 0, pillar: pillars?.[0]?.id || null });
    setAdding(false);
  };

  // Group by pillar if pillars exist, else flat
  const groups = pillars
    ? pillars.map(p => ({ pillar: p, goals: goals.filter(g => g.pillar === p.id) })).filter(g => g.goals.length > 0)
    : [{ pillar: null, goals }];
  const ungrouped = pillars ? goals.filter(g => !g.pillar) : [];

  const renderGoal = (g) => {
    const qIdx = QUARTERS.indexOf(g.quarter);
    const isOpen = expanded === g.id;
    return (
      <div key={g.id} style={{ marginBottom: 8 }}>
        <div onClick={() => setExpanded(isOpen ? null : g.id)} style={{
          borderBottom: `1px solid ${C.border}`, paddingBottom: 12,
          paddingTop: 12, cursor: "pointer",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: 1 }}>
              <span style={{ fontSize: 10, color: color, fontFamily: "'SF Mono','Fira Code',monospace", fontWeight: 700, flexShrink: 0 }}>{g.quarter}</span>
              <span style={{ fontSize: 14, color: C.ink, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif", lineHeight: 1.3 }}>{g.text}</span>
            </div>
            <span style={{ fontSize: 11, color: C.inkFaint, marginLeft: 10, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
          </div>
          {/* Quarter strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 3, marginBottom: 8 }}>
            {QUARTERS.map((q, i) => (
              <div key={q} style={{ height: 2, borderRadius: 1, background: i === qIdx ? color : C.border }} />
            ))}
          </div>
          {/* Progress */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${g.progress}%`, background: color, borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, color: color, fontFamily: "'SF Mono','Fira Code',monospace", fontWeight: 700, width: 30, textAlign: "right" }}>{g.progress}%</span>
          </div>
        </div>

        {isOpen && (
          <div style={{ background: colorLight, borderRadius: "0 0 6px 6px", padding: "14px 16px", marginTop: -1 }}>
            {g.krs.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {g.krs.map((kr, i) => (
                  <div key={i} style={{ fontSize: 13, color: C.inkMid, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                    padding: "5px 0", borderBottom: `1px solid ${color}22`,
                    display: "flex", gap: 10, lineHeight: 1.5 }}>
                    <span style={{ color: color, flexShrink: 0, fontStyle: "italic" }}>—</span>
                    {kr}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <input type="range" min={0} max={100} value={g.progress}
                onChange={e => onUpdate(goals.map(x => x.id === g.id ? { ...x, progress: +e.target.value } : x))}
                style={{ flex: 1, accentColor: color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: color, width: 36, textAlign: "right",
                fontFamily: "'SF Mono','Fira Code',monospace" }}>{g.progress}%</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={g.quarter}
                onChange={e => onUpdate(goals.map(x => x.id === g.id ? { ...x, quarter: e.target.value } : x))}
                style={{ background: "transparent", border: `1px solid ${color}44`, borderRadius: 4,
                  color: color, fontSize: 11, fontFamily: "'SF Mono','Fira Code',monospace", padding: "3px 8px" }}>
                {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
              <button onClick={() => onUpdate(goals.filter(x => x.id !== g.id))}
                style={{ background: "transparent", border: `1px solid ${C.borderMid}`, borderRadius: 4,
                  color: C.inkFaint, fontSize: 11, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                Remove
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {groups.map(({ pillar, goals: pg }) => (
        <div key={pillar?.id || "all"}>
          {pillar && (
            <div style={{ fontSize: 11, color: color, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
              letterSpacing: "0.05em", marginTop: 16, marginBottom: 2 }}>{pillar.label}</div>
          )}
          {pg.map(renderGoal)}
        </div>
      ))}
      {ungrouped.map(renderGoal)}

      {adding ? (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 8 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <GhostInput value={newGoal.text} onChange={e => setNewGoal({ ...newGoal, text: e.target.value })} placeholder="New goal…" />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={newGoal.quarter} onChange={e => setNewGoal({ ...newGoal, quarter: e.target.value })}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkMid,
                fontSize: 12, fontFamily: "'SF Mono','Fira Code',monospace", padding: "5px 8px" }}>
              {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
            {pillars && (
              <select value={newGoal.pillar || ""} onChange={e => setNewGoal({ ...newGoal, pillar: e.target.value })}
                style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkMid,
                  fontSize: 12, fontFamily: "'SF Mono','Fira Code',monospace", padding: "5px 8px" }}>
                {pillars.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
            <button onClick={addGoal} style={{ background: color, border: "none", borderRadius: 4,
              color: "#fff", fontSize: 12, padding: "5px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Add</button>
            <button onClick={() => setAdding(false)} style={{ background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 4, color: C.inkLight, fontSize: 12, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <AddButton onClick={() => setAdding(true)} label="Add goal" />
      )}
    </div>
  );
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function KPIsSection({ kpis, color, pillars, onUpdate }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newKPI, setNewKPI] = useState({ label: "", value: "", unit: "", delta: "", pillar: pillars?.[0]?.id || null });

  // Group by pillar if exists
  const groups = pillars
    ? pillars.map(p => ({ pillar: p, kpis: kpis.filter(k => k.pillar === p.id) })).filter(g => g.kpis.length > 0)
    : [{ pillar: null, kpis }];

  const renderKPI = (k) => (
    <div key={k.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
      padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.inkLight, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif", flex: 1 }}>{k.label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        {editing === k.id
          ? <input value={k.value} onChange={e => onUpdate(kpis.map(x => x.id === k.id ? { ...x, value: e.target.value } : x))}
              onBlur={() => setEditing(null)} autoFocus
              style={{ width: 52, border: "none", borderBottom: `1.5px solid ${color}`,
                background: "transparent", fontSize: 20, fontWeight: 700,
                color: C.ink, fontFamily: "inherit", outline: "none", textAlign: "right" }} />
          : <span onClick={() => setEditing(k.id)} style={{ fontSize: 20, fontWeight: 700,
              color: C.ink, cursor: "pointer", fontVariantNumeric: "tabular-nums" }}>
              {k.value}<span style={{ fontSize: 11, fontWeight: 400, color: C.inkLight }}>{k.unit && ` ${k.unit}`}</span>
            </span>
        }
        {k.delta && (
          <span style={{ fontSize: 11, color: k.delta.startsWith("+") ? C.green : C.red,
            fontFamily: "'SF Mono','Fira Code',monospace", marginLeft: 4 }}>{k.delta}</span>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {groups.map(({ pillar, kpis: pk }) => (
        <div key={pillar?.id || "all"}>
          {pillar && (
            <div style={{ fontSize: 11, color: color, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
              marginTop: 16, marginBottom: 2 }}>{pillar.label}</div>
          )}
          {pk.map(renderKPI)}
        </div>
      ))}

      {adding ? (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {[["label","Label"],["value","Value"],["unit","Unit"],["delta","Change (+4)"]].map(([k, ph]) => (
              <input key={k} value={newKPI[k]} onChange={e => setNewKPI({ ...newKPI, [k]: e.target.value })}
                placeholder={ph} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4,
                  color: C.ink, fontSize: 13, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif", padding: "6px 10px", outline: "none",
                  fontStyle: "italic" }} />
            ))}
          </div>
          {pillars && (
            <select value={newKPI.pillar || ""} onChange={e => setNewKPI({ ...newKPI, pillar: e.target.value })}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkMid,
                fontSize: 12, fontFamily: "'SF Mono','Fira Code',monospace", padding: "5px 8px", marginBottom: 10 }}>
              {pillars.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => {
              if (!newKPI.label.trim()) return;
              onUpdate([...kpis, { ...newKPI, id: `k${Date.now()}` }]);
              setNewKPI({ label: "", value: "", unit: "", delta: "", pillar: pillars?.[0]?.id || null });
              setAdding(false);
            }} style={{ background: color, border: "none", borderRadius: 4, color: "#fff",
              fontSize: 12, padding: "6px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Add</button>
            <button onClick={() => setAdding(false)} style={{ background: "transparent", border: `1px solid ${C.border}`,
              borderRadius: 4, color: C.inkLight, fontSize: 12, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <AddButton onClick={() => setAdding(true)} label="Add KPI" />
      )}
    </div>
  );
}

// ── ACTIVITIES ────────────────────────────────────────────────────────────────
function ActivitiesSection({ activities, color, colorLight, pillars, onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [newAct, setNewAct] = useState({ text: "", days: [], pillar: pillars?.[0]?.id || null });

  const toggleDay = (id, day) => onUpdate(activities.map(a =>
    a.id === id ? { ...a, days: a.days.includes(day) ? a.days.filter(d => d !== day) : [...a.days, day] } : a
  ));

  // Group by pillar
  const groups = pillars
    ? pillars.map(p => ({ pillar: p, acts: activities.filter(a => a.pillar === p.id) })).filter(g => g.acts.length > 0)
    : [{ pillar: null, acts: activities }];
  const ungrouped = pillars ? activities.filter(a => !a.pillar) : [];

  const renderActivity = (a) => (
    <div key={a.id} style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: C.inkMid, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif" }}>{a.text}</span>
        <button onClick={() => onUpdate(activities.filter(x => x.id !== a.id))}
          style={{ background: "transparent", border: "none", color: C.inkFaint, cursor: "pointer", fontSize: 13 }}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {DAYS.map(d => {
          const on = a.days.includes(d);
          return (
            <div key={d} onClick={() => toggleDay(a.id, d)} style={{
              textAlign: "center", cursor: "pointer",
            }}>
              <div style={{ fontSize: 8, color: on ? color : C.inkFaint,
                fontFamily: "'SF Mono','Fira Code',monospace", marginBottom: 3, letterSpacing: "0.04em" }}>{d}</div>
              <div style={{
                height: 24, borderRadius: 3,
                background: on ? color : C.bg,
                border: `1px solid ${on ? color : C.border}`,
                opacity: on ? 0.85 : 1,
                transition: "all 0.12s",
              }} />
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      {groups.map(({ pillar, acts }) => (
        <div key={pillar?.id || "all"}>
          {pillar && (
            <div style={{ fontSize: 11, color: color, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
              marginTop: 16, marginBottom: 8 }}>{pillar.label}</div>
          )}
          {acts.map(renderActivity)}
        </div>
      ))}
      {ungrouped.map(renderActivity)}

      {adding ? (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 8 }}>
          <div style={{ marginBottom: 10 }}>
            <GhostInput value={newAct.text} onChange={e => setNewAct({ ...newAct, text: e.target.value })} placeholder="Activity name…" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 12 }}>
            {DAYS.map(d => {
              const on = newAct.days.includes(d);
              return (
                <div key={d} onClick={() => setNewAct(n => ({ ...n, days: n.days.includes(d) ? n.days.filter(x => x !== d) : [...n.days, d] }))}
                  style={{ textAlign: "center", cursor: "pointer" }}>
                  <div style={{ fontSize: 8, color: on ? color : C.inkFaint,
                    fontFamily: "'SF Mono','Fira Code',monospace", marginBottom: 3 }}>{d}</div>
                  <div style={{ height: 24, borderRadius: 3, background: on ? color : C.bg,
                    border: `1px solid ${on ? color : C.border}`, opacity: on ? 0.85 : 1 }} />
                </div>
              );
            })}
          </div>
          {pillars && (
            <select value={newAct.pillar || ""} onChange={e => setNewAct({ ...newAct, pillar: e.target.value })}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkMid,
                fontSize: 12, fontFamily: "'SF Mono','Fira Code',monospace", padding: "5px 8px", marginBottom: 10 }}>
              {pillars.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => {
              if (!newAct.text.trim()) return;
              onUpdate([...activities, { ...newAct, id: `a${Date.now()}` }]);
              setNewAct({ text: "", days: [], pillar: pillars?.[0]?.id || null });
              setAdding(false);
            }} style={{ background: color, border: "none", borderRadius: 4, color: "#fff",
              fontSize: 12, padding: "6px 16px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>Add</button>
            <button onClick={() => setAdding(false)} style={{ background: "transparent",
              border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkLight,
              fontSize: 12, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <AddButton onClick={() => setAdding(true)} label="Add activity" />
      )}
    </div>
  );
}

// ── SHARED FIELD COMPONENTS (top-level to prevent remount on parent re-render) ─
function EditField({ label, value, field, placeholder, multiline, accentColor, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const color = accentColor || C.caqi;
  const commit = () => { onCommit(field, val); setEditing(false); };
  return (
    <div style={{ padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
      {label && <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>{label}</div>}
      {editing ? (
        <div>
          {multiline
            ? <textarea dir="ltr" value={val} onChange={e => setVal(e.target.value)} rows={3}
                autoFocus style={{ width:"100%", background:"transparent", border:"none",
                  borderBottom:`1px solid ${color}`, color:C.ink, fontSize:13,
                  fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", padding:"2px 0",
                  outline:"none", resize:"none", boxSizing:"border-box", direction:"ltr" }} />
            : <input dir="ltr" value={val} onChange={e => setVal(e.target.value)} autoFocus
                onKeyDown={e => e.key==="Enter" && commit()}
                style={{ width:"100%", background:"transparent", border:"none",
                  borderBottom:`1px solid ${color}`, color:C.ink, fontSize:13,
                  fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", padding:"2px 0",
                  outline:"none", boxSizing:"border-box", direction:"ltr" }} />
          }
          <div style={{ display:"flex", gap:8, marginTop:6 }}>
            <button onClick={commit} style={{ background:color, border:"none",
              borderRadius:3, color:"#fff", fontSize:10, padding:"3px 10px",
              cursor:"pointer", fontFamily:"inherit" }}>Save</button>
            <button onClick={() => { setVal(value||""); setEditing(false); }}
              style={{ background:"transparent", border:`1px solid ${C.border}`,
                borderRadius:3, color:C.inkFaint, fontSize:10, padding:"3px 8px",
                cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div onClick={() => { setVal(value||""); setEditing(true); }}
          style={{ fontSize:13, color:value ? C.inkMid : C.inkFaint,
            fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
            cursor:"text", minHeight:18, lineHeight:1.5 }}>
          {value || <span style={{ opacity:0.4 }}>{placeholder}</span>}
        </div>
      )}
    </div>
  );
}

function TodoEditRow({ t, domainColor, todos, setTodos, setEditingTodo }) {
  const DURATIONS = ["15min","30min","1hr","2hr","half-day","full-day"];
  const DUR_COLOR = { "15min":C.green,"30min":C.green,"1hr":C.gold,"2hr":C.gold,"half-day":C.red,"full-day":C.red };
  const textRef = useRef(null);
  // Use local state only for duration/horizon/project to avoid remounting input
  const [local, setLocal] = useState({ duration:t.duration, horizon:t.horizon, project:t.project });
  const save = () => {
    const text = textRef.current?.value?.trim() || t.text;
    setTodos(todos.map(x => x.id===t.id ? { ...x, text, ...local } : x));
    setEditingTodo(null);
  };
  return (
    <div style={{ padding:"10px 0 14px", borderBottom:`1px solid ${C.border}`,
      background:C.caqiLight+"44", borderLeft:`3px solid ${domainColor}`, paddingLeft:10 }}>
      <input dir="ltr" ref={textRef} defaultValue={t.text} autoFocus
        onKeyDown={e => { if (e.key==="Enter") save(); if (e.key==="Escape") setEditingTodo(null); }}
        style={{ width:"100%", background:"#fff", border:"none",
          borderBottom:`1px solid ${domainColor}`, color:C.ink, fontSize:14,
          fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
          padding:"3px 0", outline:"none", boxSizing:"border-box", marginBottom:10,
          direction:"ltr" }} />
      <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Time</div>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10 }}>
        {DURATIONS.map(d => (
          <button key={d} onClick={() => setLocal(l => ({...l, duration:d}))}
            style={{ background:local.duration===d ? DUR_COLOR[d] : "transparent",
              color:local.duration===d ? "#fff" : DUR_COLOR[d],
              border:`1.5px solid ${DUR_COLOR[d]}`,
              borderRadius:10, padding:"2px 9px", fontSize:10, cursor:"pointer",
              fontFamily:"'SF Mono','Fira Code',monospace" }}>{d}</button>
        ))}
      </div>
      <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>When</div>
      <div style={{ display:"flex", gap:4, marginBottom:10 }}>
        {HORIZONS.map(h => (
          <button key={h} onClick={() => setLocal(l => ({...l, horizon:h}))}
            style={{ flex:1, background:local.horizon===h ? domainColor : "transparent",
              color:local.horizon===h ? "#fff" : C.inkLight,
              border:`1.5px solid ${local.horizon===h ? domainColor : C.border}`,
              borderRadius:4, padding:"3px 4px", fontSize:11, cursor:"pointer",
              fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
              textTransform:"capitalize" }}>{h}</button>
        ))}
      </div>
      <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Project</div>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
        {PROJECTS.map(p => (
          <button key={p} onClick={() => setLocal(l => ({...l, project:l.project===p?"":p}))}
            style={{ background:local.project===p ? domainColor : "transparent",
              color:local.project===p ? "#fff" : C.inkLight,
              border:`1px solid ${local.project===p ? domainColor : C.border}`,
              borderRadius:4, padding:"2px 9px", fontSize:10, cursor:"pointer",
              fontFamily:"'SF Mono','Fira Code',monospace" }}>{p}</button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={save}
          style={{ background:domainColor, border:"none", borderRadius:4, color:"#fff",
            fontSize:11, padding:"5px 14px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Save</button>
        <button onClick={() => setEditingTodo(null)}
          style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4,
            color:C.inkFaint, fontSize:11, padding:"5px 10px", cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// Keyboard handler for note contentEditable areas
// - Cmd/Ctrl+B/I/U: bold/italic/underline
// - Tab: indent (or outdent with Shift)
// - * + Space: convert to bullet list
function noteKeyHandler(e) {
  if (e.metaKey || e.ctrlKey) {
    if (e.key === "b" || e.key === "B") { e.preventDefault(); document.execCommand("bold"); return; }
    if (e.key === "i" || e.key === "I") { e.preventDefault(); document.execCommand("italic"); return; }
    if (e.key === "u" || e.key === "U") { e.preventDefault(); document.execCommand("underline"); return; }
  }
  if (e.key === "Tab") {
    e.preventDefault();
    if (e.shiftKey) {
      document.execCommand("outdent");
    } else {
      document.execCommand("indent");
    }
    return;
  }
  if (e.key === " ") {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const text = node.textContent || "";
    const offset = range.startOffset;
    if (text.slice(0, offset).trimStart() === "*") {
      e.preventDefault();
      // Select the entire * character and delete it, then insert list
      const delRange = document.createRange();
      const start = text.indexOf("*");
      delRange.setStart(node, start);
      delRange.setEnd(node, offset);
      sel.removeAllRanges();
      sel.addRange(delRange);
      document.execCommand("delete");
      document.execCommand("insertUnorderedList");
    }
  }
}

function MilestoneEditRow({ m, accentColor, onSave, onCancel }) {
  const textRef  = useRef(null);
  const ownerRef = useRef(null);
  const [dueRaw, setDueRaw]     = useState(m.dueRaw || "");
  const [startRaw, setStartRaw] = useState(m.startRaw || "");
  return (
    <div style={{ padding:"10px 12px", border:`1.5px solid ${accentColor}44`,
      borderRadius:6, background:C.caqiLight+"33", marginBottom:4 }}>
      <input ref={textRef} dir="ltr" defaultValue={m.text} autoFocus
        style={{ width:"100%", background:"transparent", border:"none",
          borderBottom:`1px solid ${accentColor}`, color:C.ink, fontSize:13,
          fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
          padding:"3px 0", outline:"none", boxSizing:"border-box", marginBottom:8 }} />
      <div style={{ display:"flex", gap:8, marginBottom:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
            textTransform:"uppercase", marginBottom:3 }}>Start</div>
          <input type="date" value={startRaw} onChange={e => setStartRaw(e.target.value)}
            style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`,
              borderRadius:4, color:C.inkMid, fontSize:11,
              fontFamily:"'SF Mono','Fira Code',monospace", padding:"3px 6px", outline:"none" }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
            textTransform:"uppercase", marginBottom:3 }}>Due</div>
          <input type="date" value={dueRaw} onChange={e => setDueRaw(e.target.value)}
            style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`,
              borderRadius:4, color:C.inkMid, fontSize:11,
              fontFamily:"'SF Mono','Fira Code',monospace", padding:"3px 6px", outline:"none" }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
            textTransform:"uppercase", marginBottom:3 }}>Owner</div>
          <input ref={ownerRef} dir="ltr" defaultValue={m.owner || ""}
            style={{ width:"100%", background:"transparent", border:"none",
              borderBottom:`1px solid ${C.border}`, color:C.inkMid, fontSize:11,
              fontFamily:"'SF Mono','Fira Code',monospace", padding:"3px 0", outline:"none" }} />
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => {
          const text  = textRef.current?.value?.trim() || m.text;
          const owner = ownerRef.current?.value || m.owner;
          const due   = dueRaw ? new Date(dueRaw).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : m.due;
          onSave({ text, due, dueRaw, startRaw, owner });
        }} style={{ background:accentColor, border:"none", borderRadius:4, color:"#fff",
          fontSize:11, padding:"3px 12px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Save</button>
        <button onClick={onCancel}
          style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4,
            color:C.inkFaint, fontSize:11, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
      </div>
    </div>
  );
}

function GranolaPanel({ meetings, loading, importing, onSelect, onClose }) {
  return (
    <div style={{ background:C.surface, border:`1.5px solid #4ade80`,
      borderRadius:8, padding:12, marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:14 }}>🌿</span>
          <span style={{ fontSize:12, color:"#16a34a", fontFamily:"'SF Mono','Fira Code',monospace",
            textTransform:"uppercase", letterSpacing:"0.08em" }}>Granola meetings</span>
        </div>
        <button onClick={onClose}
          style={{ background:"transparent", border:"none", color:C.inkFaint,
            cursor:"pointer", fontSize:14, padding:0 }}>×</button>
      </div>
      {loading && (
        <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic", padding:"8px 0" }}>
          Loading your Granola meetings…
        </div>
      )}
      {!loading && meetings.length === 0 && (
        <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic", padding:"8px 0" }}>
          No recent meetings found in Granola.
        </div>
      )}
      {!loading && meetings.map(m => (
        <div key={m.id} style={{ display:"flex", alignItems:"center", gap:10,
          padding:"9px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, color:C.ink, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
              fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m.title}</div>
            {m.date && <div style={{ fontSize:10, color:C.inkFaint,
              fontFamily:"'SF Mono','Fira Code',monospace", marginTop:2 }}>{m.date}</div>}
            {m.attendees && <div style={{ fontSize:10, color:C.inkFaint,
              fontStyle:"italic", marginTop:1 }}>{m.attendees}</div>}
          </div>
          <button onClick={() => onSelect(m)}
            disabled={!!importing}
            style={{ background: importing===m.id ? C.border : "#16a34a",
              border:"none", borderRadius:4, color:"#fff", fontSize:11,
              padding:"4px 12px", cursor: importing ? "default" : "pointer",
              fontFamily:"inherit", fontWeight:600, flexShrink:0, opacity: importing && importing!==m.id ? 0.5 : 1 }}>
            {importing===m.id ? "Importing…" : "Import"}
          </button>
        </div>
      ))}
    </div>
  );
}

function FollowUpInput({ onAdd, accentColor }) {
  const [val, setVal] = useState("");
  const color = accentColor || C.gold;
  const submit = () => { if (val.trim()) { onAdd(val.trim()); setVal(""); } };
  return (
    <div style={{ display:"flex", gap:8, alignItems:"center", paddingTop:8 }}>
      <input dir="ltr" value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key==="Enter") submit(); }}
        placeholder="Add follow-up…"
        style={{ flex:1, background:"transparent", border:"none",
          borderBottom:`1px solid ${color}55`, color:C.ink, fontSize:13,
          fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
          padding:"3px 0", outline:"none", direction:"ltr" }} />
      <button onClick={submit}
        style={{ background:"transparent", border:`1px solid ${color}`,
          borderRadius:4, color:color, fontSize:11, padding:"3px 10px",
          cursor:"pointer", fontFamily:"inherit" }}>+</button>
    </div>
  );
}

// ── STABLE FORM COMPONENTS (top-level to prevent remount on parent re-render) ─

function AddContactForm({ onAdd, onCancel, accentColor, crmStages, stageColors }) {
  const refs = {
    name: useRef(null), company: useRef(null), role: useRef(null),
    email: useRef(null), phone: useRef(null), linkedin: useRef(null),
    personal: useRef(null), notes: useRef(null),
  };
  const [stage, setStage] = useState("prospect");
  const fields = [["name","Name"],["company","Company"],["role","Role"],
    ["email","Email"],["phone","Phone"],["linkedin","LinkedIn"],
    ["personal","Personal notes"],["notes","Context"]];
  return (
    <div style={{ marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:14 }}>
      {fields.map(([k, ph]) => (
        <input key={k} ref={refs[k]} dir="ltr" defaultValue=""
          placeholder={ph}
          style={{ width:"100%", background:"transparent", border:"none",
            borderBottom:`1px solid ${C.border}`, color:C.ink, fontSize:14,
            fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
            padding:"6px 0", outline:"none", boxSizing:"border-box", marginBottom:8 }} />
      ))}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
        {(crmStages||[]).map(s => (
          <button key={s} onClick={() => setStage(s)}
            style={{ background:stage===s ? (stageColors[s]||accentColor) : "transparent",
              color:stage===s ? "#fff" : (stageColors[s]||accentColor),
              border:`1.5px solid ${stageColors[s]||accentColor}`,
              borderRadius:6, padding:"3px 10px", fontSize:10, fontWeight:500, cursor:"pointer",
              fontFamily:"'SF Mono','Fira Code',monospace", textTransform:"capitalize" }}>{s}</button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => {
          const name = refs.name.current?.value?.trim();
          if (!name) return;
          onAdd({
            name, company: refs.company.current?.value||"",
            role: refs.role.current?.value||"",
            email: refs.email.current?.value||"",
            phone: refs.phone.current?.value||"",
            linkedin: refs.linkedin.current?.value||"",
            personal: refs.personal.current?.value||"",
            notes: refs.notes.current?.value||"",
            stage,
          });
        }} style={{ background:accentColor, border:"none", borderRadius:4, color:"#fff",
          fontSize:12, padding:"6px 16px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Add</button>
        <button onClick={onCancel}
          style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4,
            color:C.inkFaint, fontSize:12, padding:"6px 10px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
      </div>
    </div>
  );
}

function AddMilestoneForm({ onAdd, onCancel, accentColor }) {
  const textRef = useRef(null);
  const ownerRef = useRef(null);
  const [dueRaw, setDueRaw] = useState("");
  return (
    <div style={{ padding:"10px 0", borderTop:`1px solid ${C.border}`, display:"flex", flexDirection:"column", gap:8 }}>
      <input ref={textRef} dir="ltr" defaultValue="" autoFocus placeholder="Milestone…"
        style={{ background:"transparent", border:"none", borderBottom:`1px solid ${accentColor}`,
          color:C.ink, fontSize:13, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
          padding:"3px 0", outline:"none", width:"100%", boxSizing:"border-box" }} />
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
            textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Due date</div>
          <input type="date" value={dueRaw} onChange={e => setDueRaw(e.target.value)}
            style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`,
              borderRadius:4, color:C.inkMid, fontSize:12,
              fontFamily:"'SF Mono','Fira Code',monospace", padding:"4px 6px", outline:"none" }} />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
            textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:3 }}>Owner</div>
          <input ref={ownerRef} dir="ltr" defaultValue="" placeholder="Name"
            style={{ width:"100%", background:"transparent", border:"none",
              borderBottom:`1px solid ${C.border}`, color:C.inkMid, fontSize:12,
              fontFamily:"'SF Mono','Fira Code',monospace", padding:"3px 0", outline:"none" }} />
        </div>
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => {
          const text = textRef.current?.value?.trim();
          if (!text) return;
          const due = dueRaw ? new Date(dueRaw).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "";
          onAdd({ text, due, dueRaw, owner: ownerRef.current?.value||"" });
        }} style={{ background:accentColor, border:"none", borderRadius:4, color:"#fff",
          fontSize:11, padding:"4px 14px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Add</button>
        <button onClick={onCancel}
          style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4,
            color:C.inkFaint, fontSize:11, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
      </div>
    </div>
  );
}

function AddProjectForm({ onAdd, onCancel, accentColor, statusColors }) {
  const nameRef = useRef(null);
  const [status, setStatus] = useState("active");
  return (
    <div style={{ marginTop:12, padding:"12px 0", borderTop:`1px solid ${C.border}` }}>
      <input ref={nameRef} dir="ltr" defaultValue="" autoFocus placeholder="Project name…"
        style={{ width:"100%", background:"transparent", border:"none",
          borderBottom:`1px solid ${accentColor}`, color:C.ink, fontSize:14,
          fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
          padding:"4px 0", outline:"none", boxSizing:"border-box", marginBottom:10 }} />
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
        {Object.keys(statusColors).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            style={{ background:status===s ? statusColors[s] : "transparent",
              color:status===s ? "#fff" : statusColors[s],
              border:`1.5px solid ${statusColors[s]}`,
              borderRadius:6, padding:"3px 10px", fontSize:10, fontWeight:500, cursor:"pointer",
              fontFamily:"'SF Mono','Fira Code',monospace", textTransform:"capitalize" }}>{s}</button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => {
          const name = nameRef.current?.value?.trim();
          if (!name) return;
          onAdd({ name, status });
        }} style={{ background:accentColor, border:"none", borderRadius:4, color:"#fff",
          fontSize:12, padding:"6px 16px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Add</button>
        <button onClick={onCancel}
          style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4,
            color:C.inkFaint, fontSize:12, padding:"6px 10px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
      </div>
    </div>
  );
}

function AddStatusForm({ onAdd, onCancel, projectName }) {
  const ref = useRef(null);
  return (
    <div style={{ paddingTop:10 }}>
      <textarea ref={ref} dir="ltr" defaultValue="" autoFocus rows={3}
        placeholder={`What happened this week on ${projectName}?`}
        style={{ width:"100%", background:"transparent", border:"none",
          borderBottom:`1px solid ${C.caqi}`, color:C.ink, fontSize:13,
          fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", lineHeight:1.6,
          padding:"4px 0", outline:"none", resize:"none", boxSizing:"border-box",
          direction:"ltr", marginBottom:8 }} />
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => {
          const text = ref.current?.value?.trim();
          if (!text) return;
          onAdd(text);
        }} style={{ background:C.caqi, border:"none", borderRadius:4, color:"#fff",
          fontSize:11, padding:"4px 14px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Add</button>
        <button onClick={onCancel}
          style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4,
            color:C.inkFaint, fontSize:11, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
      </div>
    </div>
  );
}

// ── WORK DOMAIN VIEW ──────────────────────────────────────────────────────────
const HORIZONS   = ["today", "this week", "someday"];
const PRIORITIES = ["high", "med", "low"];
const CRM_STAGES_DEFAULT = ["prospect", "investor", "portfolio", "advisor", "team"];
const PROJECTS   = ["Maro","Immersiv","Bloomwell","OSI","Wellnest","Calibright","Portoro","DCG"];
const PRI_COLOR  = { high: C.red, med: C.gold, low: C.inkFaint };
const STAGE_COLOR = { prospect: "#b87a2a", investor: "#3b82f6", portfolio: "#0d9488", advisor: "#8b5cf6", team: "#3a8a5a" };
const HEALTH_COLOR = (h) => h >= 4 ? C.green : h === 3 ? C.gold : C.red;

// Warmth: based on days since last contact
const contactWarmth = (lastContact) => {
  if (!lastContact) return 1;
  const months = {"Jan":0,"Feb":1,"Mar":2,"Apr":3,"May":4,"Jun":5,
    "Jul":6,"Aug":7,"Sep":8,"Oct":9,"Nov":10,"Dec":11};
  const parts = lastContact.split(" ");
  if (parts.length < 2) return 1;
  const year = new Date().getFullYear();
  const d = new Date(year, months[parts[0]] ?? 4, parseInt(parts[1])||1);
  const days = Math.floor((new Date() - d) / (1000*60*60*24));
  if (days <= 7)  return 5;
  if (days <= 14) return 4;
  if (days <= 30) return 3;
  if (days <= 60) return 2;
  return 1;
};
const WARMTH_COLOR = (w) => w >= 4 ? C.green : w >= 3 ? C.gold : C.red;

function WorkDomainView({ domain, onUpdate }) {
  const [tab, setTab] = useState("todos");
  const [todoHorizon, setTodoHorizon] = useState("today");
  const [newTodo, setNewTodo] = useState({ text:"", duration:"30min", project:"", horizon:"today" });
  const [addingTodo, setAddingTodo] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null); // id of todo being edited
  const [crmFilter, setCrmFilter] = useState("all");
  const crmSearchValue = useRef("");
  const [crmSearchTick, setCrmSearchTick] = useState(0);
  const [editingStages, setEditingStages] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const CRM_STAGES = domain.crmStages || CRM_STAGES_DEFAULT;
  const setCrmStages = (stages) => onUpdate({ ...domain, crmStages: stages });
  const [selectedContact, setSelectedContact] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  const [addingContact, setAddingContact] = useState(false);
  const [selectedCall, setSelectedCall]   = useState(null);
  const [writingCall, setWritingCall]     = useState(null);
  const [recording, setRecording]         = useState(false);
  const [transcript, setTranscript]       = useState("");
  const [generatingNotes, setGeneratingNotes] = useState(false);
  const [recordedNotes, setRecordedNotes] = useState("");
  const recognitionRef = useRef(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [notesQuery, setNotesQuery]       = useState("");
  const [notesAnswer, setNotesAnswer]     = useState("");
  const [queryingNotes, setQueryingNotes] = useState(false);
  const crmSearchTimer = useRef(null);
  const notesQueryRef  = useRef(null);
  const [nameQuery, setNameQuery]         = useState("");
  const [summarizing, setSummarizing]     = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [addingProject, setAddingProject]     = useState(false);
  const [projectNoteText, setProjectNoteText] = useState("");
  const [granolaOpen, setGranolaOpen]         = useState(false);  // "contact" | "project" | null
  const [granolaMeetings, setGranolaMeetings] = useState([]);
  const [granolaLoading, setGranolaLoading]   = useState(false);
  const [granolaImporting, setGranolaImporting] = useState(null); // meeting id being imported

  const todos    = domain.todos    || [];
  const contacts = domain.contacts || [];
  const calls    = domain.calls    || [];

  const setTodos    = (t) => onUpdate({ ...domain, todos: t });
  const setContacts = (c) => onUpdate({ ...domain, contacts: c });
  const setCalls    = (c) => onUpdate({ ...domain, calls: c });

  const contactName = (id) => contacts.find(c => c.id === id)?.name || "—";

  const WORK_TABS = [
    { id: "todos",    label: "ToDos" },
    { id: "crm",      label: "People" },
    { id: "projects", label: "Projects" },
  ];

  // ── Domain header ────────────────────────────────────────────────────────
  const Header = () => (
    <div style={{ paddingTop: 8, paddingBottom: 16, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'SF Mono','Fira Code',monospace",
        letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12 }}>
        {domain.question}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 4, height: 28, borderRadius: 2, background: domain.color, flexShrink: 0 }} />
        <span style={{ fontSize: 22, color: domain.color }}>{domain.glyph}</span>
        <span style={{ fontSize: 24, color: C.navy, fontWeight: 700, letterSpacing: "-0.5px" }}>Work</span>
      </div>
      <div style={{ fontSize: 13, color: C.inkLight, lineHeight: 1.6, marginBottom: 12 }}>{domain.identity}</div>
      <div style={{ height: 1, background: C.border, marginBottom: 12 }} />
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
        {(() => {
          // ── WORK HEALTH SCORE ALGORITHM ───────────────────────────────────
          const now = new Date();
          const msPerDay = 86400000;
          const daysSince = (dateStr) => {
            if (!dateStr) return 999;
            const d = new Date(dateStr);
            return isNaN(d) ? 999 : Math.floor((now - d) / msPerDay);
          };

          // 1. TODO VELOCITY (0–100)
          const allTodos = domain.todos || [];
          const weekTodos = allTodos.filter(t => t.horizon === "this week");
          const doneTodos = allTodos.filter(t => t.done);
          const doneRecent = doneTodos.filter(t => daysSince(t.doneAt) <= 7).length;
          const doneLastWeek = doneTodos.filter(t => { const d = daysSince(t.doneAt); return d > 7 && d <= 14; }).length;
          const completionRate = weekTodos.length > 0 ? (doneRecent / Math.max(weekTodos.length, 1)) : 0;
          const velocityTrend = doneRecent >= doneLastWeek ? 1 : -1;
          const todoScore = Math.min(100, Math.round(
            (completionRate * 60) +                          // completion rate weighted 60%
            (Math.min(doneRecent, 10) / 10 * 30) +          // raw volume weighted 30%
            (velocityTrend > 0 ? 10 : 0)                    // trend bonus 10%
          ));

          // 2. PROJECT MOMENTUM (0–100)
          const projects = domain.projects || [];
          const activeProjects = projects.filter(p => p.status === "active");
          let projectScore = 50; // default neutral
          if (activeProjects.length > 0) {
            const projScores = activeProjects.map(p => {
              const milestones = p.milestones || [];
              const parents = milestones.filter(m => !m.parentId);
              if (parents.length === 0) return 50;
              const milestoneScores = parents.map(m => {
                const children = milestones.filter(c => c.parentId === m.id);
                const subPct = children.length > 0
                  ? Math.round(children.filter(c => c.done).length / children.length * 100)
                  : (m.done ? 100 : 0);
                let datePct = 0;
                if (m.dueRaw) {
                  const due = new Date(m.dueRaw);
                  const start = m.startRaw ? new Date(m.startRaw) : new Date(now.getFullYear(), 0, 1);
                  datePct = Math.min(100, Math.max(0, Math.round((now - start) / (due - start) * 100)));
                }
                // On track = subPct >= datePct, bonus for ahead of schedule
                const delta = subPct - datePct;
                return Math.min(100, Math.max(0, 50 + delta));
              });
              const avgMilestone = milestoneScores.reduce((a,b) => a+b, 0) / milestoneScores.length;
              // Recent notes boost (+10 if note in last 7 days)
              const recentNote = (p.notes||[]).some(n => daysSince(n.date) <= 7);
              return Math.min(100, avgMilestone + (recentNote ? 10 : 0));
            });
            projectScore = Math.round(projScores.reduce((a,b) => a+b, 0) / projScores.length);
          }

          // 3. PEOPLE ENGAGEMENT (0–100)
          const calls = domain.calls || [];
          const contacts = domain.contacts || [];
          const recentCalls = calls.filter(c => daysSince(c.date) <= 7);
          const prevCalls = calls.filter(c => { const d = daysSince(c.date); return d > 7 && d <= 14; });
          const uniqueRecent = new Set(recentCalls.map(c => c.contactId)).size;
          const uniquePrev = new Set(prevCalls.map(c => c.contactId)).size;
          const engagementTrend = uniqueRecent >= uniquePrev ? 1 : -1;
          const followUpsDone = contacts.reduce((acc, c) => acc + (c.followUps||[]).filter(f => f.done).length, 0);
          const followUpsTotal = contacts.reduce((acc, c) => acc + (c.followUps||[]).length, 0);
          const fuRatio = followUpsTotal > 0 ? followUpsDone / followUpsTotal : 0.5;
          const peopleScore = Math.min(100, Math.round(
            (Math.min(uniqueRecent, 8) / 8 * 50) +          // unique contacts touched 50%
            (fuRatio * 30) +                                 // follow-up completion 30%
            (engagementTrend > 0 ? 20 : 0)                  // trend bonus 20%
          ));

          // COMPOSITE SCORE
          const composite = Math.round((todoScore * 0.33) + (projectScore * 0.34) + (peopleScore * 0.33));
          const dots = Math.max(1, Math.min(5, Math.ceil(composite / 20)));

          // TREND COLOR: compare vs stored previous score
          const prevScore = domain.prevWorkScore || composite;
          const delta = composite - prevScore;
          const trendColor = delta > 3 ? C.green : delta < -3 ? C.red : C.gold;

          // Store score for next comparison (debounced via onUpdate would cause loops, use ref pattern)
          // We display tooltip with breakdown on hover
          return (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
              <div style={{ display:"flex", gap:6 }}>
                {[1,2,3,4,5].map(v => (
                  <div key={v} style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: v <= dots ? trendColor : C.border,
                    transition: "background 0.3s"
                  }} />
                ))}
              </div>
              <div style={{ fontSize:9, color:trendColor, fontFamily:"'SF Mono','Fira Code',monospace",
                opacity:0.7, letterSpacing:"0.05em" }}>
                {composite}pts · {delta > 3 ? "▲" : delta < -3 ? "▼" : "—"} {todoScore}T / {projectScore}P / {peopleScore}E
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );

  // ── TODOS ────────────────────────────────────────────────────────────────
  const DURATIONS = ["15min","30min","1hr","2hr","half-day","full-day"];
  const DUR_COLOR = { "15min":C.green,"30min":C.green,"1hr":C.gold,"2hr":C.gold,"half-day":C.red,"full-day":C.red };
  const HORIZON_MOVES = {
    today:   [{ label:"→ this week", to:"this week" }, { label:"→ someday", to:"someday" }],
    "this week": [{ label:"→ today", to:"today" }, { label:"→ someday", to:"someday" }],
    someday: [{ label:"→ today", to:"today" }, { label:"→ this week", to:"this week" }],
  };

  const TodosTab = () => {
    const filtered = todos.filter(t => t.horizon === todoHorizon);
    const open = filtered.filter(t => !t.done);
    const done = filtered.filter(t => t.done);
    const durMins = {"15min":15,"30min":30,"1hr":60,"2hr":120,"half-day":240,"full-day":480};
    const totalMins = open.reduce((a,t) => a+(durMins[t.duration]||0),0);
    const totalLabel = totalMins>=480 ? `${(totalMins/480).toFixed(1)}d`
      : totalMins>=60 ? `${(totalMins/60).toFixed(1)}hr` : `${totalMins}min`;

    return (
      <div>
        {/* Horizon tabs */}
        <div style={{ display:"flex", gap:0, marginBottom:12, borderBottom:`1px solid ${C.border}` }}>
          {HORIZONS.map(h => {
            const count = todos.filter(t => t.horizon===h && !t.done).length;
            return (
              <button key={h} onClick={() => setTodoHorizon(h)} style={{
                flex:1, background:"transparent", border:"none",
                borderBottom:`2px solid ${todoHorizon===h ? domain.color : "transparent"}`,
                color:todoHorizon===h ? domain.color : C.inkFaint,
                padding:"8px 4px", fontSize:12, cursor:"pointer",
                fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
                textTransform:"capitalize", marginBottom:-1 }}>
                {h}{count>0 && <span style={{fontSize:10,opacity:0.65,marginLeft:4}}>({count})</span>}
              </button>
            );
          })}
        </div>

        {open.length > 0 && (
          <div style={{fontSize:11,color:C.inkFaint,fontStyle:"italic",textAlign:"right",marginBottom:10}}>
            {open.length} tasks · {totalLabel} total
          </div>
        )}

        {/* Open todos */}
        <div style={{ display:"flex", flexDirection:"column" }}>
          {open.length===0 && !addingTodo && (
            <div style={{fontSize:13,color:C.inkFaint,fontStyle:"italic",textAlign:"center",padding:"16px 0"}}>
              {todoHorizon==="today"?"Clear for today.":todoHorizon==="this week"?"Nothing this week.":"Someday list is empty."}
            </div>
          )}
          {open.map(t => {
            if (editingTodo===t.id) return <TodoEditRow key={t.id} t={t} domainColor={domain.color} todos={todos} setTodos={setTodos} setEditingTodo={setEditingTodo} />;
            return (
              <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,
                padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>

                {/* Checkbox */}
                <div onClick={() => setTodos(todos.map(x => x.id===t.id?{...x,done:true,doneAt:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}:x))}
                  style={{width:17,height:17,borderRadius:3,flexShrink:0,marginTop:2,
                    border:`2px solid ${C.borderMid}`,background:"transparent",cursor:"pointer"}} />

                {/* Text + meta — tap text to open edit */}
                <div style={{flex:1,minWidth:0}}>
                  <div onClick={() => setEditingTodo(t.id)}
                    style={{fontSize:14,color:C.ink,fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                      lineHeight:1.4,cursor:"text"}}>{t.text}</div>
                  <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center",flexWrap:"wrap"}}>
                    <span onClick={() => {
                      const idx=DURATIONS.indexOf(t.duration);
                      setTodos(todos.map(x => x.id===t.id?{...x,duration:DURATIONS[(idx+1)%DURATIONS.length]}:x));
                    }} style={{fontSize:10,color:DUR_COLOR[t.duration]||C.inkFaint,
                      background:(DUR_COLOR[t.duration]||C.inkFaint)+"18",
                      border:`1px solid ${DUR_COLOR[t.duration]||C.inkFaint}33`,
                      borderRadius:10,padding:"1px 7px",fontFamily:"'SF Mono','Fira Code',monospace",
                      cursor:"pointer",userSelect:"none"}}>{t.duration}</span>
                    {t.project && (
                      <span style={{fontSize:10,color:domain.color,fontFamily:"'SF Mono','Fira Code',monospace"}}>{t.project}</span>
                    )}
                    {t.contactId && (
                      <span style={{fontSize:10,color:C.inkFaint,fontStyle:"italic"}}>→ {contactName(t.contactId)}</span>
                    )}
                  </div>
                </div>

                {/* Move buttons */}
                <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0}}>
                  {HORIZON_MOVES[t.horizon].map(({label,to}) => (
                    <button key={to} onClick={() => setTodos(todos.map(x => x.id===t.id?{...x,horizon:to}:x))}
                      style={{background:"transparent",border:`1px solid ${C.borderMid}`,
                        borderRadius:3,color:to==="today"?C.caqi:C.inkFaint,
                        fontSize:9,padding:"2px 6px",cursor:"pointer",
                        fontFamily:"'SF Mono','Fira Code',monospace",whiteSpace:"nowrap",lineHeight:1.4}}>{label}</button>
                  ))}
                </div>

                {/* Delete */}
                <button onClick={() => setTodos(todos.filter(x => x.id!==t.id))}
                  style={{background:"transparent",border:"none",color:C.inkFaint,
                    cursor:"pointer",fontSize:14,padding:0,flexShrink:0}}>×</button>
              </div>
            );
          })}
        </div>

        {/* Add new */}
        {addingTodo ? (() => {
          const suggestion = newTodo.text.length >= 2
            ? (todos.find(t => t.text.toLowerCase().startsWith(newTodo.text.toLowerCase()) && t.text !== newTodo.text)?.text || "")
            : "";
          return (
          <div style={{marginTop:12,padding:"12px 0",borderTop:`1px solid ${C.border}`}}>
            <div style={{ position:"relative", marginBottom:12 }}>
              <input
                dir="ltr"
                value={newTodo.text}
                onChange={e => setNewTodo({...newTodo, text:e.target.value})}
                placeholder="What needs doing?"
                autoFocus
                onKeyDown={e => {
                  if ((e.key === "Tab" || e.key === "ArrowRight") && suggestion) {
                    e.preventDefault();
                    setNewTodo({...newTodo, text: suggestion});
                  }
                  if (e.key === "Escape") setAddingTodo(false);
                }}
                style={{width:"100%",background:"transparent",border:"none",
                  borderBottom:`1px solid ${domain.color}`,color:C.ink,fontSize:14,
                  fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",fontStyle:"italic",
                  padding:"4px 0",outline:"none",boxSizing:"border-box"}} />
              {suggestion && (
                <div style={{ fontSize:10, color:C.inkFaint,
                  fontFamily:"'SF Mono','Fira Code',monospace", marginTop:4 }}>
                  Tab → <span style={{ color:C.caqi }}>{suggestion}</span>
                </div>
              )}
            </div>

            <div style={{fontSize:10,color:C.inkFaint,fontFamily:"'SF Mono','Fira Code',monospace",
              textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Time needed</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
              {DURATIONS.map(d => (
                <button key={d} onClick={() => setNewTodo({...newTodo,duration:d})}
                  style={{background:newTodo.duration===d?DUR_COLOR[d]:"transparent",
                    color:newTodo.duration===d?"#fff":DUR_COLOR[d],
                    border:`1.5px solid ${DUR_COLOR[d]}`,
                    borderRadius:10,padding:"3px 10px",fontSize:11,cursor:"pointer",
                    fontFamily:"'SF Mono','Fira Code',monospace"}}>{d}</button>
              ))}
            </div>

            <div style={{fontSize:10,color:C.inkFaint,fontFamily:"'SF Mono','Fira Code',monospace",
              textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>When</div>
            <div style={{display:"flex",gap:4,marginBottom:12}}>
              {HORIZONS.map(h => (
                <button key={h} onClick={() => setNewTodo({...newTodo,horizon:h})}
                  style={{flex:1,background:newTodo.horizon===h?domain.color:"transparent",
                    color:newTodo.horizon===h?"#fff":C.inkLight,
                    border:`1.5px solid ${newTodo.horizon===h?domain.color:C.border}`,
                    borderRadius:4,padding:"4px 4px",fontSize:11,cursor:"pointer",
                    fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",fontStyle:"italic",
                    textTransform:"capitalize"}}>{h}</button>
              ))}
            </div>

            <div style={{fontSize:10,color:C.inkFaint,fontFamily:"'SF Mono','Fira Code',monospace",
              textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Project</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
              {PROJECTS.map(p => (
                <button key={p} onClick={() => setNewTodo({...newTodo,project:newTodo.project===p?"":p})}
                  style={{background:newTodo.project===p?domain.color:"transparent",
                    color:newTodo.project===p?"#fff":C.inkLight,
                    border:`1px solid ${newTodo.project===p?domain.color:C.border}`,
                    borderRadius:4,padding:"2px 9px",fontSize:10,cursor:"pointer",
                    fontFamily:"'SF Mono','Fira Code',monospace"}}>{p}</button>
              ))}
            </div>

            <div style={{display:"flex",gap:8}}>
              <button onClick={() => {
                if (!newTodo.text.trim()) return;
                setTodos([...todos,{...newTodo,id:`t${Date.now()}`,done:false}]);
                setNewTodo({text:"",duration:"30min",project:"",horizon:todoHorizon});
                setAddingTodo(false);
              }} style={{background:domain.color,border:"none",borderRadius:4,color:"#fff",
                fontSize:12,padding:"6px 16px",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>Add</button>
              <button onClick={() => setAddingTodo(false)}
                style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:4,
                  color:C.inkFaint,fontSize:12,padding:"6px 10px",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
            </div>
          </div>
        );})() : null }
        {!addingTodo && (
          <button onClick={() => { setAddingTodo(true); setNewTodo(n => ({...n,horizon:todoHorizon})); }}
            style={{width:"100%",background:"transparent",border:`1px dashed ${C.borderMid}`,
              borderRadius:6,padding:"9px",color:C.inkFaint,fontSize:12,cursor:"pointer",
              fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",fontStyle:"italic",marginTop:10}}>+ Add task</button>
        )}

        {/* Done */}
        {done.length>0 && (
          <div style={{marginTop:20}}>
            <SectionRule label={`done · ${done.length}`} color={C.inkFaint} />
            {done.map(t => {
              if (editingTodo===t.id) return <TodoEditRow key={t.id} t={t} domainColor={domain.color} todos={todos} setTodos={setTodos} setEditingTodo={setEditingTodo} />;
              return (
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,
                  padding:"8px 0",borderBottom:`1px solid ${C.border}`,opacity:0.4}}>
                  <div onClick={() => setTodos(todos.map(x => x.id===t.id?{...x,done:false}:x))}
                    style={{width:17,height:17,borderRadius:3,flexShrink:0,
                      background:C.green,border:`2px solid ${C.green}`,
                      cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{fontSize:9,color:"#fff",fontWeight:700}}>✓</span>
                  </div>
                  <span onClick={() => setEditingTodo(t.id)}
                    style={{fontSize:13,color:C.inkMid,textDecoration:"line-through",
                      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",flex:1,cursor:"text"}}>{t.text}</span>
                  {t.doneAt && (
                    <span style={{fontSize:9,color:C.inkFaint,fontFamily:"'SF Mono','Fira Code',monospace",
                      flexShrink:0,whiteSpace:"nowrap"}}>{t.doneAt}</span>
                  )}
                  <button onClick={() => setTodos(todos.filter(x => x.id!==t.id))}
                    style={{background:"transparent",border:"none",color:C.inkFaint,
                      cursor:"pointer",fontSize:12,padding:0}}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };


  // ── CRM ──────────────────────────────────────────────────────────────────
  const CRMTab = () => {
    const filtered = crmFilter === "all" ? contacts : contacts.filter(c => c.stage === crmFilter);
    const contact  = selectedContact ? contacts.find(c => c.id === selectedContact) : null;
    const contactNotes = contact ? calls.filter(cl => cl.contactId === contact.id)
      .sort((a,b) => new Date(b.date) - new Date(a.date)) : [];
    const today = new Date().toLocaleDateString("en-US", { month:"long", day:"numeric" });
    const isWriting = writingCall?.contactId === selectedContact;
    const noteRef = useRef(null);
    const editNoteRef = useRef(null);

    const updateContact = (field, value) =>
      setContacts(contacts.map(c => c.id===selectedContact ? { ...c, [field]:value } : c));

    // Strip HTML to plain text for AI
    const stripHtml = (html) => {
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      return tmp.innerText || tmp.textContent || "";
    };

    const saveNote = async () => {
      const html = noteRef.current?.innerHTML?.trim() || "";
      const text = stripHtml(html);
      if (!text || !selectedContact) { setWritingCall(null); return; }
      const newCall = { id:`cl${Date.now()}`, contactId:selectedContact,
        date: writingCall?.date || today, notes: html };
      const updated = [newCall, ...calls];
      onUpdate({ ...domain, calls: updated,
        contacts: (domain.contacts||[]).map(c =>
          c.id===selectedContact ? { ...c, lastContact: newCall.date } : c) });
      setWritingCall(null);
      // Summary NOT auto-triggered — user clicks the button manually
    };

    const startRecording = () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Speech recognition not supported in this browser. Try Chrome or Safari.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      let finalTranscript = "";
      recognition.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalTranscript += t + " ";
          else interim += t;
        }
        setTranscript(finalTranscript + interim);
      };
      recognition.onerror = (e) => {
        console.error("Speech error:", e.error);
        setRecording(false);
      };
      recognition.onend = () => setRecording(false);
      recognitionRef.current = recognition;
      recognition.start();
      setRecording(true);
      setTranscript("");
      setRecordedNotes("");
    };

    const stopRecording = async () => {
      recognitionRef.current?.stop();
      setRecording(false);
      const raw = transcript.trim();
      if (!raw) return;
      setGeneratingNotes(true);
      const contact = contacts.find(c => c.id === selectedContact);
      try {
        const res = await fetch("/api/claude", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514", max_tokens: 1000,
            messages:[{ role:"user", content:
              `You are helping an investor take notes from a meeting transcript.

Contact: ${contact?.name} (${contact?.role} at ${contact?.company})

Raw transcript:
${raw}

Convert this into clean, structured meeting notes. Format:
- 2-3 sentences of what was discussed
- Key points or decisions (bullet list)
- Next actions or commitments

Write in first person. Be concise. Return plain text, no markdown headers.` }]
          })
        });
        const data = await res.json();
        const notes = data.content?.find(b => b.type==="text")?.text || raw;
        setRecordedNotes(notes);
      } catch(e) {
        setRecordedNotes(raw); // fall back to raw transcript
      }
      setGeneratingNotes(false);
    };

    const saveRecordedNote = async () => {
      if (!recordedNotes.trim() || !selectedContact) return;
      // Convert plain text to HTML with line breaks
      const html = recordedNotes.split("\n").map(l =>
        l.startsWith("- ") ? `<li>${l.slice(2)}</li>` : `<p>${l}</p>`
      ).join("");
      const newCall = { id:`cl${Date.now()}`, contactId:selectedContact, date:today, notes:html };
      const updated = [newCall, ...calls];
      onUpdate({ ...domain, calls: updated,
        contacts: (domain.contacts||[]).map(c =>
          c.id===selectedContact ? { ...c, lastContact: newCall.date } : c) });
      setRecordedNotes("");
      setTranscript("");
      // Summary NOT auto-triggered — user clicks the button manually
    };

    const saveEditedNote = (noteId) => {
      const html = editNoteRef.current?.innerHTML?.trim() || "";
      if (!html) { setEditingNoteId(null); return; }
      const updated = calls.map(cl => cl.id === noteId ? { ...cl, notes: html } : cl);
      onUpdate({ ...domain, calls: updated });
      setEditingNoteId(null);
    };


    if (contact) {
      const warmth = contactWarmth(contact.lastContact);
      return (
        <div>
          <button onClick={() => {
            setSelectedContact(null);
            setWritingCall(null);
            setNotesQuery("");
            setNotesAnswer("");
            // Clear search on back
            crmSearchValue.current = "";
            const el = document.getElementById("crm-search-input");
            if (el) el.value = "";
            setCrmSearchTick(t => t+1);
          }}
            style={{ background:"transparent", border:"none", color:domain.color,
              cursor:"pointer", fontSize:12, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
              padding:"0 0 14px", display:"block" }}>← people</button>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:12,
            paddingBottom:14, marginBottom:12, borderBottom:`1px solid ${C.border}` }}>
            <div style={{ width:42, height:42, borderRadius:"50%", flexShrink:0,
              background:STAGE_COLOR[contact.stage]+"22",
              border:`1.5px solid ${STAGE_COLOR[contact.stage]}55`,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:17, color:STAGE_COLOR[contact.stage],
                fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontWeight:600 }}>{contact.name[0]}</span>
            </div>
            <div style={{ flex:1 }}>
              <EditField label="" field="name" value={contact.name} placeholder="Name" accentColor={domain.color} onCommit={updateContact} />
              <div style={{ fontSize:12, color:C.inkLight, marginBottom:8 }}>
                <EditField label="" field="role" value={contact.role} placeholder="Role" accentColor={domain.color} onCommit={updateContact} />
                <EditField label="" field="company" value={contact.company} placeholder="Company" accentColor={domain.color} onCommit={updateContact} />
              </div>
              {/* Warmth dots — driven by last contact date */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ display:"flex", gap:4 }}>
                  {[1,2,3,4,5].map(v => (
                    <div key={v} style={{ width:8, height:8, borderRadius:"50%",
                      background: v<=warmth ? WARMTH_COLOR(warmth) : C.border }} />
                  ))}
                </div>
                <span style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace" }}>
                  {contact.lastContact ? `last spoke ${contact.lastContact}` : "never contacted"}
                </span>
              </div>
            </div>
            {!isWriting && !recording && !recordedNotes && (
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <button onClick={() => setWritingCall({ contactId:selectedContact, date:today })}
                  style={{ background:domain.color, border:"none", borderRadius:4, color:"#fff",
                    fontSize:11, padding:"5px 12px", cursor:"pointer",
                    fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", fontWeight:600 }}>+ note</button>
                <button onClick={startRecording}
                  style={{ background:"transparent", border:`1.5px solid ${C.red}`,
                    borderRadius:4, color:C.red, fontSize:11, padding:"5px 10px",
                    cursor:"pointer", fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>🎙 record</button>
                <button onClick={() => granolaOpen==="contact" ? setGranolaOpen(null) : openGranola("contact")}
                  style={{ background:"transparent", border:`1.5px solid #16a34a`,
                    borderRadius:4, color:"#16a34a", fontSize:11, padding:"5px 10px",
                    cursor:"pointer", fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>🌿 Granola</button>
              </div>
            )}
          </div>

          {/* Stage */}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
            {CRM_STAGES.map(s => (
              <button key={s} onClick={() => updateContact("stage", s)}
                style={{ background:contact.stage===s ? STAGE_COLOR[s] : "transparent",
                  color:contact.stage===s ? "#fff" : STAGE_COLOR[s],
                  border:`1.5px solid ${STAGE_COLOR[s]}`,
                  borderRadius:6, padding:"3px 10px", fontSize:10, fontWeight:500, cursor:"pointer",
                  fontFamily:"'SF Mono','Fira Code',monospace", textTransform:"capitalize" }}>{s}</button>
            ))}
          </div>

          {/* Contact details */}
          {[
            { label:"Email", field:"email", icon:"✉", href:(v)=>`mailto:${v}` },
            { label:"Phone", field:"phone", icon:"✆", href:(v)=>`tel:${v}` },
            { label:"LinkedIn", field:"linkedin", icon:"in", href:(v)=>`https://${v.replace("https://","")}` },
          ].map(({ label, field, icon, href }) => contact[field] ? (
            <div key={field} style={{ padding:"6px 0", borderBottom:`1px solid ${C.border}`,
              display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:10, color:C.inkFaint, width:14, flexShrink:0 }}>{icon}</span>
              <a href={href(contact[field])} target="_blank" rel="noopener noreferrer"
                style={{ fontSize:12, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                  textDecoration:"none" }}>{contact[field]}</a>
            </div>
          ) : null)}

          {/* Editable contact details */}
          <EditField label="Email" field="email" value={contact.email} placeholder="email@example.com" accentColor={domain.color} onCommit={updateContact} />
          <EditField label="Phone" field="phone" value={contact.phone} placeholder="+1 212 555 0000" accentColor={domain.color} onCommit={updateContact} />
          <EditField label="LinkedIn" field="linkedin" value={contact.linkedin} placeholder="linkedin.com/in/name" accentColor={domain.color} onCommit={updateContact} />
          <EditField label="Personal" field="personal" value={contact.personal}
            placeholder="Kids, interests, things they've shared about their life…" multiline accentColor={domain.color} onCommit={updateContact} />
          <EditField label="Context" field="notes" value={contact.notes}
            placeholder="Professional context, how you met…" multiline accentColor={domain.color} onCommit={updateContact} />

          {/* Open todos */}
          {todos.filter(t => t.contactId===contact.id && !t.done).length > 0 && (
            <div style={{ margin:"12px 0" }}>
              <SectionRule label="open tasks" color={domain.color} />
              {todos.filter(t => t.contactId===contact.id && !t.done).map(t => (
                <div key={t.id} style={{ display:"flex", gap:8, alignItems:"flex-start",
                  padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div onClick={() => setTodos(todos.map(x => x.id===t.id?{...x,done:true,doneAt:new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"})}:x))}
                    style={{ width:15, height:15, borderRadius:3, flexShrink:0, marginTop:2,
                      border:`2px solid ${C.borderMid}`, background:"transparent", cursor:"pointer" }} />
                  <span style={{ fontSize:13, color:C.inkMid, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                    fontStyle:"italic", flex:1 }}>{t.text}</span>
                  <span style={{ fontSize:10, color:DUR_COLOR[t.duration]||C.inkFaint,
                    fontFamily:"'SF Mono','Fira Code',monospace" }}>{t.duration}</span>
                </div>
              ))}
            </div>
          )}

          {/* Follow-up points */}
          {(() => {
            const followUps = contact.followUps || [];
            const addFollowUp = (text) => {
              if (!text.trim()) return;
              const updated = contacts.map(c => c.id===contact.id
                ? { ...c, followUps: [...(c.followUps||[]), { id:`fu${Date.now()}`, text, done:false }] }
                : c);
              setContacts(updated);
            };
            const toggleFollowUp = (fuId) => {
              const updated = contacts.map(c => c.id===contact.id
                ? { ...c, followUps: (c.followUps||[]).map(f => f.id===fuId ? { ...f, done:!f.done } : f) }
                : c);
              setContacts(updated);
            };
            const deleteFollowUp = (fuId) => {
              const updated = contacts.map(c => c.id===contact.id
                ? { ...c, followUps: (c.followUps||[]).filter(f => f.id!==fuId) }
                : c);
              setContacts(updated);
            };
            return (
              <div style={{ margin:"12px 0" }}>
                <SectionRule label="follow-up points" color={C.gold} />
                {followUps.map(f => (
                  <div key={f.id} style={{ display:"flex", alignItems:"center", gap:8,
                    padding:"7px 0", borderBottom:`1px solid ${C.border}`,
                    opacity: f.done ? 0.45 : 1 }}>
                    <div onClick={() => toggleFollowUp(f.id)}
                      style={{ width:15, height:15, borderRadius:"50%", flexShrink:0,
                        border:`2px solid ${C.gold}`,
                        background: f.done ? C.gold : "transparent",
                        cursor:"pointer", display:"flex", alignItems:"center",
                        justifyContent:"center" }}>
                      {f.done && <span style={{ fontSize:8, color:"#fff", fontWeight:700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize:13, color:C.inkMid, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                      fontStyle:"italic", flex:1,
                      textDecoration: f.done ? "line-through" : "none" }}>{f.text}</span>
                    <button onClick={() => deleteFollowUp(f.id)}
                      style={{ background:"transparent", border:"none", color:C.inkFaint,
                        cursor:"pointer", fontSize:13, padding:0 }}>×</button>
                  </div>
                ))}
                <FollowUpInput onAdd={addFollowUp} accentColor={C.gold} />
              </div>
            );
          })()}

          {/* Recording UI */}
          {(recording || generatingNotes || recordedNotes) && (
            <div style={{ margin:"14px 0", border:`1.5px solid ${C.red}33`,
              borderLeft:`3px solid ${C.red}`, borderRadius:6, overflow:"hidden" }}>

              {/* Recording header */}
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"10px 14px", background:`${C.red}08`,
                borderBottom:`1px solid ${C.red}22` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {recording && (
                    <div style={{ width:8, height:8, borderRadius:"50%", background:C.red,
                      animation:"pulse 1s infinite" }} />
                  )}
                  <span style={{ fontSize:11, color:C.red, fontFamily:"'SF Mono','Fira Code',monospace",
                    textTransform:"uppercase", letterSpacing:"0.08em" }}>
                    {recording ? "Recording…" : generatingNotes ? "Generating notes…" : "Review notes"}
                  </span>
                </div>
                {recording && (
                  <button onClick={stopRecording}
                    style={{ background:C.red, border:"none", borderRadius:4, color:"#fff",
                      fontSize:11, padding:"4px 14px", cursor:"pointer",
                      fontFamily:"inherit", fontWeight:600 }}>Stop + generate</button>
                )}
                {!recording && !generatingNotes && (
                  <button onClick={() => { setRecordedNotes(""); setTranscript(""); }}
                    style={{ background:"transparent", border:"none", color:C.inkFaint,
                      cursor:"pointer", fontSize:14, padding:0 }}>×</button>
                )}
              </div>

              {/* Live transcript */}
              {(recording || transcript) && !recordedNotes && (
                <div style={{ padding:"10px 14px", maxHeight:120, overflowY:"auto" }}>
                  <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
                    textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
                    Live transcript
                  </div>
                  <div style={{ fontSize:13, color:C.inkMid, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                    fontStyle:"italic", lineHeight:1.7 }}>
                    {transcript || <span style={{ opacity:0.4 }}>Start speaking…</span>}
                  </div>
                </div>
              )}

              {/* Generating spinner */}
              {generatingNotes && (
                <div style={{ padding:"14px", fontSize:12, color:C.inkFaint, fontStyle:"italic" }}>
                  Claude is reading the transcript…
                </div>
              )}

              {/* Generated notes — editable before saving */}
              {recordedNotes && !generatingNotes && (
                <div style={{ padding:"10px 14px" }}>
                  <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
                    textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>
                    Generated notes · tap to edit
                  </div>
                  <textarea
                    dir="ltr"
                    value={recordedNotes}
                    onChange={e => setRecordedNotes(e.target.value)}
                    style={{ width:"100%", background:"transparent", border:"none",
                      color:C.ink, fontSize:13, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                      fontStyle:"italic", lineHeight:1.7,
                      padding:0, outline:"none", resize:"none",
                      boxSizing:"border-box", direction:"ltr", textAlign:"left",
                      unicodeBidi:"plaintext", minHeight:120 }}
                    rows={6}
                  />
                  <div style={{ display:"flex", justifyContent:"flex-end", gap:8,
                    borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:8 }}>
                    <button onClick={() => { setRecordedNotes(""); setTranscript(""); startRecording(); }}
                      style={{ background:"transparent", border:`1px solid ${C.red}`,
                        borderRadius:4, color:C.red, fontSize:11, padding:"5px 12px",
                        cursor:"pointer", fontFamily:"inherit" }}>🎙 Record again</button>
                    <button onClick={saveRecordedNote}
                      style={{ background:domain.color, border:"none", borderRadius:4,
                        color:"#fff", fontSize:12, padding:"5px 16px", cursor:"pointer",
                        fontFamily:"inherit", fontWeight:600 }}>Save note</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Granola import panel */}
          {granolaOpen === "contact" && (
            <GranolaPanel
              meetings={granolaMeetings}
              loading={granolaLoading}
              importing={granolaImporting}
              onClose={() => setGranolaOpen(null)}
              onSelect={(m) => importGranolaMeeting(m, "contact", (note) => {
                const updated = [{ ...note, contactId: selectedContact }, ...calls];
                onUpdate({ ...domain, calls: updated,
                  contacts: (domain.contacts||[]).map(c =>
                    c.id===selectedContact ? { ...c, lastContact: note.date } : c) });
              })}
            />
          )}
          {isWriting && (
            <div style={{ margin:"14px 0", background:C.surface,
              border:`1px solid ${domain.color}44`, borderLeft:`3px solid ${domain.color}`,
              borderRadius:6, overflow:"hidden" }}>
              {/* Rich text toolbar */}
              <div style={{ display:"flex", gap:2, padding:"6px 10px",
                borderBottom:`1px solid ${C.border}`, flexWrap:"wrap" }}>
                {[
                  { cmd:"bold",          icon:"B",  style:{ fontWeight:700 } },
                  { cmd:"italic",        icon:"I",  style:{ fontStyle:"italic" } },
                  { cmd:"underline",     icon:"U",  style:{ textDecoration:"underline" } },
                ].map(({ cmd, icon, style:s }) => (
                  <button key={cmd}
                    onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }}
                    style={{ background:"transparent", border:`1px solid ${C.border}`,
                      borderRadius:3, width:26, height:24, cursor:"pointer",
                      fontSize:12, color:C.inkMid, ...s }}>
                    {icon}
                  </button>
                ))}
                <div style={{ width:1, background:C.border, margin:"0 4px" }} />
                {[
                  { cmd:"insertUnorderedList", icon:"• —" },
                  { cmd:"insertOrderedList",   icon:"1." },
                  { cmd:"indent",              icon:"→" },
                  { cmd:"outdent",             icon:"←" },
                ].map(({ cmd, icon }) => (
                  <button key={cmd}
                    onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }}
                    style={{ background:"transparent", border:`1px solid ${C.border}`,
                      borderRadius:3, padding:"0 7px", height:24, cursor:"pointer",
                      fontSize:11, color:C.inkMid, fontFamily:"'SF Mono','Fira Code',monospace" }}>
                    {icon}
                  </button>
                ))}
              </div>
              <div style={{ padding:14 }}>
                <div style={{ fontSize:10, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                  textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{today}</div>
                <div ref={noteRef} dir="ltr" contentEditable suppressContentEditableWarning suppressContentEditableWarning
                  style={{ width:"100%", minHeight:140, background:"transparent", border:"none",
                    color:C.ink, fontSize:14, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", lineHeight:1.8,
                    outline:"none", direction:"ltr", textAlign:"left",
                    whiteSpace:"pre-wrap", wordBreak:"break-word" }}
                  data-placeholder="Write freely…" onKeyDown={noteKeyHandler} />
                <div style={{ display:"flex", justifyContent:"flex-end", gap:8,
                  borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:10 }}>
                  <button onClick={() => setWritingCall(null)}
                    style={{ background:"transparent", border:`1px solid ${C.border}`,
                      borderRadius:4, color:C.inkFaint, fontSize:12, padding:"5px 12px",
                      cursor:"pointer", fontFamily:"inherit" }}>Discard</button>
                  <button onClick={saveNote}
                    style={{ background:domain.color, border:"none", borderRadius:4,
                      color:"#fff", fontSize:12, padding:"5px 16px", cursor:"pointer",
                      fontFamily:"inherit", fontWeight:600 }}>Save note</button>
                </div>
              </div>
            </div>
          )}

          {/* AI Summary */}
          {summarizing===selectedContact ? (
            <div style={{ background:domain.colorLight, border:`1px solid ${domain.color}33`,
              borderLeft:`3px solid ${domain.color}`, borderRadius:6,
              padding:"12px 14px", margin:"14px 0" }}>
              <div style={{ fontSize:10, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Summarizing…</div>
              <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic" }}>Claude is reading your notes…</div>
            </div>
          ) : contact.aiSummary ? (
            <div style={{ background:domain.colorLight, border:`1px solid ${domain.color}33`,
              borderLeft:`3px solid ${domain.color}`, borderRadius:6,
              padding:"12px 14px", margin:"14px 0" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div style={{ fontSize:10, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                  textTransform:"uppercase", letterSpacing:"0.08em" }}>Summary</div>
                <button onClick={() => generateSummary(selectedContact)}
                  style={{ background:"transparent", border:"none", color:C.inkFaint,
                    cursor:"pointer", fontSize:10, fontFamily:"'SF Mono','Fira Code',monospace", padding:0 }}>↻ refresh</button>
              </div>
              <div style={{ fontSize:14, color:C.inkMid, fontFamily:"Georgia,serif",
                lineHeight:1.8, fontStyle:"italic" }}>{contact.aiSummary}</div>
            </div>
          ) : contactNotes.length > 0 ? (
            <button onClick={() => generateSummary(selectedContact)}
              style={{ width:"100%", background:"transparent", border:`1px dashed ${domain.color}66`,
                borderRadius:6, padding:"10px", color:domain.color, fontSize:12,
                cursor:"pointer", fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", margin:"14px 0 0" }}>
              Generate summary from notes
            </button>
          ) : null}

          {/* Notes search — AI query across all notes for this contact */}
          {contactNotes.length > 1 && (
            <div style={{ margin:"14px 0" }}>
              <div style={{ position:"relative" }}>
                <input
                  ref={notesQueryRef}
                  dir="ltr"
                  defaultValue=""
                  placeholder="Ask anything about your conversations… (press Enter)"
                  onKeyDown={async e => {
                    if (e.key !== "Enter") return;
                    const q = notesQueryRef.current?.value?.trim();
                    if (!q) return;
                    setNotesQuery(q);
                    setNotesAnswer("");
                    setQueryingNotes(true);
                    const notesBlock = contactNotes.map(cl => `[${cl.date}]\n${cl.notes}`).join("\n\n---\n\n");
                    const contact = contacts.find(c => c.id === selectedContact);
                    try {
                      const res = await fetch("/api/claude", {
                        method:"POST", headers:{"Content-Type":"application/json"},
                        body: JSON.stringify({
                          model:"claude-sonnet-4-20250514", max_tokens:600,
                          messages:[{ role:"user", content:
                            `You are helping an investor query their notes about a contact.\n\nContact: ${contact?.name} (${contact?.role} at ${contact?.company})\n\nAll notes:\n${notesBlock}\n\nQuestion: ${q}\n\nAnswer concisely and directly based only on the notes. If the answer isn't in the notes, say so plainly.`
                          }]
                        })
                      });
                      const data = await res.json();
                      setNotesAnswer(data.content?.find(b => b.type==="text")?.text || "Nothing found.");
                    } catch { setNotesAnswer("Search failed — try again."); }
                    setQueryingNotes(false);
                  }}
                  style={{ width:"100%", background:C.surface,
                    border:`1px solid ${C.border}`,
                    borderRadius:6, color:C.ink, fontSize:13,
                    fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
                    padding:"9px 14px", outline:"none", boxSizing:"border-box" }} />
                {notesAnswer && (
                  <button onClick={() => { setNotesQuery(""); setNotesAnswer(""); if(notesQueryRef.current) notesQueryRef.current.value = ""; }}
                    style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)",
                      background:"transparent", border:"none", color:C.inkFaint,
                      cursor:"pointer", fontSize:14, padding:0 }}>×</button>
                )}
              </div>
              {queryingNotes && (
                <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic",
                  padding:"8px 0" }}>Searching notes…</div>
              )}
              {notesAnswer && !queryingNotes && (
                <div style={{ background:domain.colorLight, border:`1px solid ${domain.color}33`,
                  borderLeft:`3px solid ${domain.color}`, borderRadius:6,
                  padding:"12px 14px", marginTop:8 }}>
                  <div style={{ fontSize:10, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                    textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Answer</div>
                  <div style={{ fontSize:14, color:C.inkMid, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                    lineHeight:1.7, fontStyle:"italic" }}>{notesAnswer}</div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {contactNotes.length > 0 && (
            <div style={{ marginTop:14 }}>
              <SectionRule label="notes" color={domain.color} />
              {contactNotes.map(cl => {
                const isExpanded = selectedCall === cl.id;
                const isEditing  = editingNoteId === cl.id;
                // Preview: first ~80 chars of plain text
                const preview = stripHtml(cl.notes).slice(0, 80) + (stripHtml(cl.notes).length > 80 ? "…" : "");
                return (
                  <div key={cl.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                    {/* Collapsed header — always visible */}
                    <div onClick={() => { if (!isEditing) setSelectedCall(isExpanded ? null : cl.id); }}
                      style={{ display:"flex", alignItems:"center", gap:10,
                        padding:"10px 0", cursor:"pointer" }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:11, color:domain.color,
                          fontFamily:"'SF Mono','Fira Code',monospace", marginBottom:2 }}>{cl.date}</div>
                        {!isExpanded && (
                          <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic",
                            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{preview}</div>
                        )}
                      </div>
                      <span style={{ fontSize:11, color:C.inkFaint, flexShrink:0 }}>
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div style={{ paddingBottom:12 }}>
                        {isEditing ? (
                          <div style={{ border:`1px solid ${domain.color}44`, borderRadius:6, overflow:"hidden" }}>
                            <div style={{ display:"flex", gap:2, padding:"5px 8px",
                              borderBottom:`1px solid ${C.border}`, flexWrap:"wrap" }}>
                              {[{cmd:"bold",icon:"B",s:{fontWeight:700}},
                                {cmd:"italic",icon:"I",s:{fontStyle:"italic"}},
                                {cmd:"underline",icon:"U",s:{textDecoration:"underline"}},
                              ].map(({cmd,icon,s}) => (
                                <button key={cmd} onMouseDown={e=>{e.preventDefault();document.execCommand(cmd);}}
                                  style={{ background:"transparent", border:`1px solid ${C.border}`,
                                    borderRadius:3, width:26, height:24, cursor:"pointer",
                                    fontSize:12, color:C.inkMid, ...s }}>{icon}</button>
                              ))}
                              <div style={{ width:1, background:C.border, margin:"0 3px" }} />
                              {[{cmd:"insertUnorderedList",icon:"• —"},{cmd:"indent",icon:"→"},{cmd:"outdent",icon:"←"}].map(({cmd,icon}) => (
                                <button key={cmd} onMouseDown={e=>{e.preventDefault();document.execCommand(cmd);}}
                                  style={{ background:"transparent", border:`1px solid ${C.border}`,
                                    borderRadius:3, padding:"0 6px", height:24, cursor:"pointer",
                                    fontSize:11, color:C.inkMid }}>{icon}</button>
                              ))}
                            </div>
                            <div ref={editNoteRef} dir="ltr" contentEditable
                              suppressContentEditableWarning onKeyDown={noteKeyHandler}
                              dangerouslySetInnerHTML={{ __html: cl.notes }}
                              style={{ padding:10, minHeight:80, color:C.ink, fontSize:14,
                                fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", lineHeight:1.8, outline:"none",
                                direction:"ltr", textAlign:"left" }} />
                            <div style={{ display:"flex", gap:6, padding:"6px 10px",
                              borderTop:`1px solid ${C.border}` }}>
                              <button onClick={() => saveEditedNote(cl.id)}
                                style={{ background:domain.color, border:"none", borderRadius:3,
                                  color:"#fff", fontSize:10, padding:"3px 12px",
                                  cursor:"pointer", fontFamily:"inherit" }}>Save</button>
                              <button onClick={() => setEditingNoteId(null)}
                                style={{ background:"transparent", border:`1px solid ${C.border}`,
                                  borderRadius:3, color:C.inkFaint, fontSize:10,
                                  padding:"3px 8px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div dangerouslySetInnerHTML={{ __html: cl.notes }}
                              style={{ fontSize:14, color:C.ink, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                                lineHeight:1.8 }} />
                            <div style={{ display:"flex", gap:8, marginTop:8 }}>
                              <button onClick={e=>{e.stopPropagation();setEditingNoteId(cl.id);}}
                                style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
                                  borderRadius:3, color:C.inkFaint, fontSize:10,
                                  padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>Edit</button>
                              <button onClick={e=>{e.stopPropagation();onUpdate({ ...domain, calls: calls.filter(x=>x.id!==cl.id) });setSelectedCall(null);}}
                                style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
                                  borderRadius:3, color:C.red, fontSize:10,
                                  padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>Delete</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {contactNotes.length===0 && !isWriting && (
            <div style={{ fontSize:13, color:C.inkFaint, fontStyle:"italic",
              textAlign:"center", padding:"20px 0" }}>No notes yet. Tap + note to start.</div>
          )}
        </div>
      );
    }

    return (
      <div>
        {/* People search */}
        <div style={{ marginBottom:12 }}>
          <input
            ref={el => { if (el) el._searchInput = true; }}
            id="crm-search-input"
            dir="ltr"
            defaultValue=""
            onChange={e => {
              crmSearchValue.current = e.target.value;
              if (crmSearchTimer.current) clearTimeout(crmSearchTimer.current);
              crmSearchTimer.current = setTimeout(() => setCrmSearchTick(t => t+1), 350);
            }}
            placeholder="Search by name or company…"
            style={{ width:"100%", background:C.surface,
              border:`1px solid ${C.border}`,
              borderRadius:6, color:C.ink, fontSize:14,
              fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
              padding:"9px 14px", outline:"none", boxSizing:"border-box" }} />
        </div>

        {/* Stage filters */}
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:6 }}>
          {["all", ...CRM_STAGES].map(s => (
            <button key={s} onClick={() => {
              setCrmFilter(s);
              // Clear search when switching filters
              crmSearchValue.current = "";
              const el = document.getElementById("crm-search-input");
              if (el) el.value = "";
              setCrmSearchTick(t => t+1);
            }}
              style={{ background: crmFilter===s ? (STAGE_COLOR[s]||domain.color) : "transparent",
                color: crmFilter===s ? "#fff" : (STAGE_COLOR[s]||C.inkLight),
                border:`1.5px solid ${STAGE_COLOR[s]||domain.color}`,
                borderRadius:20, padding:"3px 10px", fontSize:10, cursor:"pointer",
                fontFamily:"'SF Mono','Fira Code',monospace", textTransform:"capitalize",
                transition:"all 0.12s" }}>{s}</button>
          ))}
          <button onClick={() => setEditingStages(e => !e)}
            style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
              borderRadius:20, padding:"3px 10px", fontSize:10, cursor:"pointer",
              color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace" }}>
            {editingStages ? "done" : "✎ labels"}
          </button>
        </div>

        {/* Stage editor */}
        {editingStages && (
          <div style={{ background:C.surface, boxShadow:C.shadow,
            borderRadius:6, padding:12, marginBottom:12 }}>
            <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
              textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>Edit labels</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
              {CRM_STAGES.map((s, i) => (
                <div key={s} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", flexShrink:0,
                    background: STAGE_COLOR[s] || domain.color }} />
                  <span style={{ flex:1, fontSize:13, color:C.ink,
                    fontFamily:"'SF Mono','Fira Code',monospace" }}>{s}</span>
                  <button onClick={() => {
                    const updated = CRM_STAGES.filter((_, j) => j !== i);
                    setCrmStages(updated);
                    if (crmFilter === s) setCrmFilter("all");
                  }} style={{ background:"transparent", border:"none", color:C.red,
                    cursor:"pointer", fontSize:14, padding:0, lineHeight:1 }}>×</button>
                </div>
              ))}
            </div>
            {/* Add new stage */}
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <input dir="ltr" value={newStageName}
                onChange={e => setNewStageName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newStageName.trim()) {
                    setCrmStages([...CRM_STAGES, newStageName.trim().toLowerCase()]);
                    setNewStageName("");
                  }
                }}
                placeholder="New label…"
                style={{ flex:1, background:"transparent", border:"none",
                  borderBottom:`1px solid ${domain.color}`, color:C.ink,
                  fontSize:13, fontFamily:"'SF Mono','Fira Code',monospace",
                  padding:"3px 0", outline:"none" }} />
              <button onClick={() => {
                if (!newStageName.trim()) return;
                setCrmStages([...CRM_STAGES, newStageName.trim().toLowerCase()]);
                setNewStageName("");
              }} style={{ background:domain.color, border:"none", borderRadius:4,
                color:"#fff", fontSize:11, padding:"4px 12px",
                cursor:"pointer", fontFamily:"inherit" }}>Add</button>
            </div>
          </div>
        )}

        {/* Contact list — alphabetical with letter navigator */}
        {(() => {
          const visibleContacts = filtered
            .filter(c => !crmSearchValue.current ||
              c.name.toLowerCase().includes(crmSearchValue.current.toLowerCase()) ||
              (c.company||"").toLowerCase().includes(crmSearchValue.current.toLowerCase()))
            .sort((a,b) => a.name.localeCompare(b.name));

          // Group by first letter
          const groups = {};
          visibleContacts.forEach(c => {
            const letter = c.name[0]?.toUpperCase() || "#";
            if (!groups[letter]) groups[letter] = [];
            groups[letter].push(c);
          });
          const letters = Object.keys(groups).sort();

          return (
            <div style={{ display:"flex", gap:0 }}>
              {/* Contact rows */}
              <div style={{ flex:1, minWidth:0 }}>
                {letters.map(letter => (
                  <div key={letter} id={`crm-letter-${letter}`}>
                    {/* Letter header */}
                    <div style={{ fontSize:10, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                      fontWeight:700, padding:"8px 0 4px", letterSpacing:"0.1em",
                      borderBottom:`1px solid ${domain.color}33` }}>{letter}</div>
                    {groups[letter].map(c => {
                      const w = contactWarmth(c.lastContact);
                      return (
                        <div key={c.id} onClick={() => setSelectedContact(c.id)}
                          style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0",
                            borderBottom:`1px solid ${C.border}`, cursor:"pointer" }}>
                          <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0,
                            background: STAGE_COLOR[c.stage]+"22",
                            border:`1.5px solid ${STAGE_COLOR[c.stage]}55`,
                            display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <span style={{ fontSize:13, color:STAGE_COLOR[c.stage],
                              fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontWeight:600 }}>{c.name[0]}</span>
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:14, color:C.ink, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                              fontWeight:500 }}>{c.name}</div>
                            <div style={{ fontSize:11, color:C.inkLight, fontStyle:"italic",
                              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {c.role} · {c.company}
                            </div>
                          </div>
                          <div style={{ textAlign:"right", flexShrink:0 }}>
                            <div style={{ display:"flex", gap:2, justifyContent:"flex-end", marginBottom:3 }}>
                              {[1,2,3,4,5].map(v => (
                                <div key={v} style={{ width:7, height:7, borderRadius:"50%",
                                  background: v<=w ? WARMTH_COLOR(w) : C.border }} />
                              ))}
                            </div>
                            {c.lastContact && (
                              <div style={{ fontSize:9, color:C.inkFaint,
                                fontFamily:"'SF Mono','Fira Code',monospace" }}>{c.lastContact}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {visibleContacts.length === 0 && (
                  <div style={{ fontSize:13, color:C.inkFaint, fontStyle:"italic",
                    textAlign:"center", padding:"20px 0" }}>No contacts found.</div>
                )}
              </div>

              {/* Letter navigator sidebar */}
              {letters.length > 3 && (
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                  paddingLeft:8, paddingTop:4, gap:1, flexShrink:0 }}>
                  {letters.map(l => (
                    <button key={l}
                      onClick={() => document.getElementById(`crm-letter-${l}`)?.scrollIntoView({ behavior:"smooth", block:"start" })}
                      style={{ background:"transparent", border:"none", color:domain.color,
                        fontSize:10, fontWeight:700, fontFamily:"'SF Mono','Fira Code',monospace",
                        padding:"1px 4px", cursor:"pointer", lineHeight:1.4,
                        borderRadius:3, minWidth:18, textAlign:"center" }}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Add contact */}
        {addingContact ? (
          <AddContactForm
            accentColor={domain.color}
            crmStages={CRM_STAGES}
            stageColors={STAGE_COLOR}
            onCancel={() => setAddingContact(false)}
            onAdd={(data) => {
              setContacts([...contacts, { ...data, id:`c${Date.now()}`, followUps:[], aiSummary:"" }]);
              setAddingContact(false);
            }}
          />
        ) : (
          <button onClick={() => setAddingContact(true)}
            style={{ width:"100%", background:"transparent", border:`1px dashed ${C.borderMid}`,
              borderRadius:6, padding:"9px", color:C.inkFaint, fontSize:12, cursor:"pointer",
              fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", marginTop:10 }}>+ Add person</button>
        )}
      </div>
    );
  };

  // ── AI SUMMARIZE ─────────────────────────────────────────────────────────
  // ── Granola integration ───────────────────────────────────────────────────
  const openGranola = async (context) => {
    setGranolaOpen(context);
    setGranolaMeetings([]);
    setGranolaLoading(true);
    try {
      const res = await fetch("/api/granola", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"list", page_size:20 })
      });
      const data = await res.json();
      if (data.notes) {
        setGranolaMeetings(data.notes.map(n => ({
          id: n.id,
          title: n.title,
          date: n.created_at ? new Date(n.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "",
        })));
      } else if (res.status === 401) {
        setGranolaMeetings([{ id:"error", title:"Token expired — update GRANOLA_ACCESS_TOKEN in Vercel", date:"" }]);
      }
    } catch(e) {
      console.error("Granola list failed:", e);
    }
    setGranolaLoading(false);
  };

  const importGranolaMeeting = async (meeting, context, updateFn) => {
    if (meeting.id === "error") return;
    setGranolaImporting(meeting.id);
    try {
      const res = await fetch("/api/granola", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"get", note_id: meeting.id })
      });
      const data = await res.json();
      const today = new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"});
      const date = data.created_at
        ? new Date(data.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})
        : today;

      // Build HTML from summary + transcript
      const parts = [];
      if (data.summary) parts.push(`<p><strong>Summary:</strong> ${data.summary}</p>`);
      if (data.transcript?.length) {
        const lines = data.transcript
          .map(t => `<li><em>${t.speaker?.source === "microphone" ? "You" : "Them"}:</em> ${t.text}</li>`)
          .join("");
        parts.push(`<ul>${lines}</ul>`);
      }
      const html = parts.length ? parts.join("") : `<p>${data.title || meeting.title}</p>`;
      updateFn({ id:`cl${Date.now()}`, date, notes: html });
    } catch(e) {
      console.error("Granola import failed:", e);
    }
    setGranolaImporting(null);
    setGranolaOpen(null);
  };

  const generateSummaryFromCalls = async (contactId, freshCalls) => {
    setSummarizing(contactId);
    const contact = (domain.contacts||[]).find(c => c.id === contactId);
    const contactCalls = (freshCalls || calls).filter(cl => cl.contactId === contactId);
    if (contactCalls.length === 0) { setSummarizing(null); return; }

    // Strip HTML tags for plain text
    const stripHtml = (html) => {
      try {
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        return tmp.innerText || tmp.textContent || html;
      } catch { return html; }
    };

    const notesBlock = [...contactCalls]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(cl => `[${cl.date}]\n${stripHtml(cl.notes)}`)
      .join("\n\n---\n\n");

    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `You are helping a senior investor summarize their relationship with a contact.

Contact: ${contact?.name} (${contact?.role} at ${contact?.company})

Notes from all conversations:
${notesBlock}

Write a concise, sharp relationship summary (3-5 sentences max). Cover: where things stand, what matters to this person, any open threads or commitments, and the right next move. Write in first person from the investor's perspective. No headers, no bullets — just clear prose.`
          }]
        })
      });
      const data = await res.json();
      const summary = data.content?.find(b => b.type === "text")?.text || "";
      if (!summary) { setSummarizing(null); return; }
      onUpdate({
        ...domain,
        contacts: (domain.contacts||[]).map(c =>
          c.id === contactId ? { ...c, aiSummary: summary } : c
        )
      });
    } catch (e) {
      console.error("Summary failed:", e);
    }
    setSummarizing(null);
  };

  // Keep old name as alias for button clicks
  const generateSummary = (contactId) => generateSummaryFromCalls(contactId, null);

  // ── PROJECTS TAB ──────────────────────────────────────────────────────────
  const projects = domain.projects || [];
  const setProjects = (p) => onUpdate({ ...domain, projects: p });
  const STATUS_COLORS = { active: C.caqi, paused: C.gold, done: C.green, archived: C.inkFaint };

  const ProjectsTab = () => {
    const project = selectedProject ? projects.find(p => p.id === selectedProject) : null;
    const projNoteRef = useRef(null);
    const fileInputRef = useRef(null);
    const projRecognitionRef = useRef(null);
    const editProjNoteRef = useRef(null);
    const [addingMilestone, setAddingMilestone] = useState(false);
    const [editingMilestoneId, setEditingMilestoneId] = useState(null);
    const [addingStatus, setAddingStatus] = useState(false);
    const [projRecording, setProjRecording] = useState(false);
    const [projTranscript, setProjTranscript] = useState("");
    const [projGenerating, setProjGenerating] = useState(false);
    const [projRecordedNotes, setProjRecordedNotes] = useState("");
    const [expandedProjNote, setExpandedProjNote] = useState(null);
    const [editingProjNoteId, setEditingProjNoteId] = useState(null);
    const today = new Date().toLocaleDateString("en-US",{month:"short",day:"numeric"});

    const updateProject = (field, val) =>
      setProjects(projects.map(p => p.id===selectedProject ? { ...p, [field]:val } : p));

    const addProjectNote = () => {
      const html = projNoteRef.current?.innerHTML?.trim() || "";
      if (!html) return;
      const note = { id:`pn${Date.now()}`, html, date: today };
      updateProject("notes", [...(project.notes||[]), note]);
      if (projNoteRef.current) projNoteRef.current.innerHTML = "";
    };

    const startProjRecording = () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { alert("Speech recognition not supported. Try Chrome or Safari."); return; }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      let final = "";
      recognition.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t + " ";
          else interim += t;
        }
        setProjTranscript(final + interim);
      };
      recognition.onerror = () => setProjRecording(false);
      recognition.onend = () => setProjRecording(false);
      projRecognitionRef.current = recognition;
      recognition.start();
      setProjRecording(true);
      setProjTranscript("");
      setProjRecordedNotes("");
    };

    const stopProjRecording = async () => {
      projRecognitionRef.current?.stop();
      setProjRecording(false);
      const raw = projTranscript.trim();
      if (!raw) return;
      setProjGenerating(true);
      try {
        const res = await fetch("/api/claude", {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:800,
            messages:[{ role:"user", content:
              `You are helping an investor take notes about a project meeting or discussion.

Project: ${project?.name}
Goal: ${project?.goal || ""}

Raw transcript:
${raw}

Convert into clean structured notes:
- 2-3 sentences of what was discussed
- Key points or decisions (bullet list)
- Any next actions or blockers

Write in first person. Be concise. Plain text only.` }]
          })
        });
        const data = await res.json();
        setProjRecordedNotes(data.content?.find(b => b.type==="text")?.text || raw);
      } catch(e) { setProjRecordedNotes(raw); }
      setProjGenerating(false);
    };

    const saveProjRecordedNote = () => {
      if (!projRecordedNotes.trim()) return;
      const html = projRecordedNotes.split("\n").map(l =>
        l.startsWith("- ") ? `<li>${l.slice(2)}</li>` : `<p>${l}</p>`
      ).join("");
      const note = { id:`pn${Date.now()}`, html, date:today };
      updateProject("notes", [...(project.notes||[]), note]);
      setProjRecordedNotes("");
      setProjTranscript("");
    };

    const addFile = (file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const f = { id:`pf${Date.now()}`, name:file.name, type:file.type, size:file.size,
          data:e.target.result, date:today };
        updateProject("files", [...(project.files||[]), f]);
      };
      reader.readAsDataURL(file);
    };

    // ── Project detail view ───────────────────────────────────────────────
    if (project) return (
      <div>
        {/* Back + delete */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
          <button onClick={() => setSelectedProject(null)}
            style={{ background:"transparent", border:"none", color:domain.color,
              cursor:"pointer", fontSize:12, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", padding:0 }}>← projects</button>
          <button onClick={() => {
            if (!window.confirm(`Delete "${project.name}"?`)) return;
            setProjects(projects.filter(p => p.id !== selectedProject));
            setSelectedProject(null);
          }} style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
            borderRadius:4, color:C.red, fontSize:11, padding:"3px 10px",
            cursor:"pointer", fontFamily:"inherit" }}>Delete</button>
        </div>

        {/* Name + status */}
        <div style={{ paddingBottom:14, marginBottom:14, borderBottom:`1px solid ${C.border}` }}>
          <EditField label="" field="name" value={project.name} placeholder="Project name"
            accentColor={domain.color} onCommit={updateProject} />
          <div style={{ display:"flex", gap:5, marginTop:8, flexWrap:"wrap" }}>
            {Object.keys(STATUS_COLORS).map(s => (
              <button key={s} onClick={() => updateProject("status", s)}
                style={{ background:project.status===s ? STATUS_COLORS[s] : "transparent",
                  color:project.status===s ? "#fff" : STATUS_COLORS[s],
                  border:`1.5px solid ${STATUS_COLORS[s]}`,
                  borderRadius:6, padding:"3px 10px", fontSize:10, fontWeight:500, cursor:"pointer",
                  fontFamily:"'SF Mono','Fira Code',monospace", textTransform:"capitalize" }}>{s}</button>
            ))}
          </div>
        </div>

        {/* Goal */}
        <EditField label="Goal" field="goal" value={project.goal}
          placeholder="What does done look like?" multiline
          accentColor={domain.color} onCommit={updateProject} />

        {/* North star */}
        <EditField label="North star metric" field="northStar" value={project.northStar}
          placeholder="The one number that defines success"
          accentColor={domain.color} onCommit={updateProject} />

        {/* Milestones — Hierarchical Gantt */}
        <div style={{ margin:"16px 0" }}>
          <SectionRule label="milestones" color={domain.color} />
          {(project.milestones||[]).length === 0 && !addingMilestone && (
            <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic", padding:"4px 0" }}>No milestones yet.</div>
          )}

          {(project.milestones||[]).filter(m => !m.parentId).map((parent) => {
            const children = (project.milestones||[]).filter(m => m.parentId === parent.id);
            const isCollapsed = parent.collapsed;
            const isEditing = editingMilestoneId === parent.id;
            const doneSubs = children.filter(c => c.done).length;
            const totalSubs = children.length;
            const subPct = totalSubs > 0 ? Math.round(doneSubs / totalSubs * 100) : (parent.done ? 100 : 0);
            const todayMs = new Date();
            let datePct = 0;
            if (parent.dueRaw) {
              const due = new Date(parent.dueRaw);
              const start = parent.startRaw ? new Date(parent.startRaw) : new Date(todayMs.getFullYear(), 0, 1);
              datePct = Math.min(100, Math.max(0, Math.round((todayMs - start) / (due - start) * 100)));
            }

            return (
              <div key={parent.id} style={{ marginBottom:2 }}>
                {isEditing ? (
                  <MilestoneEditRow m={parent} accentColor={domain.color}
                    onSave={u => { updateProject("milestones",(project.milestones||[]).map(x=>x.id===parent.id?{...x,...u}:x)); setEditingMilestoneId(null); }}
                    onCancel={() => setEditingMilestoneId(null)} />
                ) : (
                  <div style={{ padding:"4px 0" }}>
                    {/* Single line: toggle + check + name + bar + meta + actions */}
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      {/* Collapse toggle */}
                      <button onClick={() => updateProject("milestones",(project.milestones||[]).map(x=>x.id===parent.id?{...x,collapsed:!x.collapsed}:x))}
                        style={{ background:"transparent", border:"none", color: children.length ? C.inkFaint : "transparent",
                          cursor: children.length ? "pointer" : "default",
                          fontSize:8, padding:0, flexShrink:0, width:10, lineHeight:1 }}>
                        {children.length ? (isCollapsed ? "▶" : "▼") : ""}
                      </button>
                      {/* Square checkbox */}
                      <div onClick={() => updateProject("milestones",(project.milestones||[]).map(x=>x.id===parent.id?{...x,done:!x.done}:x))}
                        style={{ width:11, height:11, borderRadius:2, flexShrink:0,
                          border:`1.5px solid ${parent.done ? C.green : C.borderMid}`,
                          background: parent.done ? C.green : "transparent",
                          cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                        {parent.done && <span style={{ fontSize:7, color:"#fff", lineHeight:1 }}>✓</span>}
                      </div>
                      {/* Name — wraps naturally */}
                      <span style={{ fontSize:13, color: parent.done ? C.inkFaint : C.ink,
                        fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                        textDecoration: parent.done ? "line-through" : "none",
                        flex:1, minWidth:0 }}>{parent.text}</span>
                      {/* Progress bar — fixed width at right */}
                      <div style={{ width:60, flexShrink:0, position:"relative", height:3, background:C.border, borderRadius:2 }}>
                        <div style={{ width:`${subPct}%`, height:"100%",
                          background: domain.color, borderRadius:2, opacity:0.7 }} />
                        {datePct > 0 && datePct < 100 && (
                          <div style={{ position:"absolute", left:`${datePct}%`, top:-1,
                            width:1, height:5, background:C.inkFaint, transform:"translateX(-50%)" }} />
                        )}
                      </div>
                      {/* Meta */}
                      <span style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace", flexShrink:0, whiteSpace:"nowrap" }}>
                        {totalSubs > 0 ? `${doneSubs}/${totalSubs}` : (parent.due || "")}
                      </span>
                      {parent.owner && <span style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace", flexShrink:0 }}>{parent.owner}</span>}
                      <div style={{ flex:1 }} />
                      {/* Actions */}
                      <button onClick={() => setEditingMilestoneId(parent.id)}
                        style={{ background:"transparent", border:"none", color:C.inkFaint,
                          cursor:"pointer", fontSize:9, padding:0, flexShrink:0, opacity:0.5 }}>✎</button>
                      <button onClick={() => updateProject("milestones",(project.milestones||[]).filter(x=>x.id!==parent.id&&x.parentId!==parent.id))}
                        style={{ background:"transparent", border:"none", color:C.inkFaint,
                          cursor:"pointer", fontSize:11, padding:0, flexShrink:0, opacity:0.5 }}>×</button>
                    </div>

                    {/* Sub-milestones */}
                    {!isCollapsed && children.map(child => (
                      <div key={child.id}>
                        {editingMilestoneId === child.id ? (
                          <div style={{ paddingLeft:17 }}>
                            <MilestoneEditRow m={child} accentColor={domain.color}
                              onSave={u => { updateProject("milestones",(project.milestones||[]).map(x=>x.id===child.id?{...x,...u}:x)); setEditingMilestoneId(null); }}
                              onCancel={() => setEditingMilestoneId(null)} />
                          </div>
                        ) : (
                          <div style={{ display:"flex", alignItems:"center", gap:6,
                            padding:"3px 0 3px 17px" }}>
                            <div onClick={() => updateProject("milestones",(project.milestones||[]).map(x=>x.id===child.id?{...x,done:!x.done}:x))}
                              style={{ width:9, height:9, borderRadius:1.5, flexShrink:0,
                                border:`1px solid ${child.done ? C.green : C.borderMid}`,
                                background: child.done ? C.green : "transparent",
                                cursor:"pointer" }} />
                            <span style={{ flex:1, fontSize:12, color: child.done ? C.inkFaint : C.inkMid,
                              fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
                              textDecoration: child.done ? "line-through" : "none" }}>{child.text}</span>
                            {child.due && <span style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace", flexShrink:0 }}>{child.due}</span>}
                            {child.owner && <span style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace", flexShrink:0 }}>{child.owner}</span>}
                            <button onClick={() => setEditingMilestoneId(child.id)}
                              style={{ background:"transparent", border:"none", color:C.inkFaint,
                                cursor:"pointer", fontSize:9, padding:0, opacity:0.5 }}>✎</button>
                            <button onClick={() => updateProject("milestones",(project.milestones||[]).filter(x=>x.id!==child.id))}
                              style={{ background:"transparent", border:"none", color:C.inkFaint,
                                cursor:"pointer", fontSize:11, padding:0, opacity:0.5 }}>×</button>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add sub */}
                    {!isCollapsed && !addingMilestone?.parentId && (
                      <button onClick={() => setAddingMilestone({ parentId: parent.id })}
                        style={{ background:"transparent", border:"none", color:C.inkFaint,
                          cursor:"pointer", fontSize:10, padding:"2px 0 2px 17px", display:"block",
                          fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", opacity:0.6 }}>+ sub</button>
                    )}
                    {addingMilestone?.parentId === parent.id && (
                      <div style={{ paddingLeft:17 }}>
                        <AddMilestoneForm accentColor={domain.color}
                          onCancel={() => setAddingMilestone(false)}
                          onAdd={m => { updateProject("milestones",[...(project.milestones||[]),{...m,id:`m${Date.now()}`,done:false,parentId:parent.id}]); setAddingMilestone(false); }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {addingMilestone === true ? (
            <AddMilestoneForm accentColor={domain.color}
              onCancel={() => setAddingMilestone(false)}
              onAdd={m => { updateProject("milestones",[...(project.milestones||[]),{...m,id:`m${Date.now()}`,done:false}]); setAddingMilestone(false); }} />
          ) : (
            <button onClick={() => setAddingMilestone(true)}
              style={{ background:"transparent", border:"none", color:C.inkFaint,
                fontSize:11, padding:"6px 0 0", cursor:"pointer",
                fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>+ milestone</button>
          )}
        </div>

        {/* Notes */}
        <div style={{ margin:"16px 0" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:4 }}>
            <SectionRule label="notes" color={domain.color} />
            <div style={{ display:"flex", gap:6, flexShrink:0, marginBottom:8 }}>
              {!projRecording && !projRecordedNotes && (
                <button onClick={startProjRecording}
                  style={{ background:"transparent", border:`1.5px solid ${C.red}`,
                    borderRadius:4, color:C.red, fontSize:11, padding:"3px 10px",
                    cursor:"pointer", fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>🎙 record</button>
              )}
              <button onClick={() => granolaOpen==="project" ? setGranolaOpen(null) : openGranola("project")}
                style={{ background:"transparent", border:`1.5px solid #16a34a`,
                  borderRadius:4, color:"#16a34a", fontSize:11, padding:"3px 10px",
                  cursor:"pointer", fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>🌿 Granola</button>
            </div>
          </div>

          {/* Granola import panel for project */}
          {granolaOpen === "project" && (
            <GranolaPanel
              meetings={granolaMeetings}
              loading={granolaLoading}
              importing={granolaImporting}
              onClose={() => setGranolaOpen(null)}
              onSelect={(m) => importGranolaMeeting(m, "project", (note) => {
                updateProject("notes", [...(project.notes||[]), { id:`pn${Date.now()}`, html: note.notes, date: note.date }]);
              })}
            />
          )}

          {/* Recording UI */}
          {(projRecording || projGenerating || projRecordedNotes) && (
            <div style={{ marginBottom:12, border:`1.5px solid ${C.red}33`,
              borderLeft:`3px solid ${C.red}`, borderRadius:6, overflow:"hidden" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"8px 12px", background:`${C.red}08`, borderBottom:`1px solid ${C.red}22` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {projRecording && <div style={{ width:8, height:8, borderRadius:"50%",
                    background:C.red, animation:"pulse 1s infinite" }} />}
                  <span style={{ fontSize:11, color:C.red, fontFamily:"'SF Mono','Fira Code',monospace",
                    textTransform:"uppercase", letterSpacing:"0.08em" }}>
                    {projRecording ? "Recording…" : projGenerating ? "Generating notes…" : "Review notes"}
                  </span>
                </div>
                {projRecording ? (
                  <button onClick={stopProjRecording}
                    style={{ background:C.red, border:"none", borderRadius:4, color:"#fff",
                      fontSize:11, padding:"3px 12px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
                    Stop + generate
                  </button>
                ) : !projGenerating && (
                  <button onClick={() => { setProjRecordedNotes(""); setProjTranscript(""); }}
                    style={{ background:"transparent", border:"none", color:C.inkFaint,
                      cursor:"pointer", fontSize:14, padding:0 }}>×</button>
                )}
              </div>
              {(projRecording || projTranscript) && !projRecordedNotes && (
                <div style={{ padding:"10px 12px", maxHeight:100, overflowY:"auto" }}>
                  <div style={{ fontSize:13, color:C.inkMid, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                    fontStyle:"italic", lineHeight:1.6 }}>
                    {projTranscript || <span style={{ opacity:0.4 }}>Start speaking…</span>}
                  </div>
                </div>
              )}
              {projGenerating && (
                <div style={{ padding:"12px", fontSize:12, color:C.inkFaint, fontStyle:"italic" }}>
                  Claude is reading the transcript…
                </div>
              )}
              {projRecordedNotes && !projGenerating && (
                <div style={{ padding:"10px 12px" }}>
                  <textarea dir="ltr" value={projRecordedNotes}
                    onChange={e => setProjRecordedNotes(e.target.value)}
                    style={{ width:"100%", background:"transparent", border:"none",
                      color:C.ink, fontSize:13, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
                      lineHeight:1.7, padding:0, outline:"none", resize:"none",
                      boxSizing:"border-box", direction:"ltr", textAlign:"left",
                      unicodeBidi:"plaintext", minHeight:100 }} rows={5} />
                  <div style={{ display:"flex", justifyContent:"flex-end", gap:8,
                    borderTop:`1px solid ${C.border}`, paddingTop:8, marginTop:6 }}>
                    <button onClick={() => { setProjRecordedNotes(""); setProjTranscript(""); startProjRecording(); }}
                      style={{ background:"transparent", border:`1px solid ${C.red}`,
                        borderRadius:4, color:C.red, fontSize:11, padding:"4px 10px",
                        cursor:"pointer", fontFamily:"inherit" }}>🎙 Again</button>
                    <button onClick={saveProjRecordedNote}
                      style={{ background:domain.color, border:"none", borderRadius:4, color:"#fff",
                        fontSize:11, padding:"4px 14px", cursor:"pointer",
                        fontFamily:"inherit", fontWeight:600 }}>Save note</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {(project.notes||[]).map(n => {
            const isExpanded = expandedProjNote === n.id;
            const isEditing  = editingProjNoteId === n.id;
            const stripHtmlLocal = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d.innerText || ""; };
            const preview = stripHtmlLocal(n.html).slice(0, 80) + (stripHtmlLocal(n.html).length > 80 ? "…" : "");
            return (
              <div key={n.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                {/* Collapsed header */}
                <div onClick={() => { if (!isEditing) setExpandedProjNote(isExpanded ? null : n.id); }}
                  style={{ display:"flex", alignItems:"center", gap:10,
                    padding:"10px 0", cursor:"pointer" }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:10, color:domain.color,
                      fontFamily:"'SF Mono','Fira Code',monospace", marginBottom:2 }}>{n.date}</div>
                    {!isExpanded && (
                      <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{preview}</div>
                    )}
                  </div>
                  <span style={{ fontSize:11, color:C.inkFaint, flexShrink:0 }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ paddingBottom:10 }}>
                    {isEditing ? (
                      <div style={{ border:`1px solid ${domain.color}44`, borderRadius:6, overflow:"hidden" }}>
                        <div style={{ display:"flex", gap:2, padding:"4px 8px",
                          borderBottom:`1px solid ${C.border}` }}>
                          {[{cmd:"bold",icon:"B",s:{fontWeight:700}},
                            {cmd:"italic",icon:"I",s:{fontStyle:"italic"}},
                            {cmd:"insertUnorderedList",icon:"•",s:{}},
                            {cmd:"indent",icon:"→",s:{}},
                          ].map(({cmd,icon,s}) => (
                            <button key={cmd} onMouseDown={e=>{e.preventDefault();document.execCommand(cmd);}}
                              style={{ background:"transparent", border:`1px solid ${C.border}`,
                                borderRadius:3, padding:"0 6px", height:22, cursor:"pointer",
                                fontSize:11, color:C.inkMid, ...s }}>{icon}</button>
                          ))}
                        </div>
                        <div ref={editProjNoteRef} dir="ltr" contentEditable
                          suppressContentEditableWarning onKeyDown={noteKeyHandler}
                          dangerouslySetInnerHTML={{ __html: n.html }}
                          style={{ padding:10, minHeight:80, color:C.ink, background:"#fff", fontSize:13,
                            fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", lineHeight:1.7, outline:"none",
                            direction:"ltr", textAlign:"left" }} />
                        <div style={{ display:"flex", gap:6, padding:"5px 10px",
                          borderTop:`1px solid ${C.border}` }}>
                          <button onClick={() => {
                            const html = editProjNoteRef.current?.innerHTML?.trim() || "";
                            if (!html) { setEditingProjNoteId(null); return; }
                            updateProject("notes", (project.notes||[]).map(x => x.id===n.id ? { ...x, html } : x));
                            setEditingProjNoteId(null);
                          }} style={{ background:domain.color, border:"none", borderRadius:3,
                            color:"#fff", fontSize:10, padding:"3px 12px",
                            cursor:"pointer", fontFamily:"inherit" }}>Save</button>
                          <button onClick={() => setEditingProjNoteId(null)}
                            style={{ background:"transparent", border:`1px solid ${C.border}`,
                              borderRadius:3, color:C.inkFaint, fontSize:10,
                              padding:"3px 8px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div dangerouslySetInnerHTML={{ __html: n.html }}
                          style={{ fontSize:13, color:C.ink, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", lineHeight:1.7 }} />
                        <div style={{ display:"flex", gap:8, marginTop:6 }}>
                          <button onClick={e=>{e.stopPropagation();setEditingProjNoteId(n.id);}}
                            style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
                              borderRadius:3, color:C.inkFaint, fontSize:10,
                              padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>Edit</button>
                          <button onClick={e=>{e.stopPropagation();
                            updateProject("notes",(project.notes||[]).filter(x=>x.id!==n.id));
                            setExpandedProjNote(null);
                          }} style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
                            borderRadius:3, color:C.red, fontSize:10,
                            padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ border:`1px solid ${C.border}`, borderRadius:6, overflow:"hidden", marginTop:6 }}>
            <div style={{ display:"flex", gap:2, padding:"4px 8px", borderBottom:`1px solid ${C.border}` }}>
              {[{cmd:"bold",icon:"B",s:{fontWeight:700}},{cmd:"italic",icon:"I",s:{fontStyle:"italic"}},{cmd:"insertUnorderedList",icon:"•",s:{}}].map(({cmd,icon,s}) => (
                <button key={cmd} onMouseDown={e=>{e.preventDefault();document.execCommand(cmd);}}
                  style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:3,
                    padding:"0 7px", height:22, cursor:"pointer", fontSize:11, color:C.inkMid, ...s }}>{icon}</button>
              ))}
            </div>
            <div ref={projNoteRef} dir="ltr" contentEditable suppressContentEditableWarning suppressContentEditableWarning
              onKeyDown={noteKeyHandler} data-placeholder="Add a note…"
              style={{ minHeight:70, padding:10, outline:"none", fontSize:13, background:"#fff",
                fontFamily:"Georgia,serif", lineHeight:1.7, color:C.ink, direction:"ltr" }} />
            <div style={{ padding:"5px 10px", borderTop:`1px solid ${C.border}`, textAlign:"right" }}>
              <button onClick={addProjectNote}
                style={{ background:domain.color, border:"none", borderRadius:4, color:"#fff",
                  fontSize:11, padding:"4px 12px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Add note</button>
            </div>
          </div>
        </div>

        {/* Documents */}
        <div style={{ margin:"16px 0" }}>
          <SectionRule label="documents" color={domain.color} />
          {(project.files||[]).map(f => (
            <div key={f.id} style={{ display:"flex", alignItems:"center", gap:10,
              padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ width:30, height:30, borderRadius:4, background:domain.colorLight,
                border:`1px solid ${domain.color}33`, display:"flex", alignItems:"center",
                justifyContent:"center", flexShrink:0 }}>
                <span style={{ fontSize:9, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace" }}>
                  {f.name.split('.').pop().toUpperCase().slice(0,4)}
                </span>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, color:C.ink, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{f.name}</div>
                <div style={{ fontSize:9, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace" }}>
                  {f.date} · {(f.size/1024).toFixed(0)}KB
                </div>
              </div>
              <a href={f.data} download={f.name}
                style={{ fontSize:10, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                  textDecoration:"none", flexShrink:0 }}>↓</a>
              <button onClick={() => updateProject("files",(project.files||[]).filter(x=>x.id!==f.id))}
                style={{ background:"transparent", border:"none", color:C.inkFaint,
                  cursor:"pointer", fontSize:13, padding:0 }}>×</button>
            </div>
          ))}
          <input ref={fileInputRef} type="file" accept="*/*" style={{ display:"none" }}
            onChange={e => { if(e.target.files?.[0]) addFile(e.target.files[0]); }} />
          <button onClick={() => fileInputRef.current?.click()}
            style={{ width:"100%", background:"transparent", border:`1px dashed ${C.borderMid}`,
              borderRadius:6, padding:"8px", color:C.inkFaint, fontSize:11,
              cursor:"pointer", fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", marginTop:6 }}>
            + Attach document
          </button>
        </div>
      </div>
    );

    // ── Project list view ─────────────────────────────────────────────────
    const projDragRef = useRef(null); // { id, startY, startIdx }
    const [dragProjId, setDragProjId] = useState(null);
    const [dragOverIdx, setDragOverIdx] = useState(null);

    const onProjDragStart = (e, id, idx) => {
      e.stopPropagation();
      projDragRef.current = { id, startIdx: idx };
      setDragProjId(id);
    };

    const onProjDragOver = (e, idx) => {
      e.preventDefault();
      setDragOverIdx(idx);
    };

    const onProjDrop = (idx) => {
      if (!projDragRef.current) return;
      const { id } = projDragRef.current;
      const fromIdx = projects.findIndex(p => p.id === id);
      if (fromIdx === -1 || fromIdx === idx) { setDragProjId(null); setDragOverIdx(null); return; }
      const reordered = [...projects];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(idx, 0, moved);
      setProjects(reordered);
      setDragProjId(null);
      setDragOverIdx(null);
    };

    return (
      <div>
        <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
          {projects.map((p, idx) => (
            <div key={p.id}
              draggable
              onDragStart={e => onProjDragStart(e, p.id, idx)}
              onDragOver={e => onProjDragOver(e, idx)}
              onDrop={() => onProjDrop(idx)}
              onDragEnd={() => { setDragProjId(null); setDragOverIdx(null); }}
              style={{ display:"flex", alignItems:"flex-start", gap:10,
                padding:"12px 0", borderBottom:`1px solid ${C.border}`,
                opacity: dragProjId===p.id ? 0.4 : 1,
                background: dragOverIdx===idx && dragProjId!==p.id ? C.caqiLight : "transparent",
                transition:"background 0.1s" }}>
              {/* Drag handle */}
              <div style={{ color:C.inkFaint, fontSize:14, cursor:"grab",
                flexShrink:0, paddingTop:3, userSelect:"none" }}>⠿</div>
              {/* Tap to open */}
              <div onClick={() => setSelectedProject(p.id)} style={{ flex:1, cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                  <span style={{ fontSize:14, color:C.ink, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                    fontWeight:500 }}>{p.name}</span>
                  <span style={{ fontSize:9, color:STATUS_COLORS[p.status]||C.inkFaint,
                    background:(STATUS_COLORS[p.status]||C.inkFaint)+"18",
                    border:`1px solid ${STATUS_COLORS[p.status]||C.inkFaint}44`,
                    borderRadius:10, padding:"1px 7px",
                    fontFamily:"'SF Mono','Fira Code',monospace", textTransform:"capitalize" }}>{p.status}</span>
                </div>
                {p.northStar && (
                  <div style={{ fontSize:11, color:domain.color, fontFamily:"'SF Mono','Fira Code',monospace",
                    marginBottom:2 }}>◎ {p.northStar}</div>
                )}
                {p.goal && (
                  <div style={{ fontSize:11, color:C.inkLight, fontStyle:"italic",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.goal}</div>
                )}
                {(p.milestones||[]).length > 0 && (() => {
                  const done = (p.milestones||[]).filter(m => m.done).length;
                  const total = p.milestones.length;
                  const pct = Math.round(done/total*100);
                  return (
                    <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ flex:1, height:3, background:C.border, borderRadius:2 }}>
                        <div style={{ width:`${pct}%`, height:"100%",
                          background: pct===100 ? C.green : domain.color,
                          borderRadius:2, transition:"width 0.3s" }} />
                      </div>
                      <span style={{ fontSize:9, color:C.inkFaint,
                        fontFamily:"'SF Mono','Fira Code',monospace", flexShrink:0 }}>
                        {done}/{total} milestones
                      </span>
                    </div>
                  );
                })()}
              </div>
              {/* Inline delete × */}
              <button onClick={e => {
                e.stopPropagation();
                if (!window.confirm(`Delete "${p.name}"?`)) return;
                setProjects(projects.filter(x => x.id !== p.id));
              }} style={{ background:"transparent", border:"none", color:C.inkFaint,
                cursor:"pointer", fontSize:16, padding:0, flexShrink:0, lineHeight:1,
                marginTop:2 }}>×</button>
            </div>
          ))}
        </div>

        {/* Add project */}
        {addingProject ? (
          <AddProjectForm
            accentColor={domain.color}
            statusColors={STATUS_COLORS}
            onCancel={() => setAddingProject(false)}
            onAdd={({ name, status }) => {
              setProjects([...projects, { id:`p${Date.now()}`, name, status,
                goal:"", northStar:"", milestones:[], weeklyStatus:[], notes:[], files:[], followUps:[] }]);
              setAddingProject(false);
            }}
          />
        ) : (
          <button onClick={() => setAddingProject(true)}
            style={{ width:"100%", background:"transparent", border:`1px dashed ${C.borderMid}`,
              borderRadius:6, padding:"9px", color:C.inkFaint, fontSize:12, cursor:"pointer",
              fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", marginTop:10 }}>+ Add project</button>
        )}
      </div>
    );
  };


  return (
    <div>
      <Header />
      {/* Tabs — pill style */}
      <div style={{ display:"flex", gap:8, marginBottom:14,
        background:C.surface, borderRadius:8, padding:4,
        border:`1px solid ${C.border}` }}>
        {WORK_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:1, border:"none", borderRadius:6,
            background: tab===t.id ? domain.color : "transparent",
            color: tab===t.id ? "#fff" : C.inkFaint,
            padding:"8px 4px", fontSize:12, cursor:"pointer",
            fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
            fontWeight: tab===t.id ? 600 : 400,
            boxShadow: tab===t.id ? `0 1px 4px ${domain.color}44` : "none",
            transition:"all 0.15s" }}>{t.label}</button>
        ))}
      </div>
      <div style={{ paddingTop:12 }}>
        {tab === "todos"    && <TodosTab />}
        {tab === "crm"      && <CRMTab />}
        {tab === "projects" && <ProjectsTab />}
      </div>
    </div>
  );
}

// ── DOMAIN VIEW ───────────────────────────────────────────────────────────────
// ── BODY DOMAIN VIEW ─────────────────────────────────────────────────────────
// ── BODY COMPONENTS ──────────────────────────────────────────────────────────

// ── BODY COMPONENTS — Kandinsky-inspired ──────────────────────────────────

// Stretched arc gauge: shows value vs goal as a living arc
// The gap IS the goal — you see the stretch
function ArcGauge({ value, goal, max, size=110, label, unit="", color, trackColor="#e8e4de", showGoalTick=true }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  // Arc spans 240 degrees (like Apple Watch but wider)
  const arcSpan = 0.75; // fraction of circle
  const pct = Math.min(1, (value||0) / (max||goal||1));
  const goalPct = Math.min(1, (goal||0) / (max||goal||1));
  const dashVal  = pct * arcSpan * circ;
  const dashGoal = goalPct * arcSpan * circ;
  const offset = circ * (1 - arcSpan) / 2;
  const rotation = 90 + (1 - arcSpan) * 180; // start from bottom-left

  // Goal tick angle
  const goalAngle = rotation + goalPct * arcSpan * 360;
  const goalRad = (goalAngle * Math.PI) / 180;
  const cx = size/2, cy = size/2;
  const tickR1 = r - stroke/2 - 2;
  const tickR2 = r + stroke/2 + 2;
  const tx1 = cx + tickR1 * Math.cos(goalRad);
  const ty1 = cy + tickR1 * Math.sin(goalRad);
  const tx2 = cx + tickR2 * Math.cos(goalRad);
  const ty2 = cy + tickR2 * Math.sin(goalRad);

  const atGoal = pct >= goalPct;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
      <div style={{ position:"relative", width:size, height:size }}>
        <svg width={size} height={size} style={{ display:"block" }}>
          <g transform={`rotate(${rotation}, ${size/2}, ${size/2})`}>
            {/* Track */}
            <circle cx={size/2} cy={size/2} r={r} fill="none"
              stroke={trackColor} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${arcSpan*circ} ${circ}`}
              strokeDashoffset={-offset}/>
            {/* Goal track (dimmer, shows what you're reaching for) */}
            <circle cx={size/2} cy={size/2} r={r} fill="none"
              stroke={color} strokeWidth={stroke} strokeLinecap="round"
              opacity="0.12"
              strokeDasharray={`${dashGoal} ${circ}`}
              strokeDashoffset={-offset}/>
            {/* Value arc */}
            <circle cx={size/2} cy={size/2} r={r} fill="none"
              stroke={color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={`${dashVal} ${circ}`}
              strokeDashoffset={-offset}
              style={{ transition:"stroke-dasharray 0.9s cubic-bezier(.4,0,.2,1)" }}/>
          </g>
          {/* Goal tick mark */}
          {showGoalTick && goal && (
            <line x1={tx1} y1={ty1} x2={tx2} y2={ty2}
              stroke={color} strokeWidth={2} opacity="0.5"/>
          )}
          {/* Center content */}
          <text x={size/2} y={size/2 - 6} textAnchor="middle"
            style={{ fontSize:22, fontWeight:800, fill: atGoal ? color : "#1a1612", fontFamily:"system-ui" }}>
            {value!=null ? (typeof value==="number" && value%1!==0 ? value.toFixed(1) : value) : "—"}
          </text>
          <text x={size/2} y={size/2 + 10} textAnchor="middle"
            style={{ fontSize:10, fill:"#9a8f82", fontFamily:"system-ui", fontWeight:500 }}>{unit}</text>
          {goal && <text x={size/2} y={size/2 + 24} textAnchor="middle"
            style={{ fontSize:9, fill: atGoal ? color : "#bdb0a3", fontFamily:"system-ui" }}>
            {atGoal ? "✓ goal" : `goal: ${goal}${unit}`}
          </text>}
        </svg>
      </div>
      {label && <div style={{ fontSize:10, color:"#9a8f82", letterSpacing:"0.08em",
        textTransform:"uppercase", fontWeight:700, textAlign:"center" }}>{label}</div>}
    </div>
  );
}

// Thin sparkline for trend — Kandinsky-style: line as gesture, not decoration
function TrendLine({ data, color, height=36, goalLine }) {
  if (!data || data.length < 2) return <div style={{ height }}/>;
  const vals = data.map(v=>v||0);
  const max = Math.max(...vals, goalLine||0, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const w = 100, h = height;
  const pts = vals.map((v,i) => {
    const x = (i/(vals.length-1))*w;
    const y = h - ((v-min)/range)*(h-6) - 3;
    return [x,y];
  });
  const polyPts = pts.map(p=>p.join(",")).join(" ");
  const areaPath = `M${pts[0][0]},${h} ${pts.map(p=>`L${p[0]},${p[1]}`).join(" ")} L${pts[pts.length-1][0]},${h} Z`;
  const goalY = goalLine!=null ? h - ((goalLine-min)/range)*(h-6) - 3 : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
      style={{ width:"100%", height, display:"block" }}>
      <defs>
        <linearGradient id={`tl_${color.replace(/[^a-z0-9]/gi,"")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#tl_${color.replace(/[^a-z0-9]/gi,"")})`}/>
      {goalY!=null && (
        <line x1="0" y1={goalY} x2={w} y2={goalY}
          stroke={color} strokeWidth="0.8" strokeDasharray="3,2" opacity="0.45"/>
      )}
      <polyline points={polyPts} fill="none" stroke={color} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2.5" fill={color}/>
    </svg>
  );
}

function TrendPill({ current, previous, higherIsBetter=true, unit="" }) {
  if (current==null||previous==null||previous===0) return null;
  const diff = current - previous;
  const up = diff > 0;
  const good = higherIsBetter ? up : !up;
  const absDiff = Math.abs(diff);
  const fmt = absDiff < 1 ? absDiff.toFixed(1) : Math.round(absDiff);
  if (absDiff < 0.05) return <span style={{ fontSize:10, color:"#bdb0a3" }}>≈ same</span>;
  return (
    <span style={{ fontSize:10, fontWeight:700, color: good ? "#4a9e6a" : "#c25a3a",
      background: good ? "#f0faf4" : "#fdf3f0",
      padding:"2px 7px", borderRadius:20, display:"inline-flex", alignItems:"center", gap:3 }}>
      {up?"↑":"↓"} {fmt}{unit}
    </span>
  );
}

// Goal editor — inline, lightweight
function GoalEditor({ goals, onChange, fields }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState(goals || {});
  if (!open) return (
    <button onClick={()=>setOpen(true)}
      style={{ background:"transparent", border:"1px dashed #d4cdc5", borderRadius:6,
        color:"#b0a496", fontSize:11, padding:"4px 10px", cursor:"pointer", fontWeight:500 }}>
      ✎ set goals
    </button>
  );
  return (
    <div style={{ background:"#fff", border:"1px solid #e8e2db", borderRadius:10,
      padding:"14px", marginBottom:12 }}>
      <div style={{ fontSize:10, color:"#9a8f82", textTransform:"uppercase", letterSpacing:"0.08em",
        fontWeight:700, marginBottom:10 }}>Personal goals</div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
        {fields.map(f=>(
          <div key={f.id} style={{ flex:"1 1 120px" }}>
            <div style={{ fontSize:10, color:"#9a8f82", marginBottom:3 }}>{f.label}</div>
            <input type="number" value={vals[f.id]||""} onChange={e=>setVals({...vals,[f.id]:Number(e.target.value)})}
              style={{ width:"100%", background:"#f7f4f0", border:"1px solid #e8e2db", borderRadius:6,
                padding:"5px 8px", fontSize:13, color:"#1a1612", outline:"none", boxSizing:"border-box" }}/>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, marginTop:10 }}>
        <button onClick={()=>{ onChange(vals); setOpen(false); }}
          style={{ background:"#1a1612", border:"none", borderRadius:6, color:"#fff",
            fontSize:11, padding:"5px 14px", cursor:"pointer", fontWeight:600 }}>Save</button>
        <button onClick={()=>setOpen(false)}
          style={{ background:"transparent", border:"none", color:"#9a8f82", fontSize:11, cursor:"pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

// ── EXERCISE TAB ─────────────────────────────────────────────────────────────
function ExerciseTab({ daily, activities, goals, onSaveGoals, domain, K, card, sectionLabel }) {
  const [recs, setRecs]         = useState(null);
  const [loadingRecs, setLoadingRecs] = useState(false);

  const runs     = activities.filter(a=>a.activity_type==="running");
  const strength = activities.filter(a=>a.activity_type==="strength_training");
  const mobility = activities.filter(a=>["yoga","stretching","meditation"].includes(a.activity_type));
  const allEx    = activities.filter(a=>!["meditation"].includes(a.activity_type));

  // Week always Sun–Sat
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon
  const cutoff7  = new Date(now); cutoff7.setDate(now.getDate() - dayOfWeek);          cutoff7.setHours(0,0,0,0);
  const cutoff14 = new Date(now); cutoff14.setDate(now.getDate() - dayOfWeek - 7);    cutoff14.setHours(0,0,0,0);
  const cutoff21 = new Date(now); cutoff21.setDate(now.getDate() - dayOfWeek - 14);   cutoff21.setHours(0,0,0,0);

  // ── Pillar classification ────────────────────────────────────────────────
  // Zone 2: avg HR 60-75% of max (est max ~175). Zone 2 = 105-131 bpm
  // Intensity: avg HR > 80% of max = ~140+ bpm
  const maxHR = 175;
  const z2Max = maxHR * 0.75;
  const hiMin = maxHR * 0.80;

  const classifyActivity = (a) => {
    const hr = a.avg_hr;
    const type = a.activity_type;
    const dMin = (a.duration_seconds||0) / 60;
    const tags = [];
    if (type === "strength_training") return [{ label:"Strength", color:"#c0780a", bg:"#fef3e2" }];
    if (["yoga","stretching"].includes(type)) return [{ label:"Mobility", color:"#6e3fa8", bg:"#f0eafa" }];
    if (!hr) return [{ label:"Zone 2", color:"#2563a8", bg:"#e8f0fa" }];
    const z2Mins = hr <= z2Max ? dMin : hr <= hiMin ? dMin * 0.6 : dMin * 0.2;
    const hiMins = hr >= hiMin ? dMin * 0.8 : hr > z2Max ? dMin * 0.3 : 0;
    if (z2Mins > 5) tags.push({ label:`Zone 2 · ${Math.round(z2Mins)}m`, color:"#2563a8", bg:"#e8f0fa" });
    if (hiMins > 5) tags.push({ label:`Intensity · ${Math.round(hiMins)}m`, color:"#b03020", bg:"#fdf0e8" });
    return tags.length ? tags : [{ label:"Zone 2", color:"#2563a8", bg:"#e8f0fa" }];
  };

  // Week totals
  const toDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const cutoff7Str  = toDateStr(cutoff7);
  const cutoff14Str = toDateStr(cutoff14);
  const weekActs  = allEx.filter(a=>a.date>=cutoff7Str);
  const weekActs2 = allEx.filter(a=>a.date>=cutoff14Str&&a.date<cutoff7Str);

  const weekZ2Min = weekActs.reduce((s,a) => {
    const hr = a.avg_hr; const dMin = (a.duration_seconds||0)/60;
    if (!hr || a.activity_type==="strength_training") return s;
    return s + (hr <= z2Max ? dMin : hr <= hiMin ? dMin*0.6 : dMin*0.2);
  }, 0);
  const weekZ2Min2 = weekActs2.reduce((s,a) => {
    const hr = a.avg_hr; const dMin = (a.duration_seconds||0)/60;
    if (!hr || a.activity_type==="strength_training") return s;
    return s + (hr <= z2Max ? dMin : hr <= hiMin ? dMin*0.6 : dMin*0.2);
  }, 0);

  const weekHiSess  = weekActs.filter(a=>a.avg_hr>=hiMin).length;
  const weekHiSess2 = weekActs2.filter(a=>a.avg_hr>=hiMin).length;
  const weekStr  = strength.filter(a=>a.date>=cutoff7Str).length;
  const weekStr2 = strength.filter(a=>a.date>=cutoff14Str&&a.date<cutoff7Str).length;
  const weekMob  = mobility.filter(a=>a.date>=cutoff7Str).length;
  const weekMob2 = mobility.filter(a=>a.date>=cutoff14Str&&a.date<cutoff7Str).length;

  const actDates = new Set(activities.map(a=>a.date));
  let streak = 0;
  for (let i=0;i<30;i++) { const d=new Date(); d.setDate(d.getDate()-i); const ds=d.toISOString().split("T")[0]; if(actDates.has(ds))streak++; else if(i>0)break; }

  const bestPace = runs.filter(r=>r.avg_pace_min_per_km).sort((a,b)=>a.avg_pace_min_per_km-b.avg_pace_min_per_km)[0];
  const avgDur   = weekActs.length ? Math.round(weekActs.reduce((s,a)=>s+(a.duration_seconds||0),0)/weekActs.length/60) : null;
  const formatDur = s => { if(!s)return"—"; const m=Math.round(s/60); return m>=60?`${Math.floor(m/60)}h${m%60?m%60+"m":""}`:m+"m"; };
  const actIcon = t => ({running:"🏃",strength_training:"💪",cycling:"🚴",swimming:"🏊",meditation:"🧘",walking:"🚶",yoga:"🧘",hiking:"🥾"}[t]||"⚡");

  // Group activities by type+day for breakdown
  const grouped = [];
  const runGroup = weekActs.filter(a=>a.activity_type==="running");
  const strGroup = weekActs.filter(a=>a.activity_type==="strength_training");
  const mobGroup = weekActs.filter(a=>["yoga","stretching","meditation"].includes(a.activity_type));
  const otherGroup = weekActs.filter(a=>!["running","strength_training","yoga","stretching","meditation"].includes(a.activity_type));

  if (runGroup.length > 0) {
    const totalMin = Math.round(runGroup.reduce((s,a)=>s+(a.duration_seconds||0),0)/60);
    const totalKm  = runGroup.reduce((s,a)=>s+((a.distance_meters||0)/1000),0);
    const avgHR    = runGroup.filter(r=>r.avg_hr).length ? Math.round(runGroup.filter(r=>r.avg_hr).reduce((s,r)=>s+r.avg_hr,0)/runGroup.filter(r=>r.avg_hr).length) : null;
    const z2Min = Math.round(runGroup.reduce((s,a)=>{ const hr=a.avg_hr,dMin=(a.duration_seconds||0)/60; return s+(hr<=z2Max?dMin:hr<=hiMin?dMin*0.6:dMin*0.2); },0));
    const hiMin2 = Math.round(runGroup.reduce((s,a)=>{ const hr=a.avg_hr,dMin=(a.duration_seconds||0)/60; return s+(hr>=hiMin?dMin*0.8:hr>z2Max?dMin*0.3:0); },0));
    grouped.push({ icon:"🏃", label:`${runGroup.length} run${runGroup.length>1?"s":""}`, sub:`${totalMin}min · ${totalKm.toFixed(1)}km${avgHR?` · ${avgHR}bpm`:""}`, tags:[
      ...(z2Min>0?[{label:`Zone 2 · ${z2Min}m`,color:"#2563a8",bg:"#e8f0fa"}]:[]),
      ...(hiMin2>0?[{label:`Intensity · ${hiMin2}m`,color:"#b03020",bg:"#fdf0e8"}]:[]),
    ]});
  }
  if (strGroup.length > 0) {
    const totalMin = Math.round(strGroup.reduce((s,a)=>s+(a.duration_seconds||0),0)/60);
    grouped.push({ icon:"💪", label:`${strGroup.length} strength session${strGroup.length>1?"s":""}`, sub:`${totalMin}min total`, tags:[{label:`Strength · ${strGroup.length}×`,color:"#c0780a",bg:"#fef3e2"}] });
  }
  if (mobGroup.length > 0) {
    const totalMin = Math.round(mobGroup.reduce((s,a)=>s+(a.duration_seconds||0),0)/60);
    grouped.push({ icon:"🧘", label:`${mobGroup.length} mobility session${mobGroup.length>1?"s":""}`, sub:`${totalMin}min total`, tags:[{label:`Mobility · ${mobGroup.length}×`,color:"#6e3fa8",bg:"#f0eafa"}] });
  }
  otherGroup.forEach(a => {
    const tags = classifyActivity(a);
    grouped.push({ icon:actIcon(a.activity_type), label:a.name||a.activity_type?.replace(/_/g," "), sub:`${formatDur(a.duration_seconds)}${a.avg_hr?` · ${Math.round(a.avg_hr)}bpm`:""}`, tags });
  });

  // Next week plan
  const getNextWeekPlan = async () => {
    setLoadingRecs(true);
    try {
      const today = new Date();
      const dayOfWeek = (today.getDay() + 6) % 7; // 0=Mon
      const daysLeftInWeek = 6 - dayOfWeek;
      const isMonday = dayOfWeek === 0;

      // Monday = plan full week from today; mid-week = plan remaining days; Sunday = plan next week
      let planStart, planDays, planLabel;
      if (daysLeftInWeek === 0) {
        // Sunday — plan next Mon–Sun
        planStart = new Date(today); planStart.setDate(today.getDate() + 1);
        planDays = 7; planLabel = "next week";
      } else {
        // Mid-week or Monday — plan from today to end of week
        planStart = today;
        planDays = daysLeftInWeek + 1;
        planLabel = isMonday ? "this week" : `${planDays} days remaining this week`;
      }

      const days = Array.from({length: planDays}, (_, i) => {
        const d = new Date(planStart); d.setDate(planStart.getDate() + i);
        return d.toLocaleDateString("en-US", {weekday:"short", month:"numeric", day:"numeric"});
      });

      const prompt = `You are a personal trainer focused on longevity. Plan ${planLabel}.

THIS WEEK SO FAR:
- Zone 2 cardio: ${Math.round(weekZ2Min)} min (goal: ${goals.z2MinGoal||180} min)
- Strength: ${weekStr} sessions (goal: ${goals.weeklyStrength||3})
- High intensity: ${weekHiSess} sessions (goal: ${goals.weeklyHi||2})
- Mobility: ${weekMob} sessions (goal: ${goals.weeklyMob||3})
- Streak: ${streak} days
- Avg stress: ${daily[0]?.stress_avg ? Math.round(daily[0].stress_avg) : "unknown"}

DAYS TO PLAN: ${days.join(", ")}

Return ONLY valid JSON (no markdown, no extra text):
{"summary":"one line focus","days":[{"date":"Mon 6/9","activities":[{"label":"Easy run","duration":"40m","pillar":"zone2"}]},{"date":"Tue 6/10","activities":[{"label":"Rest","pillar":"rest"}]}],"notes":["note 1","note 2"]}
Pillar must be exactly: zone2, strength, intensity, mobility, or rest`;

      const resp = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000,
          messages:[{role:"user", content:prompt}] })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const raw = data.content?.find(b=>b.type==="text")?.text || "{}";
      const clean = raw.replace(/```json|```/g,"").trim();
      const plan = JSON.parse(clean);
      setRecs(plan);
    } catch(e) {
      console.error("Plan error:", e);
      setRecs({ summary:"Plan failed — check browser console", days:[], notes:[String(e)] });
    }
    setLoadingRecs(false);
  };

  const pillarColor = { zone2:"#2563a8", strength:"#c0780a", intensity:"#b03020", mobility:"#6e3fa8", rest:K.border };
  const pillarBg    = { zone2:"#e8f0fa", strength:"#fef3e2", intensity:"#fdf0e8", mobility:"#f0eafa", rest:"#f7f4f0" };

  return (
    <>
      <GoalEditor goals={goals} onChange={onSaveGoals} fields={[
        {id:"z2MinGoal",label:"Zone 2 min/week"},{id:"weeklyStrength",label:"Strength sessions"},
        {id:"weeklyHi",label:"Intensity sessions"},{id:"weeklyMob",label:"Mobility sessions"},
      ]}/>

      {/* ── SCORECARD ── */}
      <div style={{...card}}>
        <div style={{ fontSize:9, color:K.inkFaint, textTransform:"uppercase", letterSpacing:"0.11em", fontWeight:700, marginBottom:16 }}>
          This week · {cutoff7.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – {new Date(cutoff7.getTime()+6*86400000).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:2, marginBottom:8 }}>
          {[
            { value:Math.round(weekZ2Min), goal:goals.z2MinGoal||180, max:240, color:"#2563a8", label:"Zone 2", unit:"min", prev:Math.round(weekZ2Min2) },
            { value:weekStr, goal:goals.weeklyStrength||3, max:7, color:"#c0780a", label:"Strength", unit:"", prev:weekStr2 },
            { value:weekHiSess, goal:goals.weeklyHi||2, max:5, color:"#b03020", label:"Intensity", unit:"", prev:weekHiSess2 },
            { value:weekMob, goal:goals.weeklyMob||3, max:7, color:"#6e3fa8", label:"Mobility", unit:"", prev:weekMob2 },
          ].map((g,i) => {
            const pct = Math.min(1, g.value/(g.max||1));
            const goalPct = Math.min(1, g.goal/(g.max||1));
            const arcSpan = 0.75;
            const r=36, cx=46, cy=46, size=92;
            const circ = 2*Math.PI*r;
            const dashVal  = pct * arcSpan * circ;
            const dashGoal = goalPct * arcSpan * circ;
            const diff = g.value - g.prev;
            const up = diff > 0;
            const good = up;
            const atGoal = g.value >= g.goal;
            return (
              <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                  <g transform={`rotate(144 ${cx} ${cy})`}>
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e8e2d9" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${arcSpan*circ} ${circ}`}/>
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke={g.color} strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${dashVal} ${circ}`}
                      style={{transition:"stroke-dasharray 0.9s cubic-bezier(.4,0,.2,1)"}}/>
                  </g>
                  <text x={cx} y={cy-6} textAnchor="middle" style={{fontSize:18,fontWeight:500,fill:"#1a1612",fontFamily:"system-ui"}}>{g.value}</text>
                  <text x={cx} y={cy+7} textAnchor="middle" style={{fontSize:9,fill:"#a89e92",fontFamily:"system-ui"}}>of {g.goal}{g.unit}</text>
                  <text x={cx} y={cy+19} textAnchor="middle" style={{fontSize:9,fill:atGoal?g.color:"#a89e92",fontFamily:"system-ui"}}>
                    {atGoal ? "✓ goal" : `${Math.round(pct/goalPct*100)}%`}
                  </text>
                </svg>
                <div style={{ fontSize:9, color:K.inkFaint, textTransform:"uppercase", letterSpacing:"0.11em", fontWeight:700 }}>{g.label}</div>
                {Math.abs(diff) > 0 ? (
                  <span style={{ fontSize:10, fontWeight:600, padding:"2px 7px", borderRadius:20,
                    color:good?"#1a6e50":"#a03020", background:good?"#edf7f3":"#faf0ee" }}>
                    {up?"↑":"↓"} {Math.abs(diff)}{g.unit} vs last wk
                  </span>
                ) : (
                  <span style={{ fontSize:10, color:K.inkFaint }}>≈ same</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick stats strip */}
        <div style={{ display:"flex", gap:8, paddingTop:12, borderTop:`1px solid ${K.border}` }}>
          <div style={{ flex:1, textAlign:"center" }}>
            <div style={{ fontSize:9, color:K.inkFaint, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700, marginBottom:3 }}>Streak</div>
            <div style={{ fontSize:18, fontWeight:600, color:streak>0?K.teal:K.inkFaint }}>{streak}<span style={{fontSize:11,color:K.inkFaint,marginLeft:2}}>d</span></div>
          </div>
          <div style={{ flex:1, textAlign:"center" }}>
            <div style={{ fontSize:9, color:K.inkFaint, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700, marginBottom:3 }}>Avg session</div>
            <div style={{ fontSize:18, fontWeight:600, color:K.ink }}>{avgDur||"—"}<span style={{fontSize:11,color:K.inkFaint,marginLeft:2}}>min</span></div>
          </div>
          {bestPace && (
            <div style={{ flex:1, textAlign:"center" }}>
              <div style={{ fontSize:9, color:K.inkFaint, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700, marginBottom:3 }}>Best pace</div>
              <div style={{ fontSize:18, fontWeight:600, color:"#2563a8" }}>{bestPace.avg_pace_min_per_km.toFixed(2)}<span style={{fontSize:11,color:K.inkFaint,marginLeft:2}}>/km</span></div>
            </div>
          )}
        </div>
      </div>

      {/* ── HOW YOU GOT THERE ── */}
      {grouped.length > 0 && (
        <div style={{...card}}>
          <div style={{ ...sectionLabel, marginBottom:12 }}>How you got there</div>
          {grouped.map((g,i) => (
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10,
              padding:"9px 0", borderBottom:i<grouped.length-1?`1px solid ${K.border}`:"none" }}>
              <div style={{ fontSize:15, flexShrink:0, marginTop:1 }}>{g.icon}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, color:K.ink }}>{g.label}</div>
                <div style={{ fontSize:10, color:K.inkFaint, marginTop:1 }}>{g.sub}</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:3, alignItems:"flex-end", flexShrink:0 }}>
                {g.tags.map((t,j) => (
                  <span key={j} style={{ fontSize:9, background:t.bg, color:t.color,
                    padding:"2px 6px", borderRadius:10, fontWeight:600 }}>{t.label}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── NEXT WEEK ── */}
      <div style={{...card}}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:recs?14:0 }}>
          <div style={{ ...sectionLabel, marginBottom:0 }}>Next week</div>
          {!recs && (
            <button onClick={getNextWeekPlan} disabled={loadingRecs}
              style={{ background:loadingRecs?K.warm:K.ink, border:"none", borderRadius:8,
                color:loadingRecs?K.inkFaint:"#fff", fontSize:11, padding:"6px 12px",
                cursor:loadingRecs?"default":"pointer", fontWeight:600 }}>
              {loadingRecs ? "Planning…" : "✦ Generate plan"}
            </button>
          )}
          {recs && (
            <button onClick={()=>setRecs(null)}
              style={{ background:"transparent", border:"none", color:K.inkFaint,
                fontSize:11, cursor:"pointer" }}>reset</button>
          )}
        </div>

        {recs && (
          <>
            {/* Summary badge */}
            {recs.summary && (
              <div style={{ fontSize:11, color:K.teal, background:"#edf7f3",
                padding:"6px 10px", borderRadius:8, marginBottom:14, fontWeight:500 }}>
                {recs.summary}
              </div>
            )}

            {/* 7-day calendar */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:14 }}>
              {(recs.days||[]).map((day,i) => (
                <div key={i} style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <div style={{ fontSize:9, color:K.inkFaint, textAlign:"center", fontWeight:600,
                    paddingBottom:3 }}>{day.date?.split(" ")[0]}</div>
                  <div style={{ background:"#f7f4f0", borderRadius:8, padding:"5px 3px",
                    minHeight:70, display:"flex", flexDirection:"column", gap:3, alignItems:"stretch" }}>
                    <div style={{ fontSize:8, color:K.inkFaint, textAlign:"center" }}>{day.date?.split(" ")[1]}</div>
                    {(day.activities||[]).map((a,j) => {
                      const isRest = a.pillar==="rest" || a.type==="rest";
                      return isRest ? (
                        <div key={j} style={{ fontSize:8, color:"#d0c8be", textAlign:"center", marginTop:4 }}>rest</div>
                      ) : (
                        <div key={j} style={{ background:pillarBg[a.pillar]||"#f0ebe3",
                          borderRadius:4, padding:"3px 4px", textAlign:"center" }}>
                          <div style={{ fontSize:8, fontWeight:600, color:pillarColor[a.pillar]||K.inkMid }}>
                            {a.label}
                          </div>
                          {a.duration && <div style={{ fontSize:7, color:pillarColor[a.pillar]||K.inkFaint, opacity:0.8 }}>{a.duration}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Coaching notes */}
            {recs.notes?.length > 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {recs.notes.map((n,i) => (
                  <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background:K.teal,
                      flexShrink:0, marginTop:4 }}/>
                    <span style={{ fontSize:11, color:K.inkMid, lineHeight:1.5 }}>{n}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Pillar legend */}
            <div style={{ display:"flex", gap:10, flexWrap:"wrap", paddingTop:12,
              marginTop:10, borderTop:`1px solid ${K.border}` }}>
              {[["Zone 2","#2563a8","#e8f0fa"],["Strength","#c0780a","#fef3e2"],["Intensity","#b03020","#fdf0e8"],["Mobility","#6e3fa8","#f0eafa"]].map(([l,c,bg])=>(
                <div key={l} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:8, height:8, borderRadius:2, background:bg, border:`1px solid ${c}` }}/>
                  <span style={{ fontSize:9, color:K.inkFaint }}>{l}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!recs && !loadingRecs && (
          <div style={{ fontSize:12, color:K.inkFaint, marginTop:10, fontStyle:"italic" }}>
            Get a personalized plan based on this week's training.
          </div>
        )}
      </div>
    </>
  );
}

function BodyDomainView({ domain, onUpdate, onBack }) {
  const [daily, setDaily]     = useState([]);
  const [activities, setActs] = useState([]);
  const [meals, setMeals]     = useState(domain.meals || []);
  const [goals, setGoals]     = useState(domain.bodyGoals || {
    weeklyKm: 40, weeklyRuns: 4, avgSleepHrs: 7.5, sleepScore: 75,
    weeklyStrength: 2, stressTarget: 30, restingHRTarget: 55, dailySteps: 10000,
    dailyCal: 2200, dailyProtein: 140,
  });
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("exercise");
  const [lastSync, setLastSync] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [mealNote, setMealNote] = useState("");
  const foodInputRef = useRef(null);

  const saveGoals = (g) => {
    setGoals(g);
    onUpdate({ ...domain, bodyGoals: g });
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const headers = { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` };
      const [d, a] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/health_daily?order=date.desc&limit=30`, { headers }).then(r=>r.json()),
        fetch(`${SUPA_URL}/rest/v1/health_activities?order=date.desc&limit=60`, { headers }).then(r=>r.json()),
      ]);
      if (Array.isArray(d)) setDaily(d);
      if (Array.isArray(a)) setActs(a);
      setLastSync(new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}));
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // ── Data ─────────────────────────────────────────────────────────────────
  const today  = daily[0];
  const week7  = daily.slice(0,7);
  const week14 = daily.slice(0,14);

  const runs     = activities.filter(a=>a.activity_type==="running");
  const strength = activities.filter(a=>a.activity_type==="strength_training");
  const allEx    = activities.filter(a=>!["meditation"].includes(a.activity_type));

  const actDates = new Set(activities.map(a=>a.date));
  let streak = 0;
  for (let i=0;i<30;i++) {
    const d=new Date(); d.setDate(d.getDate()-i);
    const ds=d.toISOString().split("T")[0];
    if(actDates.has(ds)) streak++;
    else if(i>0) break;
  }

  // Week always Sun–Sat
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon
  const cutoff7  = new Date(now); cutoff7.setDate(now.getDate() - dayOfWeek);          cutoff7.setHours(0,0,0,0);
  const cutoff14 = new Date(now); cutoff14.setDate(now.getDate() - dayOfWeek - 7);    cutoff14.setHours(0,0,0,0);
  const cutoff21 = new Date(now); cutoff21.setDate(now.getDate() - dayOfWeek - 14);   cutoff21.setHours(0,0,0,0);
  const toDS = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const cutoff7Str  = toDS(cutoff7);
  const cutoff14Str = toDS(cutoff14);
  const week7Acts  = allEx.filter(a=>a.date>=cutoff7Str);
  const week14Acts = allEx.filter(a=>a.date>=cutoff14Str&&a.date<cutoff7Str);
  const weekRunKm  = runs.filter(a=>a.date>=cutoff7Str).reduce((s,a)=>s+((a.distance_meters||0)/1000),0);
  const weekRunKm2 = runs.filter(a=>a.date>=cutoff14Str&&a.date<cutoff7Str).reduce((s,a)=>s+((a.distance_meters||0)/1000),0);
  const weekRuns   = runs.filter(a=>a.date>=cutoff7Str).length;
  const weekRuns2  = runs.filter(a=>a.date>=cutoff14Str&&a.date<cutoff7Str).length;
  const avgDur     = week7Acts.length ? Math.round(week7Acts.reduce((s,a)=>s+(a.duration_seconds||0),0)/week7Acts.length/60) : null;
  const avgRunHRArr = runs.filter(r=>r.avg_hr).slice(0,10);
  const avgRunHR = avgRunHRArr.length ? Math.round(avgRunHRArr.reduce((s,r)=>s+r.avg_hr,0)/avgRunHRArr.length) : null;
  const bestPace = runs.filter(r=>r.avg_pace_min_per_km).sort((a,b)=>a.avg_pace_min_per_km-b.avg_pace_min_per_km)[0];
  const weekStr    = strength.filter(a=>a.date>=cutoff7Str).length;
  const weekStr2   = strength.filter(a=>a.date>=cutoff14Str&&a.date<cutoff7Str).length;

  const avgStress7  = week7.filter(d=>d.stress_avg).length ? Math.round(week7.filter(d=>d.stress_avg).reduce((s,d)=>s+d.stress_avg,0)/week7.filter(d=>d.stress_avg).length) : null;
  const avgStress14 = daily.slice(7,14).filter(d=>d.stress_avg).length ? Math.round(daily.slice(7,14).filter(d=>d.stress_avg).reduce((s,d)=>s+d.stress_avg,0)/daily.slice(7,14).filter(d=>d.stress_avg).length) : null;
  const avgRHR7  = week7.filter(d=>d.resting_hr).length ? Math.round(week7.filter(d=>d.resting_hr).reduce((s,d)=>s+d.resting_hr,0)/week7.filter(d=>d.resting_hr).length) : null;
  const avgRHR14 = daily.slice(7,14).filter(d=>d.resting_hr).length ? Math.round(daily.slice(7,14).filter(d=>d.resting_hr).reduce((s,d)=>s+d.resting_hr,0)/daily.slice(7,14).filter(d=>d.resting_hr).length) : null;

  const sleepDays   = daily.filter(d=>d.sleep_hrs);
  const lastSleep   = sleepDays[0];
  const prevSleep   = sleepDays[1];
  const avg7sleep   = sleepDays.slice(0,7).length ? +(sleepDays.slice(0,7).reduce((s,d)=>s+d.sleep_hrs,0)/sleepDays.slice(0,7).length).toFixed(1) : null;
  const avg14sleep  = sleepDays.slice(7,14).length ? +(sleepDays.slice(7,14).reduce((s,d)=>s+d.sleep_hrs,0)/sleepDays.slice(7,14).length).toFixed(1) : null;
  const avgScore7   = sleepDays.filter(d=>d.sleep_score).slice(0,7);
  const avgSleepScore = avgScore7.length ? Math.round(avgScore7.reduce((s,d)=>s+d.sleep_score,0)/avgScore7.length) : null;
  const prevAvgScore  = sleepDays.filter(d=>d.sleep_score).slice(7,14);
  const prevSleepScore = prevAvgScore.length ? Math.round(prevAvgScore.reduce((s,d)=>s+d.sleep_score,0)/prevAvgScore.length) : null;

  const formatDur = s => { if(!s)return"—"; const m=Math.round(s/60); return m>=60?`${Math.floor(m/60)}h${m%60?m%60+"m":""}`:m+"m"; };
  const actIcon = t => ({running:"🏃",strength_training:"💪",cycling:"🚴",swimming:"🏊",meditation:"🧘",walking:"🚶",yoga:"🧘",hiking:"🥾"}[t]||"⚡");

  // Kandinsky palette — primary, deliberate
  const K = {
    bg:      "#f5f2ed",
    surface: "#ffffff",
    warm:    "#f0ebe3",
    red:     "#c0392b",
    blue:    "#2563a8",
    yellow:  "#d4960a",
    teal:    "#1a7a6e",
    ink:     "#1a1612",
    inkMid:  "#4a3f35",
    inkFaint:"#9a8f82",
    border:  "#e4ddd4",
  };

  const analyzeFood = async (file) => {
    setAnalyzing(true);
    try {
      const base64 = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(file); });
      const resp = await fetch("/api/claude", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:500,
          messages:[{ role:"user", content:[
            { type:"image", source:{ type:"base64", media_type:file.type||"image/jpeg", data:base64 }},
            { type:"text", text:`Analyze this food. Return ONLY JSON (no markdown, no explanation):
{"name":"meal name","calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"notes":"brief"}` }
          ]}]})
      });
      const data = await resp.json();
      const text = data.content?.find(b=>b.type==="text")?.text||"{}";
      const meal = JSON.parse(text.replace(/```json|```/g,"").trim());
      const newMeal = {...meal, id:`meal${Date.now()}`, date:new Date().toISOString().split("T")[0], time:new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}), note:mealNote};
      const updated = [newMeal,...(domain.meals||[])];
      setMeals(updated);
      onUpdate({...domain, meals:updated});
      setMealNote("");
    } catch(e) { console.error(e); }
    setAnalyzing(false);
  };

  const todayMeals = meals.filter(m=>m.date===new Date().toISOString().split("T")[0]);
  const totalCal  = todayMeals.reduce((s,m)=>s+(m.calories||0),0);
  const totalPro  = todayMeals.reduce((s,m)=>s+(m.protein_g||0),0);
  const totalCarb = todayMeals.reduce((s,m)=>s+(m.carbs_g||0),0);
  const totalFat  = todayMeals.reduce((s,m)=>s+(m.fat_g||0),0);

  const TABS = [{id:"exercise",label:"Move"},{id:"sleep",label:"Sleep"},{id:"health",label:"Health"},{id:"nutrition",label:"Fuel"}];

  const sectionLabel = { fontSize:10, color:K.inkFaint, textTransform:"uppercase",
    letterSpacing:"0.1em", fontWeight:700, marginBottom:8 };
  const card = { background:K.surface, borderRadius:14, padding:"16px",
    marginBottom:12, border:`1px solid ${K.border}`,
    boxShadow:"0 1px 4px rgba(26,22,18,0.06)" };

  return (
    <div style={{ background:K.bg, minHeight:"100%" }}>
      {/* Header */}
      <div style={{ padding:"16px 20px 10px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:4, height:24, borderRadius:2, background:domain.color }}/>
          <span style={{ fontSize:21, fontWeight:700, color:K.ink, letterSpacing:"-0.4px" }}>Body</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {lastSync && <span style={{ fontSize:11, color:K.inkFaint }}>{lastSync}</span>}
          <button onClick={loadData} disabled={loading}
            style={{ background:K.warm, border:`1px solid ${K.border}`, borderRadius:8,
              color:K.inkMid, fontSize:12, padding:"5px 11px", cursor:loading?"default":"pointer", fontWeight:500 }}>
            {loading?"…":"↻"}
          </button>
        </div>
      </div>

      {/* Tabs — pill style, warm */}
      <div style={{ display:"flex", gap:4, padding:"0 16px 14px" }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{ flex:1, border:"none", borderRadius:8,
              background: tab===t.id ? K.ink : K.warm,
              color: tab===t.id ? "#fff" : K.inkFaint,
              padding:"8px 3px", fontSize:11, cursor:"pointer",
              fontWeight: tab===t.id ? 700 : 500, transition:"all 0.15s" }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:K.inkFaint, fontSize:13 }}>Loading…</div>
      ) : daily.length===0 ? (
        <div style={{ textAlign:"center", padding:"60px 20px" }}>
          <div style={{ fontSize:13, color:K.inkFaint }}>No data yet — run python3 ~/garmin_sync.py</div>
        </div>
      ) : (
      <div style={{ padding:"0 14px" }}>

      {/* ── MOVE ─────────────────────────────────────────────────────────── */}
      {tab==="exercise" && (
        <ExerciseTab
          daily={daily} activities={activities} goals={goals} onSaveGoals={saveGoals}
          domain={domain} K={K} card={card} sectionLabel={sectionLabel}
        />
      )}
      {/* ── SLEEP ────────────────────────────────────────────────────────── */}
      {tab==="sleep" && (
        <>
          <GoalEditor goals={goals} onChange={saveGoals} fields={[
            {id:"avgSleepHrs",label:"Sleep target (hrs)"},{id:"sleepScore",label:"Score target"},
          ]}/>

          {!lastSleep ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:K.inkFaint, fontSize:13 }}>
              No sleep data — sync after wearing your watch overnight
            </div>
          ) : (
            <>
              {/* Hero card — score + arcs */}
              <div style={{ ...card, background:"#fafaf8" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:9, color:K.inkFaint, textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700, marginBottom:4 }}>
                      Last night · {lastSleep.date}
                    </div>
                    {lastSleep.sleep_feedback && (
                      <div style={{ fontSize:12, color:K.inkMid, lineHeight:1.4, maxWidth:180 }}>
                        {lastSleep.sleep_feedback.replace(/_/g," ").toLowerCase()}
                      </div>
                    )}
                  </div>
                  {lastSleep.sleep_score!=null && (
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:44, fontWeight:800, color:lastSleep.sleep_score>=75?K.teal:lastSleep.sleep_score>=60?K.yellow:K.red, lineHeight:1, letterSpacing:"-1px" }}>
                        {lastSleep.sleep_score}
                      </div>
                      <div style={{ fontSize:9, color:K.inkFaint, marginTop:2 }}>SLEEP SCORE</div>
                      <div style={{ marginTop:4 }}>
                        <TrendPill current={lastSleep.sleep_score} previous={prevSleep?.sleep_score} higherIsBetter={true}/>
                      </div>
                    </div>
                  )}
                </div>

                {/* Arc gauges */}
                <div style={{ display:"flex", justifyContent:"space-around" }}>
                  <ArcGauge value={lastSleep.sleep_hrs} goal={goals.avgSleepHrs} max={10}
                    size={100} color={K.teal} unit="h" label="Total"
                    trackColor="#e0ede9"/>
                  <ArcGauge value={lastSleep.deep_hrs} goal={+(lastSleep.sleep_hrs*0.18).toFixed(1)} max={3}
                    size={100} color={K.blue} unit="h" label="Deep"
                    trackColor="#dce8f5"/>
                  <ArcGauge value={lastSleep.rem_hrs} goal={+(lastSleep.sleep_hrs*0.21).toFixed(1)} max={3}
                    size={100} color="#7c52c8" unit="h" label="REM"
                    trackColor="#ede8f8"/>
                  <ArcGauge value={lastSleep.avg_spo2} goal={96} max={100}
                    size={100} color={lastSleep.avg_spo2>=95?K.teal:K.yellow} unit="%" label="SpO₂"
                    trackColor="#e0ede9"/>
                </div>
              </div>

              {/* Stage bar */}
              {(lastSleep.deep_hrs||lastSleep.rem_hrs||lastSleep.light_hrs) && (
                <div style={card}>
                  <div style={{ ...sectionLabel, marginBottom:10 }}>Stage breakdown</div>
                  <div style={{ display:"flex", height:10, borderRadius:5, overflow:"hidden", gap:1, marginBottom:10 }}>
                    {lastSleep.deep_hrs  && <div style={{ flex:lastSleep.deep_hrs,  background:K.blue, opacity:0.85 }}/>}
                    {lastSleep.rem_hrs   && <div style={{ flex:lastSleep.rem_hrs,   background:"#7c52c8", opacity:0.85 }}/>}
                    {lastSleep.light_hrs && <div style={{ flex:lastSleep.light_hrs, background:K.border }}/>}
                  </div>
                  <div style={{ display:"flex", gap:14, flexWrap:"wrap" }}>
                    {[["Deep",K.blue,lastSleep.deep_hrs,0.13,0.23],["REM","#7c52c8",lastSleep.rem_hrs,0.20,0.25],["Light",K.inkFaint,lastSleep.light_hrs,null,null]].map(([l,c,h,lo,hi])=>h&&(
                      <div key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:c }}/>
                        <span style={{ fontSize:11, color:K.inkMid, fontWeight:500 }}>
                          {l} {h}h · {Math.round(h/lastSleep.sleep_hrs*100)}%
                          {lo&&hi&&<span style={{ color: h/lastSleep.sleep_hrs>=lo&&h/lastSleep.sleep_hrs<=hi ? K.teal : K.yellow,
                            marginLeft:4, fontSize:10 }}>
                            {h/lastSleep.sleep_hrs>=lo&&h/lastSleep.sleep_hrs<=hi ? "✓" : "optimal "+Math.round(lo*100)+"–"+Math.round(hi*100)+"%"}
                          </span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Vitals */}
              {(lastSleep.avg_hr_sleep||lastSleep.avg_respiration||lastSleep.avg_spo2) && (
                <div style={{ ...card, display:"flex", gap:20, flexWrap:"wrap" }}>
                  {lastSleep.avg_hr_sleep && (
                    <div>
                      <div style={{ ...sectionLabel, marginBottom:4 }}>HR during sleep</div>
                      <span style={{ fontSize:24, fontWeight:800, color:K.ink }}>{Math.round(lastSleep.avg_hr_sleep)}</span>
                      <span style={{ fontSize:12, color:K.inkFaint, marginLeft:3 }}>bpm</span>
                    </div>
                  )}
                  {lastSleep.avg_respiration && (
                    <div>
                      <div style={{ ...sectionLabel, marginBottom:4 }}>Respiration</div>
                      <span style={{ fontSize:24, fontWeight:800, color:K.ink }}>{lastSleep.avg_respiration}</span>
                      <span style={{ fontSize:12, color:K.inkFaint, marginLeft:3 }}>br/min</span>
                    </div>
                  )}
                </div>
              )}

              {/* 7-night trend */}
              {sleepDays.length>2 && (
                <div style={card}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                    <div style={sectionLabel}>Sleep score · 7 nights</div>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      {avgSleepScore && <span style={{ fontSize:13, fontWeight:700, color:avgSleepScore>=75?K.teal:K.yellow }}>avg {avgSleepScore}</span>}
                      <TrendPill current={avgSleepScore} previous={prevSleepScore} higherIsBetter={true}/>
                    </div>
                  </div>
                  <TrendLine data={[...sleepDays.slice(0,7)].reverse().map(d=>d.sleep_score||0)}
                    color={K.teal} height={50} goalLine={goals.sleepScore}/>
                </div>
              )}

              {/* Nightly log */}
              <div style={card}>
                <div style={{ ...sectionLabel, marginBottom:10 }}>Nightly log</div>
                {sleepDays.slice(0,7).map((d,i)=>(
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10,
                    padding:"8px 0", borderBottom:i<sleepDays.slice(0,7).length-1?`1px solid ${K.border}`:"none" }}>
                    <div style={{ width:44, flexShrink:0, fontSize:11, fontWeight:600,
                      color:i===0?domain.color:K.inkFaint }}>{d.date?.slice(5)}</div>
                    <div style={{ flex:1, display:"flex", gap:10 }}>
                      {d.sleep_hrs && <span style={{ fontSize:12, fontWeight:600, color:K.ink }}>{d.sleep_hrs}h</span>}
                      {d.deep_hrs  && <span style={{ fontSize:11, color:K.blue }}>D {d.deep_hrs}h</span>}
                      {d.rem_hrs   && <span style={{ fontSize:11, color:"#7c52c8" }}>R {d.rem_hrs}h</span>}
                    </div>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      {d.avg_spo2 && <span style={{ fontSize:10, color:K.inkFaint }}>SpO₂ {d.avg_spo2}%</span>}
                      {d.sleep_score && (
                        <span style={{ fontSize:15, fontWeight:800,
                          color:d.sleep_score>=75?K.teal:d.sleep_score>=60?K.yellow:K.red }}>
                          {d.sleep_score}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── HEALTH ───────────────────────────────────────────────────────── */}
      {tab==="health" && (
        <>
          <GoalEditor goals={goals} onChange={saveGoals} fields={[
            {id:"stressTarget",label:"Stress target (lower)"},{id:"restingHRTarget",label:"Resting HR target"},
            {id:"dailySteps",label:"Daily steps goal"},
          ]}/>

          {/* Arc gauges */}
          <div style={card}>
            <div style={{ display:"flex", justifyContent:"space-around" }}>
              <ArcGauge value={today?.resting_hr} goal={goals.restingHRTarget} max={100}
                size={100} color={K.red} unit="bpm" label="Resting HR"
                trackColor="#f0e0de"
                showGoalTick={true}/>
              {/* Stress: lower is better, so invert — show "calm score" */}
              <ArcGauge value={today?.stress_avg?Math.max(0,100-Math.round(today.stress_avg)):null}
                goal={100-goals.stressTarget} max={100}
                size={100} color={K.teal} unit="" label="Calm score"
                trackColor="#e0ede9"/>
              <ArcGauge value={today?.steps} goal={goals.dailySteps} max={goals.dailySteps*1.3}
                size={100} color={K.yellow} unit="" label="Steps"
                trackColor="#f0ecde"/>
            </div>
            <div style={{ display:"flex", justifyContent:"space-around", paddingTop:10, borderTop:`1px solid ${K.border}`, marginTop:8 }}>
              <TrendPill current={avgRHR7} previous={avgRHR14} higherIsBetter={false}/>
              <TrendPill current={avgStress7} previous={avgStress14} higherIsBetter={false}/>
              <TrendPill current={today?.steps} previous={daily[1]?.steps} higherIsBetter={true}/>
            </div>
          </div>

          {/* Stress trend */}
          <div style={card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={sectionLabel}>Stress · 14 days</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                {avgStress7!=null&&<span style={{ fontSize:13, fontWeight:700, color:avgStress7<30?K.teal:avgStress7<50?K.yellow:K.red }}>{avgStress7} avg</span>}
                <TrendPill current={avgStress7} previous={avgStress14} higherIsBetter={false}/>
              </div>
            </div>
            <TrendLine data={[...week14].reverse().map(d=>d.stress_avg||0)}
              color={avgStress7!=null?(avgStress7<30?K.teal:avgStress7<50?K.yellow:K.red):K.inkFaint}
              height={50} goalLine={goals.stressTarget}/>
            <div style={{ display:"flex", gap:12, marginTop:6 }}>
              {[["< 30","calm",K.teal],["30–50","moderate",K.yellow],["50+","stressed",K.red]].map(([v,l,c])=>(
                <div key={l} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <div style={{ width:6, height:6, borderRadius:"50%", background:c }}/>
                  <span style={{ fontSize:9, color:K.inkFaint }}>{v} {l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RHR trend */}
          <div style={card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={sectionLabel}>Resting HR · 14 days</div>
              {avgRHR7!=null&&<span style={{ fontSize:12, fontWeight:600, color:K.inkMid }}>{avgRHR7} bpm avg</span>}
            </div>
            <TrendLine data={[...week14].reverse().map(d=>d.resting_hr||0)}
              color={K.red} height={44} goalLine={goals.restingHRTarget}/>
          </div>

          {/* Daily log */}
          <div style={card}>
            <div style={{ ...sectionLabel, marginBottom:10 }}>Daily log</div>
            {week7.map((d,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:8,
                padding:"8px 0", borderBottom:i<6?`1px solid ${K.border}`:"none" }}>
                <div style={{ width:44, flexShrink:0, fontSize:11, fontWeight:600,
                  color:i===0?domain.color:K.inkFaint }}>{d.date?.slice(5)}</div>
                <div style={{ flex:1, display:"flex", gap:10, flexWrap:"wrap" }}>
                  {d.steps&&<span style={{ fontSize:11, color:K.inkMid }}>{(d.steps/1000).toFixed(1)}k steps</span>}
                  {d.stress_avg&&<span style={{ fontSize:11, color:d.stress_avg<30?K.teal:d.stress_avg<50?K.yellow:K.red }}>
                    stress {Math.round(d.stress_avg)}</span>}
                  {d.resting_hr&&<span style={{ fontSize:11, color:K.inkFaint }}>{d.resting_hr} bpm</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── FUEL ─────────────────────────────────────────────────────────── */}
      {tab==="nutrition" && (
        <>
          <GoalEditor goals={goals} onChange={saveGoals} fields={[
            {id:"dailyCal",label:"Daily calories"},{id:"dailyProtein",label:"Protein (g)"},
          ]}/>

          {todayMeals.length>0 && (
            <div style={card}>
              <div style={{ ...sectionLabel, marginBottom:12 }}>Today</div>
              <div style={{ display:"flex", justifyContent:"space-around", marginBottom:12 }}>
                <ArcGauge value={totalCal} goal={goals.dailyCal} max={goals.dailyCal*1.4}
                  size={100} color={K.yellow} unit="kcal" label="Calories" trackColor="#f0ecde"/>
                <ArcGauge value={Math.round(totalPro)} goal={goals.dailyProtein} max={goals.dailyProtein*1.5}
                  size={100} color={K.blue} unit="g" label="Protein" trackColor="#dce8f5"/>
              </div>
              {/* Macro mini bars */}
              <div style={{ display:"flex", gap:10 }}>
                {[["Carbs",totalCarb,250,K.yellow],["Fat",totalFat,80,"#c0392b"]].map(([l,v,g,c])=>(
                  <div key={l} style={{ flex:1 }}>
                    <div style={{ fontSize:9, color:K.inkFaint, marginBottom:4, fontWeight:600,
                      textTransform:"uppercase", letterSpacing:"0.07em" }}>{l} {Math.round(v)}g</div>
                    <div style={{ height:4, background:K.border, borderRadius:2 }}>
                      <div style={{ width:`${Math.min(100,v/g*100)}%`, height:"100%", background:c, borderRadius:2 }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom:12 }}>
            <input ref={foodInputRef} type="file" accept="image/*" style={{ display:"none" }}
              onChange={e=>{if(e.target.files?.[0])analyzeFood(e.target.files[0]);}}/>
            <button onClick={()=>foodInputRef.current?.click()} disabled={analyzing}
              style={{ width:"100%", background: analyzing ? K.warm : K.ink,
                border:"none", borderRadius:12, color:"#fff", fontSize:14, fontWeight:700,
                padding:"14px", cursor:analyzing?"default":"pointer" }}>
              {analyzing ? "🔍 Analyzing…" : "📷 Log a meal"}
            </button>
            {!analyzing && (
              <input dir="ltr" value={mealNote} onChange={e=>setMealNote(e.target.value)}
                placeholder="Add context (optional)…"
                style={{ width:"100%", marginTop:8, background:"transparent", border:"none",
                  borderBottom:`1px solid ${K.border}`, color:K.ink, fontSize:13,
                  padding:"5px 0", outline:"none", boxSizing:"border-box" }}/>
            )}
          </div>

          {todayMeals.length>0 && (
            <div style={card}>
              <div style={{ ...sectionLabel, marginBottom:10 }}>Today's meals</div>
              {todayMeals.map((m,i)=>(
                <div key={i} style={{ padding:"10px 0", borderBottom:i<todayMeals.length-1?`1px solid ${K.border}`:"none" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                    <div style={{ flex:1, minWidth:0, marginRight:8 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:K.ink }}>{m.name}</div>
                      {m.note&&<div style={{ fontSize:11, color:K.inkFaint }}>{m.note}</div>}
                    </div>
                    <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                      <span style={{ fontSize:14, fontWeight:700, color:K.yellow }}>{m.calories} kcal</span>
                      <button onClick={()=>{const u=meals.filter((_,j)=>j!==meals.indexOf(m));setMeals(u);onUpdate({...domain,meals:u});}}
                        style={{ background:"transparent", border:"none", color:K.inkFaint, cursor:"pointer", fontSize:15, padding:0 }}>×</button>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:10 }}>
                    {[["P",m.protein_g,K.blue],["C",m.carbs_g,K.yellow],["F",m.fat_g,K.red]].map(([l,v,c])=>(
                      <span key={l} style={{ fontSize:11, color:K.inkFaint }}>
                        <span style={{ color:c, fontWeight:600 }}>{l}</span> {Math.round(v||0)}g
                      </span>
                    ))}
                    <span style={{ fontSize:10, color:K.inkFaint, marginLeft:"auto" }}>{m.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {meals.filter(m=>m.date!==new Date().toISOString().split("T")[0]).length>0 && (
            <div style={card}>
              <div style={{ ...sectionLabel, marginBottom:10 }}>Previous</div>
              {meals.filter(m=>m.date!==new Date().toISOString().split("T")[0]).slice(0,5).map((m,i,arr)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between",
                  padding:"8px 0", borderBottom:i<arr.length-1?`1px solid ${K.border}`:"none" }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:500, color:K.ink }}>{m.name}</div>
                    <div style={{ fontSize:10, color:K.inkFaint }}>{m.date}</div>
                  </div>
                  <span style={{ fontSize:12, fontWeight:600, color:K.inkFaint }}>{m.calories} kcal</span>
                </div>
              ))}
            </div>
          )}

          {meals.length===0&&!analyzing&&(
            <div style={{ textAlign:"center", padding:"40px 0", color:K.inkFaint, fontSize:13 }}>
              Snap your first meal to start tracking
            </div>
          )}
        </>
      )}
      </div>
      )}
    </div>
  );
}



function DomainView({ domain, onUpdate, onBack }) {
  // Work has its own specialized view
  if (domain.id === "work") {
    return <WorkDomainView domain={domain} onUpdate={onUpdate} />;
  }
  // Body has its own specialized view with Terra integration
  if (domain.id === "body") {
    return <BodyDomainView domain={domain} onUpdate={onUpdate} onBack={onBack} />;
  }
  const [tab, setTab] = useState("overview");
  const TABS = [
    { id: "overview",    label: "Overview" },
    { id: "goals",       label: "Goals" },
    { id: "kpis",        label: "KPIs" },
    { id: "activities",  label: "Activities" },
  ];

  return (
    <div>
      {/* Domain header — editorial, matches home page */}
      <div style={{ paddingTop: 8, paddingBottom: 20, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'SF Mono','Fira Code',monospace",
          letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>
          {domain.question}
        </div>

        {/* Title with flanking rules */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${domain.color}66)` }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22, color: domain.color }}>{domain.glyph}</span>
            <span style={{ fontSize: 28, color: C.navy, fontWeight: 700, letterSpacing: "-0.3px" }}>{domain.label}</span>
          </div>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${domain.color}66)` }} />
        </div>

        {/* Identity */}
        <div style={{ fontSize: 13, color: C.inkLight, fontStyle: "italic", lineHeight: 1.7,
          maxWidth: 400, margin: "0 auto 14px" }}>{domain.identity}</div>

        {/* Bottom ornament */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${C.borderMid})` }} />
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: domain.color, opacity: 0.5 }} />
          <div style={{ width: 16, height: 1, background: C.borderMid, opacity: 0.5 }} />
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: domain.color, opacity: 0.5 }} />
          <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${C.borderMid})` }} />
        </div>

        {/* Rating dots */}
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 14 }}>
          {[1,2,3,4,5].map(v => (
            <div key={v} onClick={() => onUpdate({ ...domain, rating: v })} style={{
              width: 10, height: 10, borderRadius: "50%",
              background: v <= domain.rating ? domain.color : C.border,
              cursor: "pointer", transition: "background 0.15s",
            }} />
          ))}
        </div>
      </div>

      {/* Tabs — clean underline style, no boxes */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, background: "transparent", border: "none",
            borderBottom: `2px solid ${tab === t.id ? domain.color : "transparent"}`,
            color: tab === t.id ? domain.color : C.inkFaint,
            padding: "10px 4px", fontSize: 11, cursor: "pointer",
            fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
            transition: "all 0.12s", marginBottom: -1,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ paddingTop: 8 }}>
        {tab === "overview" && domain.pillars && (
          <PillarBar pillars={domain.pillars} goals={domain.goals} kpis={domain.kpis} color={domain.color} />
        )}
        {tab === "overview" && !domain.pillars && (
          <div style={{ paddingTop: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {domain.kpis.map(k => (
                <div key={k.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif", marginBottom: 4 }}>{k.label}</div>
                  <span style={{ fontSize: 22, fontWeight: 700, color: C.ink }}>{k.value}
                    <span style={{ fontSize: 11, fontWeight: 400, color: C.inkLight }}>{k.unit && ` ${k.unit}`}</span>
                  </span>
                  {k.delta && <span style={{ fontSize: 11, color: k.delta.startsWith("+") ? C.green : C.red, marginLeft: 6, fontFamily: "'SF Mono','Fira Code',monospace" }}>{k.delta}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "goals" && (
          <GoalsSection goals={domain.goals} color={domain.color} colorLight={domain.colorLight}
            pillars={domain.pillars} onUpdate={goals => onUpdate({ ...domain, goals })} />
        )}
        {tab === "kpis" && (
          <KPIsSection kpis={domain.kpis} color={domain.color} pillars={domain.pillars}
            onUpdate={kpis => onUpdate({ ...domain, kpis })} />
        )}
        {tab === "activities" && (
          <ActivitiesSection activities={domain.activities} color={domain.color}
            colorLight={domain.colorLight} pillars={domain.pillars}
            onUpdate={activities => onUpdate({ ...domain, activities })} />
        )}
      </div>
    </div>
  );
}

// ── CALENDAR VIEW ─────────────────────────────────────────────────────────────
const SLOT_MINS    = 30;
const SLOT_H       = 28;
const HOUR_START_F = 5.5;   // 5:30am
const HOUR_END_F   = 23;
const TOTAL_SLOTS  = (HOUR_END_F - HOUR_START_F) * 2;  // 35 slots
const COL_W        = 48;
const LABEL_W      = 36;
const GRID_H       = TOTAL_SLOTS * SLOT_H;

function minutesToSlot(totalMins) {
  return (totalMins - HOUR_START_F * 60) / SLOT_MINS;
}
function slotToMins(slot) {
  return HOUR_START_F * 60 + slot * SLOT_MINS;
}
function slotLabel(slot) {
  const mins = slotToMins(slot);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ap = h < 12 ? "a" : "p";
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2,"0")}${ap}`;
}
function timeStrToSlot(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Math.round((h * 60 + m - HOUR_START_F * 60) / SLOT_MINS);
}

const HOUR_MARKS = [];
for (let h = Math.ceil(HOUR_START_F); h < HOUR_END_F; h++) {
  HOUR_MARKS.push({ slot: minutesToSlot(h * 60), h });
}

function CalendarView({ domains }) {
  const [weekOffset, setWeekOffset]           = useState(0);
  const [blocks, setBlocks] = useState([]);

  // Load calendar blocks from DB on mount
  useEffect(() => {
    supa.from("calendar_blocks").then(db => db.select("*").then(data => {
      if (Array.isArray(data) && data.length) {
        setBlocks(data.map(b => ({
          id: b.id, text: b.text, dayIdx: b.day_idx,
          slot: b.slot, slots: b.slots,
          domainId: b.domain_id, domainLabel: b.domain_label,
          domainColor: b.domain_color, weekKey: b.week_key,
          activityId: b.activity_id,
        })));
      }
    }));
  }, []);

  const saveBlocks = useCallback(async (newBlocks) => {
    setBlocks(newBlocks);
    try {
      const db = await supa.from("calendar_blocks");
      if (newBlocks.length) {
        await db.upsert(newBlocks.map(b => ({
          id: b.id, text: b.text, day_idx: b.dayIdx,
          slot: b.slot, slots: b.slots,
          domain_id: b.domainId || null, domain_label: b.domainLabel || null,
          domain_color: b.domainColor || null, week_key: b.weekKey,
          activity_id: b.activityId || null,
        })));
      }
      // Delete any blocks in DB not in new list
      const allInDb = await db.select("id");
      if (Array.isArray(allInDb)) {
        const currentIds = new Set(newBlocks.map(b => b.id));
        const toDelete = allInDb.filter(r => !currentIds.has(r.id)).map(r => r.id);
        if (toDelete.length) await db.deleteIn("id", toDelete);
      }
    } catch(e) { console.error("Block save failed:", e); }
  }, []);
  const [drawerDomain, setDrawerDomain]       = useState(null);
  const [pickingActivity, setPickingActivity] = useState(null);
  const [movingBlock, setMovingBlock]         = useState(null);
  const [resizing, setResizing]               = useState(null);
  const [dragging, setDragging]               = useState(null);
  const [scheduling, setScheduling]           = useState(false); // auto-scheduling todos
  const [importing, setImporting]             = useState(false); // screenshot import
  const [importMsg, setImportMsg]             = useState("");
  const fileInputRef = useRef(null);
  const gridRef = useRef(null);

  // Get grid-relative Y and column from a pointer event
  const gridCoords = (e) => {
    const grid = gridRef.current;
    if (!grid) return { relY: 0, dayIdx: 0 };
    const rect = grid.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const relY = clientY - rect.top + grid.scrollTop;
    const relX = clientX - rect.left + grid.scrollLeft - LABEL_W;
    const dayIdx = Math.max(0, Math.min(6, Math.floor(relX / COL_W)));
    return { relY, dayIdx };
  };

  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7);
  const weekDays = DAYS.map((label, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return { label, date: d };
  });
  const isToday = (d) => d.toDateString() === today.toDateString();
  const weekKey = monday.toDateString();
  const weekBlocks = blocks.filter(b => b.weekKey === weekKey);

  const occupiedSlots = (dayIdx, excludeId = null) => {
    const set = new Set();
    weekBlocks.filter(b => b.dayIdx === dayIdx && b.id !== excludeId)
      .forEach(b => { for (let s = b.slot; s < b.slot + b.slots; s++) set.add(s); });
    return set;
  };

  const firstFreeSlot = (dayIdx, startSlot, numSlots, excludeId = null) => {
    const occ = occupiedSlots(dayIdx, excludeId);
    let s = Math.max(0, Math.round(startSlot));
    while (s + numSlots <= TOTAL_SLOTS) {
      let free = true;
      for (let i = s; i < s + numSlots; i++) { if (occ.has(i)) { free = false; break; } }
      if (free) return s;
      s++;
    }
    return Math.max(0, TOTAL_SLOTS - numSlots);
  };

  const pushBlocksDown = (dayIdx, fromSlot, numSlots, excludeId, blist) => {
    const affected = blist
      .filter(b => b.dayIdx === dayIdx && b.id !== excludeId && b.slot + b.slots > fromSlot)
      .sort((a, b) => a.slot - b.slot);
    let updated = [...blist];
    let cursor = fromSlot + numSlots;
    for (const b of affected) {
      if (b.slot < cursor) {
        const ns = Math.min(TOTAL_SLOTS - b.slots, cursor);
        updated = updated.map(x => x.id === b.id ? { ...x, slot: ns } : x);
        cursor = ns + b.slots;
      }
    }
    return updated;
  };

  const placeOnSlot = (dayIdx, rawSlot) => {
    if (movingBlock) {
      const b = weekBlocks.find(x => x.id === movingBlock);
      if (!b) { setMovingBlock(null); return; }
      const ts = Math.max(0, Math.min(TOTAL_SLOTS - b.slots, Math.round(rawSlot)));
      let updated = blocks.map(x => x.id === movingBlock ? { ...x, dayIdx, slot: ts } : x);
      updated = pushBlocksDown(dayIdx, ts, b.slots, movingBlock, updated);
      saveBlocks(updated); setMovingBlock(null); return;
    }
    if (pickingActivity) {
      const { activity } = pickingActivity;
      const slots = Math.max(1, Math.round((activity.duration || 30) / SLOT_MINS));
      const ts = Math.max(0, Math.min(TOTAL_SLOTS - slots, Math.round(rawSlot)));
      const fs = firstFreeSlot(dayIdx, ts, slots);
      const nb = { id: `b${Date.now()}`, text: activity.text, dayIdx,
        slot: fs, slots, domainId: activity.domainId,
        domainLabel: activity.domainLabel, domainColor: activity.domainColor,
        weekKey, activityId: activity.id };
      let updated = [...blocks, nb];
      updated = pushBlocksDown(dayIdx, fs, slots, nb.id, updated);
      // Keep pickingActivity alive — user can keep placing on other days
      // Only clear once they cancel or pick a different activity
      saveBlocks(updated); return;
    }
  };

  const isPlaced = (actId, dayIdx) =>
    weekBlocks.some(b => b.activityId === actId && b.dayIdx === dayIdx);

  // ── Auto-schedule todos ───────────────────────────────────────────────────
  const WORK_START = minutesToSlot(9 * 60);   // 9am
  const WORK_END   = minutesToSlot(19 * 60);  // 7pm
  const DUR_TO_SLOTS = { "15min":1,"30min":1,"1hr":2,"2hr":4,"half-day":8,"full-day":16 };
  const workDomain = domains.find(d => d.id === "work");

  const autoScheduleTodos = () => {
    setScheduling(true);
    const thisWeekTodos = (workDomain?.todos || [])
      .filter(t => t.horizon === "this week" && !t.done);
    if (!thisWeekTodos.length) { setScheduling(false); return; }

    // Remove previously scheduled todos before rescheduling
    const baseBlocks = blocks.filter(b => b.weekKey !== weekKey || !b.id.startsWith("sched-"));
    const existingThisWeek = blocks.filter(b => b.weekKey === weekKey && !b.id.startsWith("sched-"));

    const newBlocks = [];
    // Track occupied slots per day including existing non-scheduled blocks
    const getOccupied = (dayIdx) => {
      const set = new Set();
      [...existingThisWeek, ...newBlocks].filter(b => b.dayIdx === dayIdx)
        .forEach(b => { for (let s = b.slot; s < b.slot + b.slots; s++) set.add(s); });
      return set;
    };

    const findFreeSlot = (dayIdx, numSlots) => {
      const occ = getOccupied(dayIdx);
      let s = WORK_START;
      while (s + numSlots <= WORK_END) {
        let free = true;
        for (let i = s; i < s + numSlots; i++) { if (occ.has(i)) { free = false; break; } }
        if (free) return s;
        s++;
      }
      return null;
    };

    thisWeekTodos.forEach((todo, i) => {
      const slots = DUR_TO_SLOTS[todo.duration] || 1;
      // Find the day with earliest free slot
      let bestDay = null, bestSlot = null;
      for (let d = 0; d < 5; d++) {
        const fs = findFreeSlot(d, slots);
        if (fs !== null && (bestSlot === null || fs < bestSlot)) {
          bestDay = d; bestSlot = fs;
        }
      }
      if (bestDay === null) return; // no room anywhere

      newBlocks.push({
        id: `sched-${todo.id}-${Date.now()}-${i}`,
        text: todo.text,
        dayIdx: bestDay, slot: bestSlot, slots,
        domainId: "work", domainLabel: "Work",
        domainColor: workDomain?.color || "#1a6080",
        weekKey, activityId: null,
      });
    });

    const updated = [...baseBlocks, ...existingThisWeek, ...newBlocks];
    saveBlocks(updated);
    setScheduling(false);
  };

  // ── Screenshot import ─────────────────────────────────────────────────────
  const importFromScreenshot = async (file) => {
    setImporting(true);
    const isPDF = file.type === "application/pdf";
    setImportMsg(`Reading your calendar ${isPDF ? "PDF" : "screenshot"}…`);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });

      const contentBlock = isPDF ? {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 }
      } : {
        type: "image",
        source: { type: "base64", media_type: file.type || "image/png", data: base64 }
      };

      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              contentBlock,
              {
                type: "text",
                text: `This is a ${isPDF ? "PDF print" : "screenshot"} of a calendar (likely Outlook or similar). Extract all visible meetings/events.

For each meeting return JSON with this exact structure:
{
  "meetings": [
    {
      "title": "meeting name",
      "day": "Mon|Tue|Wed|Thu|Fri|Sat|Sun",
      "startTime": "HH:MM",
      "endTime": "HH:MM"
    }
  ]
}

Only return the JSON, nothing else. Use 24-hour time format. If you cannot determine exact times, estimate from visual position. Only include meetings visible in the file.`
              }
            ]
          }]
        })
      });

      const data = await response.json();
      const text = data.content?.find(b => b.type === "text")?.text || "{}";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      const meetings = parsed.meetings || [];

      if (!meetings.length) {
        setImportMsg("No meetings found — try a clearer file.");
        setImporting(false);
        return;
      }

      const newBlocks = meetings.map((m, i) => {
        const dayIdx = DAYS.indexOf(m.day);
        if (dayIdx === -1) return null;
        const [sh, sm] = m.startTime.split(":").map(Number);
        const [eh, em] = m.endTime.split(":").map(Number);
        const startSlot = Math.round(minutesToSlot(sh * 60 + sm));
        const endSlot   = Math.round(minutesToSlot(eh * 60 + em));
        const slots = Math.max(1, endSlot - startSlot);
        return {
          id: `import-${Date.now()}-${i}`,
          text: m.title,
          dayIdx, slot: startSlot, slots,
          domainId: null, domainLabel: "Meeting",
          domainColor: "#6b7280",
          weekKey, activityId: null,
        };
      }).filter(Boolean);

      const updated = [
        ...blocks.filter(b => b.weekKey !== weekKey || !b.id.startsWith("import-")),
        ...weekBlocks.filter(b => !b.id.startsWith("import-")),
        ...newBlocks
      ];
      saveBlocks(updated);
      setImportMsg(`Imported ${newBlocks.length} meeting${newBlocks.length !== 1 ? "s" : ""}. Tap "Schedule todos around meetings" to fill the gaps.`);
    } catch(e) {
      console.error("Import failed:", e);
      setImportMsg("Import failed — try a clearer file.");
    }
    setImporting(false);
  };

  // ── Drag & resize pointer handlers ────────────────────────────────────────
  const onGridPointerMove = (e) => {
    const { relY, dayIdx } = gridCoords(e);
    const currentSlot = Math.round(relY / SLOT_H);

    if (resizing) {
      setBlocks(prev => prev.map(b => {
        if (b.id !== resizing.id) return b;
        if (resizing.edge === "bottom") {
          const newSlots = Math.max(1, Math.min(TOTAL_SLOTS - b.slot, currentSlot - b.slot));
          return { ...b, slots: newSlots };
        } else {
          const newSlot  = Math.max(0, Math.min(resizing.origSlot + resizing.origSlots - 1, currentSlot));
          const newSlots = Math.max(1, resizing.origSlot + resizing.origSlots - newSlot);
          return { ...b, slot: newSlot, slots: newSlots };
        }
      }));
      return;
    }

    if (dragging) {
      const newSlot   = Math.max(0, Math.min(TOTAL_SLOTS - dragging.origSlots, currentSlot - dragging.grabOffsetSlots));
      const newDayIdx = dayIdx;
      setBlocks(prev => prev.map(b =>
        b.id === dragging.id ? { ...b, slot: newSlot, dayIdx: newDayIdx } : b
      ));
    }
  };

  const onGridPointerUp = (e) => {
    // Commit to DB on release
    if (resizing || dragging) {
      saveBlocks(blocks);
    }
    if (resizing) { setResizing(null); return; }
    if (dragging) {
      // snap to nearest slot already done in move; just clear
      setDragging(null);
      setMovingBlock(null);
      return;
    }
  };

  const startResize = (e, blockId, edge) => {
    e.stopPropagation();
    e.preventDefault();
    const b = weekBlocks.find(x => x.id === blockId);
    if (!b) return;
    setResizing({ id: blockId, edge, origSlot: b.slot, origSlots: b.slots });
    setDragging(null);
    setMovingBlock(null);
  };

  const startDrag = (e, blockId) => {
    if (isPlacing) return;
    e.stopPropagation();
    e.preventDefault();
    const b = weekBlocks.find(x => x.id === blockId);
    if (!b) return;
    const { relY } = gridCoords(e);
    const grabSlot = Math.round(relY / SLOT_H);
    const grabOffsetSlots = grabSlot - b.slot;
    setDragging({ id: blockId, origSlot: b.slot, origDayIdx: b.dayIdx,
      origSlots: b.slots, grabOffsetSlots });
    setMovingBlock(blockId);
    setResizing(null);
  };

  const isPlacing = !!pickingActivity;
  const weekLabel = `${monday.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${weekDays[6].date.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`;

  return (
    <div>
      {/* Header */}
      <div style={{ paddingTop: 8, paddingBottom: 10, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'SF Mono','Fira Code',monospace",
          letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>your whole week</div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${C.borderMid})` }} />
          <span style={{ fontSize: 24, color: C.navy, fontWeight: 700, letterSpacing: "-0.3px" }}>Be Whole</span>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${C.borderMid})` }} />
        </div>
        <div style={{ fontSize: 12, color: C.inkLight, fontStyle: "italic" }}>Every intention placed in time.</div>
      </div>

      {/* Week nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <button onClick={() => setWeekOffset(w => w-1)} style={{ background:"transparent",border:"none",color:C.caqi,cursor:"pointer",fontSize:20,padding:"0 4px" }}>‹</button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:11, color:C.inkMid, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>{weekLabel}</div>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ background:"transparent",border:"none",color:C.caqi,cursor:"pointer",fontSize:10,fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",fontStyle:"italic",padding:0,marginTop:1 }}>this week</button>}
        </div>
        <button onClick={() => setWeekOffset(w => w+1)} style={{ background:"transparent",border:"none",color:C.caqi,cursor:"pointer",fontSize:20,padding:"0 4px" }}>›</button>
      </div>

      {/* Placing banner */}
      {isPlacing && (
        <div style={{ background: C.caqiLight, border:`1px solid ${C.caqi}44`, borderRadius:6,
          padding:"7px 12px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:C.caqi, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>
            {`"${pickingActivity?.activity?.text}" — tap any slot to place · tap ✕ to stop`}
          </span>
          <button onClick={() => { setPickingActivity(null); setMovingBlock(null); }}
            style={{ background:"transparent",border:"none",color:C.caqi,cursor:"pointer",fontSize:14,padding:0 }}>✕</button>
        </div>
      )}

      {/* Smart scheduling strip */}
      <div style={{ display:"flex", gap:8, marginBottom:10, flexWrap:"wrap" }}>
        {/* Schedule todos button */}
        <button onClick={autoScheduleTodos} disabled={scheduling}
          style={{ flex:1, background: scheduling ? C.border : C.navy,
            border:"none", borderRadius:6, color:"#fff", fontSize:12,
            padding:"8px 12px", cursor: scheduling ? "default" : "pointer",
            fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic", opacity: scheduling ? 0.6 : 1 }}>
          {scheduling ? "Scheduling…" : "📋 Schedule todos around meetings"}
        </button>

        {/* Screenshot import button */}
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}
          style={{ flex:1, background: importing ? C.border : "transparent",
            border:`1.5px solid ${C.caqi}`, borderRadius:6,
            color: importing ? C.inkFaint : C.caqi, fontSize:12,
            padding:"8px 12px", cursor: importing ? "default" : "pointer",
            fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>
          {importing ? "Reading…" : "📷 Import from screenshot or PDF"}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,application/pdf"
          style={{ display:"none" }}
          onChange={e => { if (e.target.files?.[0]) importFromScreenshot(e.target.files[0]); }} />
      </div>

      {/* Import status message */}
      {importMsg && (
        <div style={{ background: C.caqiLight, border:`1px solid ${C.caqi}33`,
          borderRadius:6, padding:"8px 12px", marginBottom:8,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:12, color:C.caqi, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic" }}>{importMsg}</span>
          <button onClick={() => setImportMsg("")}
            style={{ background:"transparent", border:"none", color:C.caqi, cursor:"pointer", fontSize:14, padding:0 }}>✕</button>
        </div>
      )}

      {/* Calendar grid */}
      <div ref={gridRef}
        onPointerMove={onGridPointerMove}
        onPointerUp={onGridPointerUp}
        onTouchMove={onGridPointerMove}
        onTouchEnd={onGridPointerUp}
        style={{ overflowX:"auto", overflowY:"auto", maxHeight:400, WebkitOverflowScrolling:"touch",
          border:`1px solid ${C.border}`, borderRadius:6, touchAction: (resizing||dragging) ? "none" : "auto" }}>
        <div style={{ minWidth: LABEL_W + COL_W * 7, position:"relative" }}>

          {/* Sticky day headers */}
          <div style={{ display:"flex", marginLeft:LABEL_W, position:"sticky", top:0,
            background:C.bg, zIndex:20, borderBottom:`1px solid ${C.border}` }}>
            {weekDays.map(({ label, date }, i) => (
              <div key={i} style={{ width:COL_W, flexShrink:0, textAlign:"center", padding:"4px 0" }}>
                <div style={{ fontSize:8, color:isToday(date)?C.caqi:C.inkFaint,
                  fontFamily:"'SF Mono','Fira Code',monospace" }}>{label}</div>
                <div style={{ fontSize:12, fontWeight:isToday(date)?700:400,
                  color:isToday(date)?C.caqi:C.inkMid, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif" }}>{date.getDate()}</div>
              </div>
            ))}
          </div>

          {/* Grid body */}
          <div style={{ position:"relative", height:GRID_H }}>

            {/* Hour rules + labels */}
            {HOUR_MARKS.map(({ slot, h }) => (
              <div key={h} style={{ position:"absolute", top:slot*SLOT_H, left:0, right:0,
                display:"flex", alignItems:"flex-start", pointerEvents:"none", zIndex:1 }}>
                <div style={{ width:LABEL_W, flexShrink:0, paddingRight:5, textAlign:"right",
                  fontSize:8, color:C.inkFaint, fontFamily:"'SF Mono','Fira Code',monospace",
                  paddingTop:1, lineHeight:1 }}>{slotLabel(slot)}</div>
                <div style={{ flex:1, borderTop:`1px solid ${C.border}` }} />
              </div>
            ))}

            {/* Half-hour lines */}
            {HOUR_MARKS.map(({ slot, h }) => (
              <div key={`hh${h}`} style={{ position:"absolute", top:(slot+1)*SLOT_H,
                left:LABEL_W, right:0, borderTop:`1px solid ${C.border}`,
                opacity:0.25, pointerEvents:"none", zIndex:1 }} />
            ))}

            {/* Column separators */}
            {weekDays.map((_, i) => i > 0 && (
              <div key={i} style={{ position:"absolute", top:0, bottom:0,
                left: LABEL_W + i*COL_W, width:1,
                background: C.border, zIndex:1, pointerEvents:"none" }} />
            ))}

            {/* Clickable cells */}
            {weekDays.map((_, dayIdx) =>
              Array.from({ length: Math.round(TOTAL_SLOTS) }).map((_, slotIdx) => (
                <div key={`${dayIdx}-${slotIdx}`}
                  onClick={() => isPlacing && placeOnSlot(dayIdx, slotIdx)}
                  style={{ position:"absolute",
                    top: slotIdx*SLOT_H, left: LABEL_W + dayIdx*COL_W,
                    width: COL_W, height: SLOT_H,
                    cursor: isPlacing ? "crosshair" : "default",
                    background: isPlacing ? "rgba(78,158,142,0.03)" : "transparent",
                    zIndex: 2 }} />
              ))
            )}

            {/* Current time indicator */}
            {weekOffset === 0 && (() => {
              const now = new Date();
              const frac = minutesToSlot(now.getHours()*60 + now.getMinutes());
              if (frac < 0 || frac > TOTAL_SLOTS) return null;
              const dayIdx = (now.getDay()+6) % 7;
              return (
                <div style={{ position:"absolute", top: frac*SLOT_H, left: LABEL_W + dayIdx*COL_W,
                  width: COL_W, height:2, background:C.red, zIndex:12, pointerEvents:"none" }}>
                  <div style={{ position:"absolute", left:-3, top:-3, width:7, height:7,
                    borderRadius:"50%", background:C.red }} />
                </div>
              );
            })()}

            {/* Blocks */}
            {weekBlocks.map(b => {
              const top      = b.slot * SLOT_H;
              const height   = b.slots * SLOT_H - 1;
              const isDragging = dragging?.id === b.id;
              const isResizing = resizing?.id === b.id;
              const isActive   = isDragging || isResizing;
              const HANDLE_H   = 8;

              return (
                <div key={b.id}
                  onClick={e => {
                    e.stopPropagation();
                    // If in placing mode, treat tap on existing block as placing
                    if (isPlacing) placeOnSlot(b.dayIdx, b.slot);
                  }}
                  onPointerDown={e => !isPlacing && startDrag(e, b.id)}
                  onTouchStart={e => !isPlacing && startDrag(e, b.id)}
                  style={{ position:"absolute",
                    top, left: LABEL_W + b.dayIdx*COL_W + 1,
                    width: COL_W-2, height,
                    background: b.domainColor + (isActive ? "38" : "1c"),
                    border: `1px solid ${b.domainColor}${isActive ? "cc" : "44"}`,
                    borderLeft: `3px solid ${b.domainColor}`,
                    borderRadius:3,
                    cursor: isPlacing ? "crosshair" : isDragging ? "grabbing" : "grab",
                    overflow:"visible", zIndex: isActive ? 15 : 5,
                    boxShadow: isActive ? `0 4px 14px ${b.domainColor}55` : "none",
                    userSelect:"none", touchAction:"none",
                    transition: isDragging ? "none" : "box-shadow 0.12s, background 0.12s" }}>

                  {/* Top resize handle */}
                  {!isPlacing && (
                    <div
                      onPointerDown={e => startResize(e, b.id, "top")}
                      onTouchStart={e => startResize(e, b.id, "top")}
                      style={{ position:"absolute", top:-HANDLE_H/2, left:0,
                        width:"100%", height:HANDLE_H, cursor:"ns-resize", zIndex:25,
                        display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <div style={{ width:16, height:3, borderRadius:2,
                        background: b.domainColor,
                        opacity: isResizing && resizing.edge==="top" ? 1 : 0.4 }} />
                    </div>
                  )}

                  {/* Label */}
                  <div style={{ fontSize:8, color:b.domainColor,
                    fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
                    padding:"4px 3px 2px", lineHeight:1.25,
                    overflow:"hidden", height:"calc(100% - 4px)",
                    pointerEvents:"none" }}>
                    {b.text}
                    {height > SLOT_H * 2 && (
                      <div style={{ fontSize:7, opacity:0.7, marginTop:1 }}>
                        {slotLabel(b.slot)} – {slotLabel(b.slot + b.slots)}
                      </div>
                    )}
                  </div>

                  {/* Delete */}
                  {!isPlacing && !dragging && !resizing && (
                    <button onClick={e => { e.stopPropagation(); saveBlocks(blocks.filter(x => x.id !== b.id)); }}
                      style={{ position:"absolute", top:1, right:1,
                        background:"rgba(255,255,255,0.85)", border:"none",
                        borderRadius:2, color:C.red, fontSize:7,
                        cursor:"pointer", padding:"1px 2px", lineHeight:1, opacity:0.7 }}>×</button>
                  )}

                  {/* Bottom resize handle */}
                  {!isPlacing && (
                    <div
                      onPointerDown={e => startResize(e, b.id, "bottom")}
                      onTouchStart={e => startResize(e, b.id, "bottom")}
                      style={{ position:"absolute", bottom:-HANDLE_H/2, left:0,
                        width:"100%", height:HANDLE_H, cursor:"ns-resize", zIndex:25,
                        display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <div style={{ width:16, height:3, borderRadius:2,
                        background: b.domainColor,
                        opacity: isResizing && resizing.edge==="bottom" ? 1 : 0.4 }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Domain strip */}
      <div style={{ marginTop:14, borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
        <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
          fontStyle:"italic", textAlign:"center", marginBottom:8 }}>
          tap a dimension to schedule
        </div>
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", justifyContent:"center", marginBottom:6 }}>
          {domains.map(d => (
            <button key={d.id}
              onClick={() => setDrawerDomain(drawerDomain===d.id ? null : d.id)}
              style={{ background: drawerDomain===d.id ? d.color : "transparent",
                color: drawerDomain===d.id ? "#fff" : d.color,
                border:`1.5px solid ${d.color}`, borderRadius:20,
                padding:"3px 11px", fontSize:11, cursor:"pointer",
                fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
                transition:"all 0.12s" }}>{d.label}</button>
          ))}
        </div>

        {/* Open drawer */}
        {drawerDomain && (() => {
          const dom = domains.find(d => d.id === drawerDomain);
          if (!dom) return null;
          const acts = (dom.activities||[]).filter(a => a.days.length > 0);
          return (
            <div style={{ background:dom.colorLight, border:`1px solid ${dom.color}33`,
              borderRadius:8, padding:12 }}>
              <div style={{ fontSize:11, color:dom.color, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                fontStyle:"italic", marginBottom:8 }}>{dom.label}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                {acts.map(a => {
                  const isPicking = pickingActivity?.activity?.id === a.id;
                  return (
                    <div key={a.id} style={{ display:"flex", alignItems:"center", gap:8,
                      padding:"7px 10px",
                      background: isPicking ? dom.color+"22" : C.surface,
                      border:`1px solid ${isPicking ? dom.color : C.border}`,
                      borderRadius:5 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:12, color:C.ink, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
                          fontStyle:"italic" }}>{a.text}</div>
                        <div style={{ display:"flex", gap:3, marginTop:3, flexWrap:"wrap" }}>
                          {weekDays.map(({ label }, i) => {
                            const placed = isPlaced(a.id, i);
                            return (
                              <span key={label} style={{ fontSize:7,
                                color: placed ? dom.color : C.inkFaint,
                                background: placed ? dom.color+"22" : "transparent",
                                border:`1px solid ${placed ? dom.color+"55" : C.border}`,
                                borderRadius:2, padding:"1px 3px",
                                fontFamily:"'SF Mono','Fira Code',monospace" }}>{label}</span>
                            );
                          })}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (isPicking) { setPickingActivity(null); }
                          else {
                            setPickingActivity({ activity: { ...a,
                              domainId:dom.id, domainLabel:dom.label, domainColor:dom.color }});
                            setMovingBlock(null);
                          }
                        }}
                        style={{ background: isPicking ? dom.color : "transparent",
                          color: isPicking ? "#fff" : dom.color,
                          border:`1.5px solid ${dom.color}`, borderRadius:4,
                          padding:"3px 10px", fontSize:11, cursor:"pointer",
                          fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif", fontStyle:"italic",
                          flexShrink:0, transition:"all 0.12s" }}>
                        {isPicking ? "cancel" : "place"}
                      </button>
                    </div>
                  );
                })}
                {acts.length === 0 && (
                  <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic",
                    textAlign:"center", padding:"6px 0" }}>No activities for this domain yet.</div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  useEffect(() => {
    document.documentElement.setAttribute("dir", "ltr");
    document.documentElement.setAttribute("lang", "en");
    document.body.setAttribute("dir", "ltr");
    document.body.style.direction = "ltr";
    document.body.style.unicodeBidi = "plaintext";
    const style = document.createElement("style");
    style.innerHTML = `
      [contenteditable][data-placeholder]:empty:before { content: attr(data-placeholder); color: #b8c4cc; pointer-events: none; font-style: italic; }
      [contenteditable] ul, [contenteditable] ol { margin: 2px 0; padding-left: 20px; }
      [contenteditable] li { margin: 0; padding: 0; line-height: 1.6; }
      [contenteditable] p { margin: 0; padding: 0; }
      [contenteditable] div { margin: 0; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    `;
    document.head.appendChild(style);
  }, []);

  const [domains, setDomains] = useState(DOMAINS);
  const [selected, setSelected] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load from Supabase on mount
  useEffect(() => {
    loadFromDb().then(merger => {
      if (merger) setDomains(DOMAINS.map(merger));
      setLoading(false);
    });
  }, []);

  // Save to Supabase whenever a domain changes
  const updateDomain = useCallback((updated) => {
    setDomains(prev => prev.map(d => d.id === updated.id ? updated : d));
    saveDomainToDb(updated);
  }, []);

  const activeDomain = domains.find(d => d.id === selected);
  const now = new Date();
  const hour = now.getHours();
  const timeWord = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:"100vh", background:C.bg, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
      flexDirection:"column", gap:12 }}>
      <div style={{ width:36, height:36, borderRadius:"50%", background:C.caqi,
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:16, color:C.navy, fontWeight:700, fontStyle:"italic" }}>f</span>
      </div>
      <div style={{ fontSize:13, color:C.inkFaint, fontStyle:"italic" }}>Loading your life…</div>
    </div>
  );

  return (
    <div dir="ltr" style={{ background: C.bg, minHeight: "100vh", fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
      color: C.ink, maxWidth: 560, margin: "0 auto" }}>

      {(selected || showCalendar) && (
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => { setSelected(null); setShowCalendar(false); }} style={{ background: "transparent", border: "none",
            color: C.caqi, cursor: "pointer", fontSize: 13, fontFamily: "-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
            fontWeight: 500, padding: 0, display: "flex", alignItems: "center", gap: 4 }}>← back</button>
          <span style={{ fontSize: 10, color: C.inkFaint, fontFamily: "'SF Mono','Fira Code',monospace",
            letterSpacing: "0.08em" }}>{dateStr}</span>
        </div>
      )}

      <div style={{ padding: (selected || showCalendar) ? "0 20px 60px" : "0 20px 40px" }}>
        {!selected && !showCalendar ? (
          <div>
            <div style={{ paddingTop: 48, paddingBottom: 8, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'SF Mono','Fira Code',monospace",
                letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 24 }}>{dateStr}</div>

              <div style={{ fontSize: 36, color: C.navy, fontWeight: 700, lineHeight: 1.1,
                letterSpacing: "-0.8px", marginBottom: 8 }}>Good {timeWord}.</div>

              <div style={{ fontSize: 15, color: C.inkLight, fontWeight: 400,
                lineHeight: 1.5, marginBottom: 8 }}>Seven dimensions of a life well lived.</div>

              <div style={{ width: 32, height: 2, background: C.caqi, borderRadius: 2,
                margin: "12px auto 12px" }} />

              <div style={{ fontSize: 13, color: C.inkFaint, lineHeight: 1.6,
                maxWidth: 300, margin: "0 auto", marginTop: 8 }}>
                Where you are full, you're thriving.<br />
                Where you're thin, you know what to do.
              </div>
            </div>

            <Heptagon domains={domains} onSelect={setSelected} onCalendar={() => setShowCalendar(true)} />

            <div style={{ textAlign: "center", marginTop: 4 }}>
              <div style={{ fontSize: 11, color: C.inkFaint, fontStyle: "italic" }}>tap a dimension · tap center for your week</div>
            </div>
          </div>
        ) : showCalendar ? (
          <CalendarView domains={domains} onBack={() => setShowCalendar(false)} />
        ) : (
          <DomainView domain={activeDomain} onUpdate={updateDomain} onBack={() => setSelected(null)} />
        )}
      </div>
    </div>
  );
}

