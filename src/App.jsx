import React, { useState, useRef, useEffect, useCallback } from "react";

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
    await (await supa.from("domains")).upsert({ id: domain.id, rating: domain.rating });

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
      if (dbDomain) merged.rating = dbDomain.rating;
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
  bg:        "#f7f5f0",
  surface:   "#ffffff",
  border:    "#e4dfd8",
  borderMid: "#cec9c0",
  navy:      "#1a2b3c",
  caqi:      "#4e9e8e",
  caqiLight: "#e6f4f2",
  ink:       "#1a2b3c",
  inkMid:    "#3d4f5f",
  inkLight:  "#7a8a96",
  inkFaint:  "#b8c4cc",
  green:     "#3d8a5a",
  red:       "#b84040",
  gold:      "#b8842a",
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
    color: "#4e9e8e", colorLight: "#e6f4f2",
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
    color: "#3d6ea8", colorLight: "#e8eff8",
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
    color: "#7a5aaa", colorLight: "#f0ebfa",
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
    color: "#b84a4a", colorLight: "#faeaea",
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
              fontSize="11.5" fontFamily="Georgia, serif" fontStyle="italic"
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
        fontFamily="Georgia, serif" fontStyle="italic" letterSpacing="2.5"
        style={{ pointerEvents: "none", transition: "fill 0.18s" }}>be</text>
      <text x={cx} y={cy + 9} textAnchor="middle" dominantBaseline="middle"
        fontSize="10" fill={centerHov ? C.navy : "rgba(255,255,255,0.5)"}
        fontFamily="Georgia, serif" fontStyle="italic" letterSpacing="2.5"
        style={{ pointerEvents: "none", transition: "fill 0.18s" }}>whole</text>
    </svg>
  );
}

// ── SHARED MICRO COMPONENTS ───────────────────────────────────────────────────

