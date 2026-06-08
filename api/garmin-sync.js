// api/garmin-sync.js — Vercel serverless function
const SUPA_URL = "https://qghuysyxvjukiwapbijh.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnaHV5c3l4dmp1a2l3YXBiaWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NjAzODgsImV4cCI6MjA5NTMzNjM4OH0.dMmv4TzmVXU-eKRTuoKdFG8D2v1Psb9rqyVHuRLkfdo";

const HEADERS = {
  "apikey": SUPA_KEY,
  "Authorization": `Bearer ${SUPA_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "resolution=merge-duplicates",
};

async function supaUpsert(table, records) {
  if (!records?.length) return 0;
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify(records),
  });
  if (!r.ok) { console.error(`Supabase ${table} ${r.status}:`, await r.text()); return 0; }
  return records.length;
}

function toDS(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const t0 = Date.now();
  const log = [];

  try {
    const { GarminConnect } = await import("garmin-connect");
    const GCClient = new GarminConnect({
      username: process.env.GARMIN_EMAIL,
      password: process.env.GARMIN_PASSWORD,
    });

    // Try cached tokens first
    const oauth1 = process.env.GARMIN_OAUTH1 ? JSON.parse(process.env.GARMIN_OAUTH1) : null;
    const oauth2 = process.env.GARMIN_OAUTH2 ? JSON.parse(process.env.GARMIN_OAUTH2) : null;
    if (oauth1 && oauth2) {
      try { GCClient.loadToken(oauth1, oauth2); log.push("✓ Cached tokens loaded"); }
      catch(e) { await GCClient.login(); log.push("✓ Fresh login"); }
    } else {
      await GCClient.login();
      log.push("✓ Logged in");
    }

    const today = new Date();
    const dailyRecords = [];

    // ── Daily: steps + HR + sleep for last 7 days ─────────────────────────
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const ds = toDS(date);
      try {
        // Fetch in parallel — getSteps, getHeartRate, getSleepData
        const [steps, hr, sleep] = await Promise.allSettled([
          GCClient.getSteps(date),
          GCClient.getHeartRate(date),
          GCClient.getSleepData(date),
        ]);

        const stepsVal   = steps.status==="fulfilled"   ? steps.value   : null;
        const hrVal      = hr.status==="fulfilled"      ? hr.value      : null;
        const sleepVal   = sleep.status==="fulfilled"   ? sleep.value   : null;

        // Steps data
        const totalSteps    = stepsVal?.totalSteps || stepsVal?.steps || null;
        const stepGoal      = stepsVal?.dailyStepGoal || stepsVal?.stepGoal || null;
        const totalCal      = stepsVal?.totalKilocalories || null;
        const activeCal     = stepsVal?.activeKilocalories || null;

        // HR data — Garmin returns array of readings
        let restingHR = null, stressAvg = null;
        if (hrVal) {
          restingHR = hrVal.restingHeartRate || hrVal.resting || null;
          // stress often comes with HR summary
          stressAvg = hrVal.averageStressLevel || null;
        }

        // Sleep
        let sleep_hrs, deep_hrs, rem_hrs, light_hrs, sleep_score, avg_spo2, avg_resp, avg_hr_sleep, sleep_feedback;
        if (sleepVal) {
          const dto = sleepVal.dailySleepDTO || sleepVal;
          if (dto?.sleepWindowConfirmed || dto?.sleepTimeSeconds > 0) {
            sleep_hrs  = dto.sleepTimeSeconds  ? +(dto.sleepTimeSeconds/3600).toFixed(2)  : null;
            deep_hrs   = dto.deepSleepSeconds  ? +(dto.deepSleepSeconds/3600).toFixed(2)  : null;
            rem_hrs    = dto.remSleepSeconds   ? +(dto.remSleepSeconds/3600).toFixed(2)   : null;
            light_hrs  = dto.lightSleepSeconds ? +(dto.lightSleepSeconds/3600).toFixed(2) : null;
            avg_spo2   = dto.averageSpO2Value  || null;
            avg_resp   = dto.averageRespirationValue || null;
            avg_hr_sleep = dto.averageSpO2HRSleep || dto.avgHeartRate || null;
            sleep_feedback = dto.sleepScoreFeedback || null;
            const sc = sleepVal.sleepScores;
            sleep_score = sc?.overall?.value ?? sc?.overall ?? dto.sleepScore ?? dto.overallSleepScore ?? null;
          }
        }

        dailyRecords.push({
          id: `daily_${ds}`, date: ds,
          steps: totalSteps, goal_steps: stepGoal,
          total_calories: totalCal, active_calories: activeCal,
          resting_hr: restingHR, stress_avg: stressAvg,
          sleep_score, sleep_hrs, deep_hrs, rem_hrs, light_hrs,
          avg_spo2, avg_respiration: avg_resp, avg_hr_sleep, sleep_feedback,
          updated_at: new Date().toISOString(),
        });
        log.push(`✓ ${ds}: ${totalSteps||0} steps, HR ${restingHR||"?"}, sleep ${sleep_hrs||"—"}h`);
      } catch(e) {
        log.push(`⚠ ${ds}: ${e.message}`);
      }
    }

    // ── Activities: last 30 days ──────────────────────────────────────────
    const activityRecords = [];
    try {
      const acts = await GCClient.getActivities(0, 30);
      for (const act of acts || []) {
        const st = act.startTimeLocal || act.startTimeGMT || "";
        const ds = st.slice(0,10) || toDS(today);
        const dur = act.duration || 0;
        const dist = act.distance || 0;
        const pace = dur && dist > 0 ? +((dur/60)/(dist/1000)).toFixed(2) : null;
        activityRecords.push({
          id:               `act_${act.activityId}`,
          date:             ds,
          activity_type:    act.activityType?.typeKey || act.activityType,
          name:             act.activityName,
          start_time:       st,
          duration_seconds: Math.round(dur) || null,
          distance_meters:  dist || null,
          calories:         act.calories || null,
          avg_hr:           act.averageHR || null,
          max_hr:           act.maxHR || null,
          avg_pace_min_per_km: pace,
          elevation_gain:   act.elevationGain || null,
          steps:            act.steps || null,
          raw:              JSON.stringify({ activityId: act.activityId, activityName: act.activityName }),
        });
      }
      log.push(`✓ ${activityRecords.length} activities`);
    } catch(e) {
      log.push(`⚠ Activities: ${e.message}`);
    }

    const dSaved = await supaUpsert("health_daily", dailyRecords);
    const aSaved = await supaUpsert("health_activities", activityRecords);
    log.push(`→ Saved: ${dSaved} daily + ${aSaved} activities`);

    res.status(200).json({
      ok: true,
      summary: `${dSaved} daily + ${aSaved} activities`,
      log,
      duration: `${((Date.now()-t0)/1000).toFixed(1)}s`,
    });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message, log });
  }
}
