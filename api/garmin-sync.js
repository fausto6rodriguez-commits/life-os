// api/garmin-sync.js — Vercel serverless function
// Pulls Garmin data and writes to Supabase on demand
// Env vars needed: GARMIN_EMAIL, GARMIN_PASSWORD, GARMIN_OAUTH1, GARMIN_OAUTH2

const SUPA_URL = "https://qghuysyxvjukiwapbijh.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnaHV5c3l4dmp1a2l3YXBiaWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NjAzODgsImV4cCI6MjA5NTMzNjM4OH0.dMmv4TzmVXU-eKRTuoKdFG8D2v1Psb9rqyVHuRLkfdo";

const HEADERS = {
  "apikey": SUPA_KEY,
  "Authorization": `Bearer ${SUPA_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "resolution=merge-duplicates",
};

async function supaUpsert(table, records) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: "POST", headers: HEADERS,
    body: JSON.stringify(Array.isArray(records) ? records : [records]),
  });
  if (!r.ok) {
    const err = await r.text();
    console.error(`Supabase ${table} error ${r.status}:`, err);
    return 0;
  }
  return Array.isArray(records) ? records.length : 1;
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const startTime = Date.now();
  const log = [];

  try {
    // Dynamically import garmin-connect (ESM)
    const { GarminConnect } = await import("garmin-connect");
    const GCClient = new GarminConnect({
      username: process.env.GARMIN_EMAIL,
      password: process.env.GARMIN_PASSWORD,
    });

    // Try stored OAuth tokens first (faster, no login round-trip)
    const oauth1 = process.env.GARMIN_OAUTH1 ? JSON.parse(process.env.GARMIN_OAUTH1) : null;
    const oauth2 = process.env.GARMIN_OAUTH2 ? JSON.parse(process.env.GARMIN_OAUTH2) : null;

    if (oauth1 && oauth2) {
      try {
        GCClient.loadToken(oauth1, oauth2);
        log.push("✓ Loaded cached OAuth tokens");
      } catch(e) {
        log.push("⚠ Cached tokens invalid, logging in fresh");
        await GCClient.login();
      }
    } else {
      await GCClient.login();
      log.push("✓ Logged in with credentials");
    }

    const today = new Date();
    const dailyRecords = [];
    const activityRecords = [];

    // ── Daily summaries (last 7 days) ────────────────────────────────────
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const ds = dateStr(date);
      try {
        const [stats, sleepData] = await Promise.all([
          GCClient.getDailyStats(date).catch(() => null),
          GCClient.getSleepData(date).catch(() => null),
        ]);

        let sleep_hrs, deep_hrs, rem_hrs, light_hrs, sleep_score, avg_spo2, avg_respiration, avg_hr_sleep, sleep_feedback;
        if (sleepData) {
          const dto = sleepData.dailySleepDTO || sleepData;
          if (dto?.sleepWindowConfirmed) {
            sleep_hrs  = dto.sleepTimeSeconds  ? +(dto.sleepTimeSeconds/3600).toFixed(2)  : null;
            deep_hrs   = dto.deepSleepSeconds  ? +(dto.deepSleepSeconds/3600).toFixed(2)  : null;
            rem_hrs    = dto.remSleepSeconds   ? +(dto.remSleepSeconds/3600).toFixed(2)   : null;
            light_hrs  = dto.lightSleepSeconds ? +(dto.lightSleepSeconds/3600).toFixed(2) : null;
            avg_spo2   = dto.averageSpO2Value;
            avg_respiration = dto.averageRespirationValue;
            avg_hr_sleep = dto.averageSpO2HRSleep || dto.avgHeartRate;
            sleep_feedback = dto.sleepScoreFeedback;
            const scores = sleepData.sleepScores;
            sleep_score = scores?.overall?.value ?? scores?.overall ?? dto.sleepScore ?? dto.overallSleepScore;
          }
        }

        dailyRecords.push({
          id: `daily_${ds}`, date: ds,
          steps:               stats?.totalSteps,
          goal_steps:          stats?.dailyStepGoal,
          total_calories:      stats?.totalKilocalories,
          active_calories:     stats?.activeKilocalories,
          resting_hr:          stats?.restingHeartRate,
          stress_avg:          stats?.averageStressLevel,
          stress_max:          stats?.maxStressLevel,
          stress_qualifier:    stats?.stressQualifier,
          sleep_score, sleep_hrs, deep_hrs, rem_hrs, light_hrs,
          avg_spo2, avg_respiration, avg_hr_sleep, sleep_feedback,
          updated_at: new Date().toISOString(),
        });
        log.push(`✓ ${ds}: ${stats?.totalSteps||0} steps${sleep_hrs?`, sleep ${sleep_hrs}h`:""}`);
      } catch(e) {
        log.push(`⚠ ${ds}: ${e.message}`);
      }
    }

    // ── Activities (last 30 days) ─────────────────────────────────────────
    try {
      const activities = await GCClient.getActivities(0, 30);
      for (const act of activities || []) {
        const startTime = act.startTimeLocal || act.startTimeGMT || "";
        const ds = startTime.slice(0, 10) || dateStr(today);
        const duration = act.duration || 0;
        const distance = act.distance || 0;
        const pace = duration && distance > 0 ? (duration/60)/(distance/1000) : null;
        activityRecords.push({
          id:                    `act_${act.activityId}`,
          date:                  ds,
          activity_type:         act.activityType?.typeKey || act.activityType,
          name:                  act.activityName,
          start_time:            startTime,
          duration_seconds:      Math.round(duration) || null,
          distance_meters:       distance || null,
          calories:              act.calories,
          avg_hr:                act.averageHR,
          max_hr:                act.maxHR,
          avg_pace_min_per_km:   pace ? +pace.toFixed(2) : null,
          elevation_gain:        act.elevationGain,
          steps:                 act.steps,
          raw:                   JSON.stringify({ activityId: act.activityId, activityName: act.activityName }),
        });
      }
      log.push(`✓ ${activityRecords.length} activities fetched`);
    } catch(e) {
      log.push(`⚠ Activities: ${e.message}`);
    }

    // ── Write to Supabase ─────────────────────────────────────────────────
    const dSaved = await supaUpsert("health_daily", dailyRecords);
    const aSaved = await supaUpsert("health_activities", activityRecords);
    log.push(`→ Saved: ${dSaved} daily + ${aSaved} activities`);

    res.status(200).json({
      ok: true,
      summary: `${dSaved} daily + ${aSaved} activities`,
      log,
      duration: `${((Date.now()-startTime)/1000).toFixed(1)}s`,
    });

  } catch(e) {
    console.error("Garmin sync error:", e);
    res.status(500).json({ ok: false, error: e.message, log });
  }
}
