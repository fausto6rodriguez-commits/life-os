// Granola proxy — uses Claude with Granola MCP to fetch meeting data
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { action, meeting_id, contact_name, project_name, time_range } = req.body;

  let prompt;
  if (action === "list") {
    prompt = `Use the Granola list_meetings tool to get meetings from "${time_range || "this_week"}". Return ONLY a JSON array like: [{"id":"...","title":"...","date":"...","attendees":"..."}]. No other text.`;
  } else if (action === "get_for_contact") {
    prompt = `Use Granola list_meetings for "last_30_days", find meetings that involve or mention "${contact_name}". Then use get_meetings to get the details of the most relevant one. Return ONLY JSON: {"title":"...","date":"...","summary":"...","notes":"...","transcript_snippet":"..."}. No other text.`;
  } else if (action === "get_meeting") {
    prompt = `Use Granola get_meetings with meeting_id "${meeting_id}" to get full details including summary and notes. Return ONLY JSON: {"title":"...","date":"...","summary":"...","notes":"..."}. No other text.`;
  } else if (action === "get_transcript") {
    prompt = `Use Granola get_meeting_transcript with meeting_id "${meeting_id}". Return the full transcript as plain text only, no JSON wrapper.`;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        mcp_servers: [{
          type: "url",
          url: "https://mcp.granola.ai/mcp",
          name: "granola"
        }],
        messages: [{ role: "user", content: prompt }]
      }),
    });
    const data = await response.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    res.status(200).json({ result: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