// Ruled section heading — matches front page editorial feel
function SectionRule({ label, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px" }}>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${C.borderMid})` }} />
      <span style={{ fontSize: 10, color: color || C.inkLight, fontFamily: "Georgia, serif",
        fontStyle: "italic", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${C.borderMid})` }} />
    </div>
  );
}

function AddButton({ onClick, label }) {
  return (
    <button onClick={onClick} style={{
      width: "100%", background: "transparent",
      border: `1px dashed ${C.borderMid}`, borderRadius: 6,
      padding: "10px", color: C.inkFaint, fontSize: 12,
      cursor: "pointer", fontFamily: "Georgia, serif",
      fontStyle: "italic", marginTop: 8,
    }}>+ {label}</button>
  );
}

function GhostInput({ value, onChange, placeholder, onKeyDown }) {
  return (
    <input dir="ltr" value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder}
      style={{ flex: 1, background: "transparent", border: "none",
        borderBottom: `1px solid ${C.border}`, color: C.ink,
        fontSize: 14, fontFamily: "Georgia, serif", padding: "4px 0",
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
                  <span style={{ fontSize: 13, color: C.ink, fontFamily: "Georgia, serif", fontStyle: "italic" }}>{p.label}</span>
                  <span style={{ fontSize: 11, color: C.inkFaint }}>{p.desc}</span>
                </div>
                {avgProgress !== null && (
                  <span style={{ fontSize: 10, color: color, fontFamily: "'Courier New', monospace", fontWeight: 700 }}>{avgProgress}%</span>
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
                    <span key={k.id} style={{ fontSize: 11, color: C.inkLight, fontFamily: "'Courier New', monospace" }}>
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
              <span style={{ fontSize: 10, color: color, fontFamily: "'Courier New', monospace", fontWeight: 700, flexShrink: 0 }}>{g.quarter}</span>
              <span style={{ fontSize: 14, color: C.ink, fontFamily: "Georgia, serif", lineHeight: 1.3 }}>{g.text}</span>
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
            <span style={{ fontSize: 10, color: color, fontFamily: "'Courier New', monospace", fontWeight: 700, width: 30, textAlign: "right" }}>{g.progress}%</span>
          </div>
        </div>

        {isOpen && (
          <div style={{ background: colorLight, borderRadius: "0 0 6px 6px", padding: "14px 16px", marginTop: -1 }}>
            {g.krs.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {g.krs.map((kr, i) => (
                  <div key={i} style={{ fontSize: 13, color: C.inkMid, fontFamily: "Georgia, serif",
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
                fontFamily: "'Courier New', monospace" }}>{g.progress}%</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={g.quarter}
                onChange={e => onUpdate(goals.map(x => x.id === g.id ? { ...x, quarter: e.target.value } : x))}
                style={{ background: "transparent", border: `1px solid ${color}44`, borderRadius: 4,
                  color: color, fontSize: 11, fontFamily: "'Courier New', monospace", padding: "3px 8px" }}>
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
            <div style={{ fontSize: 11, color: color, fontFamily: "Georgia, serif", fontStyle: "italic",
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
                fontSize: 12, fontFamily: "'Courier New', monospace", padding: "5px 8px" }}>
              {QUARTERS.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
            {pillars && (
              <select value={newGoal.pillar || ""} onChange={e => setNewGoal({ ...newGoal, pillar: e.target.value })}
                style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkMid,
                  fontSize: 12, fontFamily: "'Courier New', monospace", padding: "5px 8px" }}>
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
      <span style={{ fontSize: 12, color: C.inkLight, fontFamily: "Georgia, serif", fontStyle: "italic", flex: 1 }}>{k.label}</span>
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
            fontFamily: "'Courier New', monospace", marginLeft: 4 }}>{k.delta}</span>
        )}
      </div>
    </div>
  );

  return (
    <div>
      {groups.map(({ pillar, kpis: pk }) => (
        <div key={pillar?.id || "all"}>
          {pillar && (
            <div style={{ fontSize: 11, color: color, fontFamily: "Georgia, serif", fontStyle: "italic",
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
                  color: C.ink, fontSize: 13, fontFamily: "Georgia, serif", padding: "6px 10px", outline: "none",
                  fontStyle: "italic" }} />
            ))}
          </div>
          {pillars && (
            <select value={newKPI.pillar || ""} onChange={e => setNewKPI({ ...newKPI, pillar: e.target.value })}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkMid,
                fontSize: 12, fontFamily: "'Courier New', monospace", padding: "5px 8px", marginBottom: 10 }}>
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
        <span style={{ fontSize: 13, color: C.inkMid, fontFamily: "Georgia, serif", fontStyle: "italic" }}>{a.text}</span>
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
                fontFamily: "'Courier New', monospace", marginBottom: 3, letterSpacing: "0.04em" }}>{d}</div>
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
            <div style={{ fontSize: 11, color: color, fontFamily: "Georgia, serif", fontStyle: "italic",
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
                    fontFamily: "'Courier New', monospace", marginBottom: 3 }}>{d}</div>
                  <div style={{ height: 24, borderRadius: 3, background: on ? color : C.bg,
                    border: `1px solid ${on ? color : C.border}`, opacity: on ? 0.85 : 1 }} />
                </div>
              );
            })}
          </div>
          {pillars && (
            <select value={newAct.pillar || ""} onChange={e => setNewAct({ ...newAct, pillar: e.target.value })}
              style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, color: C.inkMid,
                fontSize: 12, fontFamily: "'Courier New', monospace", padding: "5px 8px", marginBottom: 10 }}>
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

// ── WORK DOMAIN VIEW ──────────────────────────────────────────────────────────
const HORIZONS   = ["today", "this week", "someday"];
const PRIORITIES = ["high", "med", "low"];
const CRM_STAGES = ["prospect", "investor", "portfolio", "advisor", "team"];
const PROJECTS   = ["Maro","Immersiv","Bloomwell","OSI","Wellnest","Calibright","Portoro","DCG"];
const PRI_COLOR  = { high: C.red, med: C.gold, low: C.inkFaint };
const STAGE_COLOR = { prospect: "#b87a2a", investor: "#3d6ea8", portfolio: "#4e9e8e", advisor: "#7a5aaa", team: "#3a8a5a" };
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
  const [crmSearch, setCrmSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState(null);
  const [editingContact, setEditingContact] = useState(null);
  const [newContact, setNewContact] = useState({ name:"", company:"", role:"", stage:"prospect", lastContact:"", email:"", phone:"", linkedin:"", personal:"", notes:"" });
  const [addingContact, setAddingContact] = useState(false);
  const [selectedCall, setSelectedCall]   = useState(null);
  const [writingCall, setWritingCall]     = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [notesQuery, setNotesQuery]       = useState("");
  const [notesAnswer, setNotesAnswer]     = useState("");
  const [queryingNotes, setQueryingNotes] = useState(false);
  const crmSearchTimer = useRef(null);
  const notesQueryRef  = useRef(null);
  const [nameQuery, setNameQuery]         = useState("");
  const [summarizing, setSummarizing]     = useState(null);

  const todos    = domain.todos    || [];
  const contacts = domain.contacts || [];
  const calls    = domain.calls    || [];

  const setTodos    = (t) => onUpdate({ ...domain, todos: t });
  const setContacts = (c) => onUpdate({ ...domain, contacts: c });
  const setCalls    = (c) => onUpdate({ ...domain, calls: c });

  const contactName = (id) => contacts.find(c => c.id === id)?.name || "—";

  const WORK_TABS = [
    { id: "todos", label: "Todos" },
    { id: "crm",   label: "People" },
  ];

  // ── Domain header ────────────────────────────────────────────────────────
  const Header = () => (
    <div style={{ paddingTop: 8, paddingBottom: 16, textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'Courier New', monospace",
        letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 12 }}>
        {domain.question}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${domain.color}66)` }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22, color: domain.color }}>{domain.glyph}</span>
          <span style={{ fontSize: 28, color: C.navy, fontWeight: 700, letterSpacing: "-0.3px" }}>Work</span>
        </div>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${domain.color}66)` }} />
      </div>
      <div style={{ fontSize: 13, color: C.inkLight, fontStyle: "italic", lineHeight: 1.6,
        maxWidth: 380, margin: "0 auto 12px" }}>{domain.identity}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${C.borderMid})` }} />
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: domain.color, opacity: 0.5 }} />
        <div style={{ width: 16, height: 1, background: C.borderMid, opacity: 0.5 }} />
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: domain.color, opacity: 0.5 }} />
        <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${C.borderMid})` }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
        {[1,2,3,4,5].map(v => (
          <div key={v} onClick={() => onUpdate({ ...domain, rating: v })} style={{
            width: 10, height: 10, borderRadius: "50%",
            background: v <= domain.rating ? domain.color : C.border, cursor: "pointer" }} />
        ))}
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

  // Inline edit form — expands in-place
  const TodoEditRow = ({ t }) => (
    <div style={{ padding:"10px 0 14px", borderBottom:`1px solid ${C.border}`,
      background:C.caqiLight+"44", borderLeft:`3px solid ${domain.color}`, paddingLeft:10 }}>
      <input value={t.text}
        onChange={e => setTodos(todos.map(x => x.id===t.id ? { ...x, text:e.target.value } : x))}
        style={{ width:"100%", background:"transparent", border:"none",
          borderBottom:`1px solid ${domain.color}`, color:C.ink, fontSize:14,
          fontFamily:"Georgia, serif", fontStyle:"italic",
          padding:"3px 0", outline:"none", boxSizing:"border-box", marginBottom:10 }} />

      <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'Courier New', monospace",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Time</div>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:10 }}>
        {DURATIONS.map(d => (
          <button key={d} onClick={() => setTodos(todos.map(x => x.id===t.id ? { ...x, duration:d } : x))}
            style={{ background:t.duration===d ? DUR_COLOR[d] : "transparent",
              color:t.duration===d ? "#fff" : DUR_COLOR[d],
              border:`1.5px solid ${DUR_COLOR[d]}`,
              borderRadius:10, padding:"2px 9px", fontSize:10, cursor:"pointer",
              fontFamily:"'Courier New', monospace" }}>{d}</button>
        ))}
      </div>

      <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'Courier New', monospace",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>When</div>
      <div style={{ display:"flex", gap:4, marginBottom:10 }}>
        {HORIZONS.map(h => (
          <button key={h} onClick={() => setTodos(todos.map(x => x.id===t.id ? { ...x, horizon:h } : x))}
            style={{ flex:1, background:t.horizon===h ? domain.color : "transparent",
              color:t.horizon===h ? "#fff" : C.inkLight,
              border:`1.5px solid ${t.horizon===h ? domain.color : C.border}`,
              borderRadius:4, padding:"3px 4px", fontSize:11, cursor:"pointer",
              fontFamily:"Georgia, serif", fontStyle:"italic",
              textTransform:"capitalize" }}>{h}</button>
        ))}
      </div>

      <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'Courier New', monospace",
        textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Project</div>
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
        {PROJECTS.map(p => (
          <button key={p} onClick={() => setTodos(todos.map(x => x.id===t.id ? { ...x, project:t.project===p?"":p } : x))}
            style={{ background:t.project===p ? domain.color : "transparent",
              color:t.project===p ? "#fff" : C.inkLight,
              border:`1px solid ${t.project===p ? domain.color : C.border}`,
              borderRadius:4, padding:"2px 9px", fontSize:10, cursor:"pointer",
              fontFamily:"'Courier New', monospace" }}>{p}</button>
        ))}
      </div>

      <button onClick={() => setEditingTodo(null)}
        style={{ background:domain.color, border:"none", borderRadius:4, color:"#fff",
          fontSize:11, padding:"5px 14px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Done</button>
    </div>
  );

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
                fontFamily:"Georgia, serif", fontStyle:"italic",
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
            if (editingTodo===t.id) return <TodoEditRow key={t.id} t={t} />;
            return (
              <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,
                padding:"11px 0",borderBottom:`1px solid ${C.border}`}}>

                {/* Checkbox */}
                <div onClick={() => setTodos(todos.map(x => x.id===t.id?{...x,done:true}:x))}
                  style={{width:17,height:17,borderRadius:3,flexShrink:0,marginTop:2,
                    border:`2px solid ${C.borderMid}`,background:"transparent",cursor:"pointer"}} />

                {/* Text + meta — tap text to open edit */}
                <div style={{flex:1,minWidth:0}}>
                  <div onClick={() => setEditingTodo(t.id)}
                    style={{fontSize:14,color:C.ink,fontFamily:"Georgia, serif",
                      lineHeight:1.4,cursor:"text"}}>{t.text}</div>
                  <div style={{display:"flex",gap:6,marginTop:5,alignItems:"center",flexWrap:"wrap"}}>
                    <span onClick={() => {
                      const idx=DURATIONS.indexOf(t.duration);
                      setTodos(todos.map(x => x.id===t.id?{...x,duration:DURATIONS[(idx+1)%DURATIONS.length]}:x));
                    }} style={{fontSize:10,color:DUR_COLOR[t.duration]||C.inkFaint,
                      background:(DUR_COLOR[t.duration]||C.inkFaint)+"18",
                      border:`1px solid ${DUR_COLOR[t.duration]||C.inkFaint}33`,
                      borderRadius:10,padding:"1px 7px",fontFamily:"'Courier New', monospace",
                      cursor:"pointer",userSelect:"none"}}>{t.duration}</span>
                    {t.project && (
                      <span style={{fontSize:10,color:domain.color,fontFamily:"'Courier New', monospace"}}>{t.project}</span>
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
                        fontFamily:"'Courier New', monospace",whiteSpace:"nowrap",lineHeight:1.4}}>{label}</button>
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
        {addingTodo ? (
          <div style={{marginTop:12,padding:"12px 0",borderTop:`1px solid ${C.border}`}}>
            <input value={newTodo.text} onChange={e => setNewTodo({...newTodo,text:e.target.value})}
              placeholder="What needs doing?" autoFocus
              onKeyDown={e => { if (e.key==="Escape") setAddingTodo(false); }}
              style={{width:"100%",background:"transparent",border:"none",
                borderBottom:`1px solid ${domain.color}`,color:C.ink,fontSize:14,
                fontFamily:"Georgia, serif",fontStyle:"italic",
                padding:"4px 0",outline:"none",boxSizing:"border-box",marginBottom:12}} />

            <div style={{fontSize:10,color:C.inkFaint,fontFamily:"'Courier New', monospace",
              textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Time needed</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:12}}>
              {DURATIONS.map(d => (
                <button key={d} onClick={() => setNewTodo({...newTodo,duration:d})}
                  style={{background:newTodo.duration===d?DUR_COLOR[d]:"transparent",
                    color:newTodo.duration===d?"#fff":DUR_COLOR[d],
                    border:`1.5px solid ${DUR_COLOR[d]}`,
                    borderRadius:10,padding:"3px 10px",fontSize:11,cursor:"pointer",
                    fontFamily:"'Courier New', monospace"}}>{d}</button>
              ))}
            </div>

            <div style={{fontSize:10,color:C.inkFaint,fontFamily:"'Courier New', monospace",
              textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>When</div>
            <div style={{display:"flex",gap:4,marginBottom:12}}>
              {HORIZONS.map(h => (
                <button key={h} onClick={() => setNewTodo({...newTodo,horizon:h})}
                  style={{flex:1,background:newTodo.horizon===h?domain.color:"transparent",
                    color:newTodo.horizon===h?"#fff":C.inkLight,
                    border:`1.5px solid ${newTodo.horizon===h?domain.color:C.border}`,
                    borderRadius:4,padding:"4px 4px",fontSize:11,cursor:"pointer",
                    fontFamily:"Georgia, serif",fontStyle:"italic",
                    textTransform:"capitalize"}}>{h}</button>
              ))}
            </div>

            <div style={{fontSize:10,color:C.inkFaint,fontFamily:"'Courier New', monospace",
              textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Project</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
              {PROJECTS.map(p => (
                <button key={p} onClick={() => setNewTodo({...newTodo,project:newTodo.project===p?"":p})}
                  style={{background:newTodo.project===p?domain.color:"transparent",
                    color:newTodo.project===p?"#fff":C.inkLight,
                    border:`1px solid ${newTodo.project===p?domain.color:C.border}`,
                    borderRadius:4,padding:"2px 9px",fontSize:10,cursor:"pointer",
                    fontFamily:"'Courier New', monospace"}}>{p}</button>
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
        ) : (
          <button onClick={() => { setAddingTodo(true); setNewTodo(n => ({...n,horizon:todoHorizon})); }}
            style={{width:"100%",background:"transparent",border:`1px dashed ${C.borderMid}`,
              borderRadius:6,padding:"9px",color:C.inkFaint,fontSize:12,cursor:"pointer",
              fontFamily:"Georgia, serif",fontStyle:"italic",marginTop:10}}>+ Add task</button>
        )}

        {/* Done */}
        {done.length>0 && (
          <div style={{marginTop:20}}>
            <SectionRule label={`done · ${done.length}`} color={C.inkFaint} />
            {done.map(t => {
              if (editingTodo===t.id) return <TodoEditRow key={t.id} t={t} />;
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
                      fontFamily:"Georgia, serif",flex:1,cursor:"text"}}>{t.text}</span>
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
      // Pass fresh calls directly to avoid stale closure
      setTimeout(() => generateSummaryFromCalls(selectedContact, updated), 150);
    };

    const saveEditedNote = (noteId) => {
      const html = editNoteRef.current?.innerHTML?.trim() || "";
      if (!html) { setEditingNoteId(null); return; }
      const updated = calls.map(cl => cl.id === noteId ? { ...cl, notes: html } : cl);
      onUpdate({ ...domain, calls: updated });
      setEditingNoteId(null);
    };

    // Inline editable field
    const EditField = ({ label, value, field, placeholder, multiline }) => {
      const [editing, setEditing] = useState(false);
      const [val, setVal] = useState(value || "");
      const commit = () => { updateContact(field, val); setEditing(false); };
      return (
        <div style={{ padding:"8px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"'Courier New', monospace",
            textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>{label}</div>
          {editing ? (
            <div>
              {multiline
                ? <textarea dir="ltr" value={val} onChange={e => setVal(e.target.value)} rows={3}
                    autoFocus style={{ width:"100%", background:"transparent", border:"none",
                      borderBottom:`1px solid ${domain.color}`, color:C.ink, fontSize:13,
                      fontFamily:"Georgia, serif", fontStyle:"italic", padding:"2px 0",
                      outline:"none", resize:"none", boxSizing:"border-box" }} />
                : <input dir="ltr" value={val} onChange={e => setVal(e.target.value)} autoFocus
                    onKeyDown={e => e.key==="Enter" && commit()}
                    style={{ width:"100%", background:"transparent", border:"none",
                      borderBottom:`1px solid ${domain.color}`, color:C.ink, fontSize:13,
                      fontFamily:"Georgia, serif", fontStyle:"italic", padding:"2px 0",
                      outline:"none", boxSizing:"border-box" }} />
              }
              <div style={{ display:"flex", gap:8, marginTop:6 }}>
                <button onClick={commit} style={{ background:domain.color, border:"none",
                  borderRadius:3, color:"#fff", fontSize:10, padding:"3px 10px",
                  cursor:"pointer", fontFamily:"inherit" }}>Save</button>
                <button onClick={() => setEditing(false)} style={{ background:"transparent",
                  border:`1px solid ${C.border}`, borderRadius:3, color:C.inkFaint,
                  fontSize:10, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div onClick={() => { setVal(value||""); setEditing(true); }}
              style={{ fontSize:13, color:value ? C.inkMid : C.inkFaint,
                fontFamily:"Georgia, serif", fontStyle:"italic",
                cursor:"text", minHeight:18, lineHeight:1.5 }}>
              {value || <span style={{ opacity:0.4 }}>{placeholder}</span>}
            </div>
          )}
        </div>
      );
    };

    if (contact) {
      const warmth = contactWarmth(contact.lastContact);
      return (
        <div>
          <button onClick={() => { setSelectedContact(null); setWritingCall(null); setNotesQuery(""); setNotesAnswer(""); }}
            style={{ background:"transparent", border:"none", color:domain.color,
              cursor:"pointer", fontSize:12, fontFamily:"Georgia, serif", fontStyle:"italic",
              padding:"0 0 14px", display:"block" }}>← people</button>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:12,
            paddingBottom:14, marginBottom:12, borderBottom:`1px solid ${C.border}` }}>
            <div style={{ width:42, height:42, borderRadius:"50%", flexShrink:0,
              background:STAGE_COLOR[contact.stage]+"22",
              border:`1.5px solid ${STAGE_COLOR[contact.stage]}55`,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ fontSize:17, color:STAGE_COLOR[contact.stage],
                fontFamily:"Georgia, serif", fontWeight:600 }}>{contact.name[0]}</span>
            </div>
            <div style={{ flex:1 }}>
              <EditField label="" field="name" value={contact.name} placeholder="Name" />
              <div style={{ fontSize:12, color:C.inkLight, fontStyle:"italic", marginBottom:8 }}>
                <EditField label="" field="role" value={contact.role} placeholder="Role" />
                <EditField label="" field="company" value={contact.company} placeholder="Company" />
              </div>
              {/* Warmth dots — driven by last contact date */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ display:"flex", gap:4 }}>
                  {[1,2,3,4,5].map(v => (
                    <div key={v} style={{ width:8, height:8, borderRadius:"50%",
                      background: v<=warmth ? WARMTH_COLOR(warmth) : C.border }} />
                  ))}
                </div>
                <span style={{ fontSize:9, color:C.inkFaint, fontFamily:"'Courier New', monospace" }}>
                  {contact.lastContact ? `last spoke ${contact.lastContact}` : "never contacted"}
                </span>
              </div>
            </div>
            {!isWriting && (
              <button onClick={() => setWritingCall({ contactId:selectedContact, date:today })}
                style={{ background:domain.color, border:"none", borderRadius:4, color:"#fff",
                  fontSize:11, padding:"5px 12px", cursor:"pointer",
                  fontFamily:"Georgia, serif", fontStyle:"italic", fontWeight:600,
                  flexShrink:0 }}>+ note</button>
            )}
          </div>

          {/* Stage */}
          <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:12 }}>
            {CRM_STAGES.map(s => (
              <button key={s} onClick={() => updateContact("stage", s)}
                style={{ background:contact.stage===s ? STAGE_COLOR[s] : "transparent",
                  color:contact.stage===s ? "#fff" : STAGE_COLOR[s],
                  border:`1.5px solid ${STAGE_COLOR[s]}`,
                  borderRadius:20, padding:"2px 9px", fontSize:10, cursor:"pointer",
                  fontFamily:"'Courier New', monospace", textTransform:"capitalize" }}>{s}</button>
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
                style={{ fontSize:12, color:domain.color, fontFamily:"'Courier New', monospace",
                  textDecoration:"none" }}>{contact[field]}</a>
            </div>
          ) : null)}

          {/* Editable contact details */}
          <EditField label="Email" field="email" value={contact.email} placeholder="email@example.com" />
          <EditField label="Phone" field="phone" value={contact.phone} placeholder="+1 212 555 0000" />
          <EditField label="LinkedIn" field="linkedin" value={contact.linkedin} placeholder="linkedin.com/in/name" />
          <EditField label="Personal" field="personal" value={contact.personal}
            placeholder="Kids, interests, things they've shared about their life…" multiline />
          <EditField label="Context" field="notes" value={contact.notes}
            placeholder="Professional context, how you met…" multiline />

          {/* Open todos */}
          {todos.filter(t => t.contactId===contact.id && !t.done).length > 0 && (
            <div style={{ margin:"12px 0" }}>
              <SectionRule label="open tasks" color={domain.color} />
              {todos.filter(t => t.contactId===contact.id && !t.done).map(t => (
                <div key={t.id} style={{ display:"flex", gap:8, alignItems:"flex-start",
                  padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div onClick={() => setTodos(todos.map(x => x.id===t.id?{...x,done:true}:x))}
                    style={{ width:15, height:15, borderRadius:3, flexShrink:0, marginTop:2,
                      border:`2px solid ${C.borderMid}`, background:"transparent", cursor:"pointer" }} />
                  <span style={{ fontSize:13, color:C.inkMid, fontFamily:"Georgia, serif",
                    fontStyle:"italic", flex:1 }}>{t.text}</span>
                  <span style={{ fontSize:10, color:DUR_COLOR[t.duration]||C.inkFaint,
                    fontFamily:"'Courier New', monospace" }}>{t.duration}</span>
                </div>
              ))}
            </div>
          )}

          {/* Writing canvas */}
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
                      fontSize:11, color:C.inkMid, fontFamily:"'Courier New', monospace" }}>
                    {icon}
                  </button>
                ))}
              </div>
              <div style={{ padding:14 }}>
                <div style={{ fontSize:10, color:domain.color, fontFamily:"'Courier New', monospace",
                  textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{today}</div>
                <div ref={noteRef} dir="ltr" contentEditable suppressContentEditableWarning
                  style={{ width:"100%", minHeight:140, background:"transparent", border:"none",
                    color:C.ink, fontSize:14, fontFamily:"Georgia, serif", lineHeight:1.8,
                    outline:"none", direction:"ltr", textAlign:"left",
                    whiteSpace:"pre-wrap", wordBreak:"break-word" }}
                  data-placeholder="Write freely…" />
                <div style={{ display:"flex", justifyContent:"flex-end", gap:8,
                  borderTop:`1px solid ${C.border}`, paddingTop:10, marginTop:10 }}>
                  <button onClick={() => setWritingCall(null)}
                    style={{ background:"transparent", border:`1px solid ${C.border}`,
                      borderRadius:4, color:C.inkFaint, fontSize:12, padding:"5px 12px",
                      cursor:"pointer", fontFamily:"inherit" }}>Discard</button>
                  <button onClick={saveNote}
                    style={{ background:domain.color, border:"none", borderRadius:4,
                      color:"#fff", fontSize:12, padding:"5px 16px", cursor:"pointer",
                      fontFamily:"inherit", fontWeight:600 }}>Save + summarize</button>
                </div>
              </div>
            </div>
          )}

          {/* AI Summary */}
          {summarizing===selectedContact ? (
            <div style={{ background:domain.colorLight, border:`1px solid ${domain.color}33`,
              borderLeft:`3px solid ${domain.color}`, borderRadius:6,
              padding:"12px 14px", margin:"14px 0" }}>
              <div style={{ fontSize:10, color:domain.color, fontFamily:"'Courier New', monospace",
                textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:4 }}>Summarizing…</div>
              <div style={{ fontSize:12, color:C.inkFaint, fontStyle:"italic" }}>Claude is reading your notes…</div>
            </div>
          ) : contact.aiSummary ? (
            <div style={{ background:domain.colorLight, border:`1px solid ${domain.color}33`,
              borderLeft:`3px solid ${domain.color}`, borderRadius:6,
              padding:"12px 14px", margin:"14px 0" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div style={{ fontSize:10, color:domain.color, fontFamily:"'Courier New', monospace",
                  textTransform:"uppercase", letterSpacing:"0.08em" }}>Summary</div>
                <button onClick={() => generateSummary(selectedContact)}
                  style={{ background:"transparent", border:"none", color:C.inkFaint,
                    cursor:"pointer", fontSize:10, fontFamily:"'Courier New', monospace", padding:0 }}>↻ refresh</button>
              </div>
              <div style={{ fontSize:14, color:C.inkMid, fontFamily:"Georgia, serif",
                lineHeight:1.8, fontStyle:"italic" }}>{contact.aiSummary}</div>
            </div>
          ) : contactNotes.length > 0 ? (
            <button onClick={() => generateSummary(selectedContact)}
              style={{ width:"100%", background:"transparent", border:`1px dashed ${domain.color}66`,
                borderRadius:6, padding:"10px", color:domain.color, fontSize:12,
                cursor:"pointer", fontFamily:"Georgia, serif", fontStyle:"italic", margin:"14px 0 0" }}>
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
                      const res = await fetch("https://api.anthropic.com/v1/messages", {
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
                    fontFamily:"Georgia, serif", fontStyle:"italic",
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
                  <div style={{ fontSize:10, color:domain.color, fontFamily:"'Courier New', monospace",
                    textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:6 }}>Answer</div>
                  <div style={{ fontSize:14, color:C.inkMid, fontFamily:"Georgia, serif",
                    lineHeight:1.7, fontStyle:"italic" }}>{notesAnswer}</div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {contactNotes.length > 0 && (
            <div style={{ marginTop:14 }}>
              <SectionRule label="notes" color={domain.color} />
              {contactNotes.map(cl => (
                <div key={cl.id} style={{ marginBottom:18, paddingBottom:18,
                  borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center", marginBottom:8 }}>
                    <div style={{ fontSize:11, color:domain.color,
                      fontFamily:"'Courier New', monospace" }}>{cl.date}</div>
                    <div style={{ display:"flex", gap:6 }}>
                      {editingNoteId === cl.id ? (
                        <>
                          <button onClick={() => saveEditedNote(cl.id)}
                            style={{ background:domain.color, border:"none", borderRadius:3,
                              color:"#fff", fontSize:10, padding:"2px 10px",
                              cursor:"pointer", fontFamily:"inherit" }}>Save</button>
                          <button onClick={() => setEditingNoteId(null)}
                            style={{ background:"transparent", border:`1px solid ${C.border}`,
                              borderRadius:3, color:C.inkFaint, fontSize:10,
                              padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditingNoteId(cl.id)}
                            style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
                              borderRadius:3, color:C.inkFaint, fontSize:10,
                              padding:"2px 8px", cursor:"pointer", fontFamily:"inherit" }}>Edit</button>
                          <button onClick={() => onUpdate({ ...domain, calls: calls.filter(x => x.id!==cl.id) })}
                            style={{ background:"transparent", border:`1px solid ${C.borderMid}`,
                              borderRadius:3, color:C.red, fontSize:10, padding:"2px 8px",
                              cursor:"pointer", fontFamily:"inherit" }}>Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingNoteId === cl.id ? (
                    <div style={{ border:`1px solid ${domain.color}44`,
                      borderRadius:6, overflow:"hidden" }}>
                      {/* Rich text toolbar for edit mode */}
                      <div style={{ display:"flex", gap:2, padding:"6px 10px",
                        borderBottom:`1px solid ${C.border}`, flexWrap:"wrap" }}>
                        {[
                          { cmd:"bold",      icon:"B", style:{ fontWeight:700 } },
                          { cmd:"italic",    icon:"I", style:{ fontStyle:"italic" } },
                          { cmd:"underline", icon:"U", style:{ textDecoration:"underline" } },
                        ].map(({ cmd, icon, style:s }) => (
                          <button key={cmd}
                            onMouseDown={e => { e.preventDefault(); document.execCommand(cmd); }}
                            style={{ background:"transparent", border:`1px solid ${C.border}`,
                              borderRadius:3, width:26, height:24, cursor:"pointer",
                              fontSize:12, color:C.inkMid, ...s }}>{icon}</button>
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
                              fontSize:11, color:C.inkMid, fontFamily:"'Courier New', monospace" }}>{icon}</button>
                        ))}
                      </div>
                      <div
                        ref={editNoteRef}
                        dir="ltr"
                        contentEditable
                        suppressContentEditableWarning
                        dangerouslySetInnerHTML={{ __html: cl.notes }}
                        style={{ padding:12, minHeight:100, color:C.ink,
                          fontSize:14, fontFamily:"Georgia, serif", lineHeight:1.8,
                          outline:"none", direction:"ltr", textAlign:"left",
                          whiteSpace:"pre-wrap", wordBreak:"break-word" }}
                      />
                    </div>
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{ __html: cl.notes }}
                      style={{ fontSize:14, color:C.ink, fontFamily:"Georgia, serif",
                        lineHeight:1.8 }}
                    />
                  )}
                </div>
              ))}
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
            dir="ltr"
            defaultValue={crmSearch}
            onChange={e => {
              const v = e.target.value;
              if (crmSearchTimer.current) clearTimeout(crmSearchTimer.current);
              crmSearchTimer.current = setTimeout(() => setCrmSearch(v), 350);
            }}
            placeholder="Search by name or company…"
            style={{ width:"100%", background:C.surface,
              border:`1px solid ${C.border}`,
              borderRadius:6, color:C.ink, fontSize:14,
              fontFamily:"Georgia, serif", fontStyle:"italic",
              padding:"9px 14px", outline:"none", boxSizing:"border-box" }} />
        </div>

        {/* Stage filters */}
        <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:14 }}>
          {["all", ...CRM_STAGES].map(s => (
            <button key={s} onClick={() => setCrmFilter(s)}
              style={{ background: crmFilter===s ? (STAGE_COLOR[s]||domain.color) : "transparent",
                color: crmFilter===s ? "#fff" : (STAGE_COLOR[s]||C.inkLight),
                border:`1.5px solid ${STAGE_COLOR[s]||domain.color}`,
                borderRadius:20, padding:"3px 10px", fontSize:10, cursor:"pointer",
                fontFamily:"'Courier New', monospace", textTransform:"capitalize",
                transition:"all 0.12s" }}>{s}</button>
          ))}
        </div>

        {/* Contact list — warmth dots from last contact */}
        <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
          {filtered
            .filter(c => !crmSearch || c.name.toLowerCase().includes(crmSearch.toLowerCase()) ||
              c.company.toLowerCase().includes(crmSearch.toLowerCase()))
            .map(c => {
            const w = contactWarmth(c.lastContact);
            const cNotes = calls.filter(cl => cl.contactId===c.id);
            return (
              <div key={c.id} onClick={() => setSelectedContact(c.id)}
                style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 0",
                  borderBottom:`1px solid ${C.border}`, cursor:"pointer" }}>
                <div style={{ width:32, height:32, borderRadius:"50%", flexShrink:0,
                  background: STAGE_COLOR[c.stage]+"22",
                  border:`1.5px solid ${STAGE_COLOR[c.stage]}55`,
                  display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontSize:13, color:STAGE_COLOR[c.stage],
                    fontFamily:"Georgia, serif", fontWeight:600 }}>{c.name[0]}</span>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, color:C.ink, fontFamily:"Georgia, serif",
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
                      fontFamily:"'Courier New', monospace" }}>{c.lastContact}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add contact */}
        {addingContact ? (
          <div style={{ marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:14 }}>
            {[["name","Name"],["company","Company"],["role","Role"],["email","Email"],["phone","Phone"],["linkedin","LinkedIn"],["personal","Personal notes"],["notes","Context"]].map(([k,ph]) => (
              <input key={k} dir="ltr" value={newContact[k]||""} onChange={e => setNewContact({ ...newContact, [k]:e.target.value })}
                placeholder={ph} style={{ width:"100%", background:"transparent", border:"none",
                  borderBottom:`1px solid ${C.border}`, color:C.ink, fontSize:14,
                  fontFamily:"Georgia, serif", fontStyle:"italic",
                  padding:"6px 0", outline:"none", boxSizing:"border-box", marginBottom:8 }} />
            ))}
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
              {CRM_STAGES.map(s => (
                <button key={s} onClick={() => setNewContact({ ...newContact, stage:s })}
                  style={{ background: newContact.stage===s ? STAGE_COLOR[s] : "transparent",
                    color: newContact.stage===s ? "#fff" : STAGE_COLOR[s],
                    border:`1.5px solid ${STAGE_COLOR[s]}`,
                    borderRadius:20, padding:"2px 9px", fontSize:10, cursor:"pointer",
                    fontFamily:"'Courier New', monospace", textTransform:"capitalize" }}>{s}</button>
              ))}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => {
                if (!newContact.name.trim()) return;
                setContacts([...contacts, { ...newContact, id:`c${Date.now()}` }]);
                setNewContact({ name:"",company:"",role:"",stage:"prospect",lastContact:"",email:"",phone:"",linkedin:"",personal:"",notes:"" });
                setAddingContact(false);
              }} style={{ background:domain.color, border:"none", borderRadius:4, color:"#fff",
                fontSize:12, padding:"6px 16px", cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>Add</button>
              <button onClick={() => setAddingContact(false)}
                style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:4,
                  color:C.inkFaint, fontSize:12, padding:"6px 10px", cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingContact(true)}
            style={{ width:"100%", background:"transparent", border:`1px dashed ${C.borderMid}`,
              borderRadius:6, padding:"9px", color:C.inkFaint, fontSize:12, cursor:"pointer",
              fontFamily:"Georgia, serif", fontStyle:"italic", marginTop:10 }}>+ Add person</button>
        )}
      </div>
    );
  };

  // ── AI SUMMARIZE ─────────────────────────────────────────────────────────
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
      const res = await fetch("https://api.anthropic.com/v1/messages", {
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


  return (
    <div>
      <Header />
      {/* Tabs */}
      <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:0 }}>
        {WORK_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:1, background:"transparent", border:"none",
            borderBottom:`2px solid ${tab===t.id ? domain.color : "transparent"}`,
            color: tab===t.id ? domain.color : C.inkFaint,
            padding:"10px 4px", fontSize:11, cursor:"pointer",
            fontFamily:"Georgia, serif", fontStyle:"italic",
            transition:"all 0.12s", marginBottom:-1 }}>{t.label}</button>
        ))}
      </div>
      <div style={{ paddingTop:12 }}>
        {tab === "todos" && <TodosTab />}
        {tab === "crm"   && <CRMTab />}
      </div>
    </div>
  );
}

// ── DOMAIN VIEW ───────────────────────────────────────────────────────────────
function DomainView({ domain, onUpdate, onBack }) {
  // Work has its own specialized view
  if (domain.id === "work") {
    return <WorkDomainView domain={domain} onUpdate={onUpdate} />;
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
        <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'Courier New', monospace",
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
            fontFamily: "Georgia, serif", fontStyle: "italic",
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
                  <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 4 }}>{k.label}</div>
                  <span style={{ fontSize: 22, fontWeight: 700, color: C.ink }}>{k.value}
                    <span style={{ fontSize: 11, fontWeight: 400, color: C.inkLight }}>{k.unit && ` ${k.unit}`}</span>
                  </span>
                  {k.delta && <span style={{ fontSize: 11, color: k.delta.startsWith("+") ? C.green : C.red, marginLeft: 6, fontFamily: "'Courier New', monospace" }}>{k.delta}</span>}
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

      const response = await fetch("https://api.anthropic.com/v1/messages", {
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
        <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'Courier New', monospace",
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
          <div style={{ fontSize:11, color:C.inkMid, fontFamily:"Georgia, serif", fontStyle:"italic" }}>{weekLabel}</div>
          {weekOffset !== 0 && <button onClick={() => setWeekOffset(0)} style={{ background:"transparent",border:"none",color:C.caqi,cursor:"pointer",fontSize:10,fontFamily:"Georgia, serif",fontStyle:"italic",padding:0,marginTop:1 }}>this week</button>}
        </div>
        <button onClick={() => setWeekOffset(w => w+1)} style={{ background:"transparent",border:"none",color:C.caqi,cursor:"pointer",fontSize:20,padding:"0 4px" }}>›</button>
      </div>

      {/* Placing banner */}
      {isPlacing && (
        <div style={{ background: C.caqiLight, border:`1px solid ${C.caqi}44`, borderRadius:6,
          padding:"7px 12px", marginBottom:8, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:12, color:C.caqi, fontFamily:"Georgia, serif", fontStyle:"italic" }}>
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
            fontFamily:"Georgia, serif", fontStyle:"italic", opacity: scheduling ? 0.6 : 1 }}>
          {scheduling ? "Scheduling…" : "📋 Schedule todos around meetings"}
        </button>

        {/* Screenshot import button */}
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}
          style={{ flex:1, background: importing ? C.border : "transparent",
            border:`1.5px solid ${C.caqi}`, borderRadius:6,
            color: importing ? C.inkFaint : C.caqi, fontSize:12,
            padding:"8px 12px", cursor: importing ? "default" : "pointer",
            fontFamily:"Georgia, serif", fontStyle:"italic" }}>
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
          <span style={{ fontSize:12, color:C.caqi, fontFamily:"Georgia, serif", fontStyle:"italic" }}>{importMsg}</span>
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
                  fontFamily:"'Courier New', monospace" }}>{label}</div>
                <div style={{ fontSize:12, fontWeight:isToday(date)?700:400,
                  color:isToday(date)?C.caqi:C.inkMid, fontFamily:"Georgia, serif" }}>{date.getDate()}</div>
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
                  fontSize:8, color:C.inkFaint, fontFamily:"'Courier New', monospace",
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
                    fontFamily:"Georgia, serif", fontStyle:"italic",
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
        <div style={{ fontSize:10, color:C.inkFaint, fontFamily:"Georgia, serif",
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
                fontFamily:"Georgia, serif", fontStyle:"italic",
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
              <div style={{ fontSize:11, color:dom.color, fontFamily:"Georgia, serif",
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
                        <div style={{ fontSize:12, color:C.ink, fontFamily:"Georgia, serif",
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
                                fontFamily:"'Courier New', monospace" }}>{label}</span>
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
                          fontFamily:"Georgia, serif", fontStyle:"italic",
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
    style.innerHTML = `[contenteditable][data-placeholder]:empty:before { content: attr(data-placeholder); color: #b8c4cc; pointer-events: none; font-style: italic; }`;
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
      height:"100vh", background:C.bg, fontFamily:"Georgia, serif",
      flexDirection:"column", gap:12 }}>
      <div style={{ width:36, height:36, borderRadius:"50%", background:C.caqi,
        display:"flex", alignItems:"center", justifyContent:"center" }}>
        <span style={{ fontSize:16, color:C.navy, fontWeight:700, fontStyle:"italic" }}>f</span>
      </div>
      <div style={{ fontSize:13, color:C.inkFaint, fontStyle:"italic" }}>Loading your life…</div>
    </div>
  );

  return (
    <div dir="ltr" style={{ background: C.bg, minHeight: "100vh", fontFamily: "Georgia, serif",
      color: C.ink, maxWidth: 560, margin: "0 auto" }}>

      {(selected || showCalendar) && (
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => { setSelected(null); setShowCalendar(false); }} style={{ background: "transparent", border: "none",
            color: C.caqi, cursor: "pointer", fontSize: 13, fontFamily: "Georgia, serif",
            fontStyle: "italic", padding: 0 }}>← back</button>
          <span style={{ fontSize: 10, color: C.inkFaint, fontFamily: "'Courier New', monospace",
            letterSpacing: "0.1em" }}>{dateStr}</span>
        </div>
      )}

      <div style={{ padding: (selected || showCalendar) ? "0 20px 60px" : "0 20px 40px" }}>
        {!selected && !showCalendar ? (
          <div>
            <div style={{ paddingTop: 48, paddingBottom: 8, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.inkFaint, fontFamily: "'Courier New', monospace",
                letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 20 }}>{dateStr}</div>

              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${C.borderMid})` }} />
                <div style={{ fontSize: 34, color: C.navy, fontWeight: 700, lineHeight: 1.1,
                  letterSpacing: "-0.5px", whiteSpace: "nowrap" }}>Good {timeWord}.</div>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${C.borderMid})` }} />
              </div>

              <div style={{ fontSize: 19, color: C.inkLight, fontWeight: 400, fontStyle: "italic",
                lineHeight: 1.4, marginBottom: 4 }}>Seven dimensions of a life well lived.</div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 1, background: `linear-gradient(to right, transparent, ${C.borderMid})` }} />
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.caqi, opacity: 0.6 }} />
                <div style={{ width: 20, height: 1, background: C.borderMid, opacity: 0.6 }} />
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: C.caqi, opacity: 0.6 }} />
                <div style={{ flex: 1, height: 1, background: `linear-gradient(to left, transparent, ${C.borderMid})` }} />
              </div>

              <div style={{ fontSize: 13, color: C.inkFaint, lineHeight: 1.6,
                maxWidth: 320, margin: "0 auto", marginTop: 12 }}>
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

