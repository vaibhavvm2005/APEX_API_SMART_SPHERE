// functions/index.js
// SmartSphere Cloud Function — Claude 3 Haiku chatbot + risk predictor
//
// Deploy:
//   cd functions
//   npm install
//   firebase functions:config:set anthropic.key="YOUR_ANTHROPIC_API_KEY"
//   firebase deploy --only functions

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const axios     = require("axios");

admin.initializeApp();

// ── System prompt for Claude ──────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are SmartSphere AI, an expert environmental monitoring assistant for an IoT system tracking gas levels, soil moisture, and water levels.

Your capabilities:
1. PREDICTION MODE: When asked to predict risks, respond with STRICT JSON only (no markdown, no text outside JSON):
{
  "flood":    { "probability": 0-100, "explanation": "brief", "urgency": "low|medium|high" },
  "gas":      { "probability": 0-100, "explanation": "brief", "urgency": "low|medium|high" },
  "dryness":  { "probability": 0-100, "explanation": "brief", "urgency": "low|medium|high" },
  "recommendedAction": "single most important action"
}

2. CONVERSATIONAL MODE: For questions about sensors, respond in plain English. Be concise (2-3 sentences max).

Thresholds:
- Water: warning >55cm, critical >70cm
- Gas: warning >400ppm, critical >600ppm  
- Moisture: warning <20%, critical <15%

Base all predictions on CURRENT VALUES + TREND DIRECTION. Be specific with numbers.`;

// ── Cloud Function ────────────────────────────────────────────────────────────
exports.smartsphereChat = functions
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {

    // CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

    const { userMessage, sensorData, trends, chatHistory = [], isPredictMode } = req.body;

    if (!userMessage) return res.status(400).json({ error: "userMessage required" });

    // Get Anthropic API key from environment
    const ANTHROPIC_KEY = functions.config().anthropic?.key
      || process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: "Anthropic API key not configured. Run: firebase functions:config:set anthropic.key=YOUR_KEY" });
    }

    // Build context message
    const contextMsg = sensorData
      ? `Current sensor readings:
- Gas: ${sensorData.gas_ppm?.toFixed(1) ?? "N/A"} ppm (trend: ${trends?.gasTrend > 0 ? "+" : ""}${trends?.gasTrend?.toFixed(2) ?? "0"}/reading)
- Water: ${sensorData.water_cm?.toFixed(1) ?? "N/A"} cm (trend: ${trends?.waterTrend > 0 ? "+" : ""}${trends?.waterTrend?.toFixed(2) ?? "0"}/reading)
- Moisture: ${sensorData.moisture_pct?.toFixed(1) ?? "N/A"} % (trend: ${trends?.moistureTrend > 0 ? "+" : ""}${trends?.moistureTrend?.toFixed(2) ?? "0"}/reading)

${isPredictMode ? "Predict all risks for the next 30 minutes using the JSON format." : userMessage}`
      : userMessage;

    // Build messages array for Claude
    const messages = [
      // Include last 4 turns of chat history
      ...chatHistory.slice(-4).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: contextMsg },
    ];

    try {
      const response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model:      "claude-3-haiku-20240307",
          max_tokens: 600,
          system:     SYSTEM_PROMPT,
          messages,
        },
        {
          headers: {
            "x-api-key":         ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
          },
          timeout: 25000,
        }
      );

      const text = response.data.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("");

      // Log usage
      console.log(`[smartsphereChat] tokens: ${response.data.usage?.input_tokens}in/${response.data.usage?.output_tokens}out`);

      return res.json({ response: text, model: "claude-3-haiku-20240307" });

    } catch (err) {
      console.error("[smartsphereChat] Error:", err.response?.data || err.message);
      const status = err.response?.status || 500;
      return res.status(status).json({
        error: err.response?.data?.error?.message || err.message
      });
    }
  });

// ── Optional: Sensor analytics function ──────────────────────────────────────
exports.getSensorStats = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const nodeId = req.query.node || "node_a";
  try {
    const snap = await admin.database().ref(`/sensors/${nodeId}`).once("value");
    const data = snap.val();
    if (!data) return res.json({ error: "No data found" });

    const risk = calcRisk(data);
    return res.json({ node: nodeId, data, risk });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

function calcRisk(data) {
  const { gas_ppm = 0, water_cm = 0, moisture_pct = 100 } = data;
  let score = 0;
  if (water_cm > 70)    score += 40; else if (water_cm > 55) score += 20;
  if (gas_ppm > 600)    score += 40; else if (gas_ppm > 400) score += 20;
  if (moisture_pct < 15) score += 20; else if (moisture_pct < 20) score += 10;
  return { score: Math.min(score, 100), level: score >= 60 ? "critical" : score >= 30 ? "warning" : "safe" };
}