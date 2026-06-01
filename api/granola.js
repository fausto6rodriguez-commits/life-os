// Granola proxy — calls public-api.granola.ai directly with Bearer token
// Env vars: GRANOLA_ACCESS_TOKEN, GRANOLA_REFRESH_TOKEN

let cachedToken = null;
let tokenObtainedAt = null;
const TOKEN_TTL = 5 * 60 * 60 * 1000; // 5 hours (tokens last 6, refresh before expiry)

async function getToken() {
  // Return cached token if still fresh
  if (cachedToken && tokenObtainedAt && (Date.now() - tokenObtainedAt) < TOKEN_TTL) {
    return cachedToken;
  }

  // Try to refresh using Granola's WorkOS token endpoint
  const refreshToken = process.env.GRANOLA_REFRESH_TOKEN;
  if (refreshToken) {
    try {
      // WorkOS uses a simple refresh — try the Granola API auth endpoint
      const res = await fetch("https://api.granola.ai/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.access_token) {
          cachedToken = data.access_token;
          tokenObtainedAt = Date.now();
          return cachedToken;
        }
      }
    } catch(e) { /* fall through to env token */ }
  }

  // Fall back to env token
  cachedToken = process.env.GRANOLA_ACCESS_TOKEN;
  tokenObtainedAt = Date.now();
  return cachedToken;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { action, note_id, page_size, cursor, created_after } = req.body;
  const token = await getToken();

  if (!token) {
    res.status(401).json({ error: "No Granola token configured" });
    return;
  }

  try {
    let url;

    if (action === "list") {
      const params = new URLSearchParams({ page_size: page_size || 20 });
      if (cursor) params.set("cursor", cursor);
      if (created_after) params.set("created_after", created_after);
      url = `https://public-api.granola.ai/v1/notes?${params}`;
    } else if (action === "get") {
      url = `https://public-api.granola.ai/v1/notes/${note_id}?include=transcript`;
    } else {
      res.status(400).json({ error: "Unknown action" }); return;
    }

    const response = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (response.status === 401) {
      // Force token refresh next call
      cachedToken = null;
      tokenObtainedAt = null;
      res.status(401).json({ error: "Token expired — please update GRANOLA_ACCESS_TOKEN in Vercel" });
      return;
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
