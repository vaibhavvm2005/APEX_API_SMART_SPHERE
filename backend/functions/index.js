/**
 * SmartSphere — Firebase Cloud Functions Backend
 * Handles: MQTT ingestion, AI processing, alert dispatch, history storage
 *
 * Deploy: firebase deploy --only functions
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const axios     = require("axios");

admin.initializeApp();
const db = admin.database();

// ─── Thresholds (mirrors firmware) ────────────────────────────────────────────
const THRESHOLDS = {
  gas:      { warn: 400, crit: 600 },
  water:    { warn: 55,  crit: 70  },
  moisture: { low: 30,   high: 80  },
};

// ─── Risk helpers ─────────────────────────────────────────────────────────────
function getRisk(value, warn, crit) {
  if (value >= crit) return "high";
  if (value >= warn) return "medium";
  return "low";
}

function getMoistureRisk(pct) {
  if (pct < THRESHOLDS.moisture.low || pct > THRESHOLDS.moisture.high) return "medium";
  return "low";
}

function overallRisk(gasRisk, waterRisk, moistureRisk) {
  const scores = { low: 0, medium: 1, high: 2 };
  const max = Math.max(scores[gasRisk], scores[waterRisk], scores[moistureRisk]);
  return ["low", "medium", "high"][max];
}

// ─── AI Anomaly Detection (Statistical) ───────────────────────────────────────
/**
 * Simple Z-score anomaly detection on rolling window.
 * For production, replace with Cloud ML or Vertex AI endpoint.
 */
async function detectAnomaly(nodeId, field, currentValue) {
  const historyRef = db.ref(`history/${nodeId}/${field}`);
  const snap = await historyRef.limitToLast(20).once("value");
  const values = [];
  snap.forEach(child => values.push(child.val().value));

  if (values.length < 5) return { anomaly: false, zscore: 0 };

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
  const zscore = stdDev === 0 ? 0 : Math.abs((currentValue - mean) / stdDev);

  return { anomaly: zscore > 2.5, zscore: parseFloat(zscore.toFixed(2)), mean, stdDev };
}

// ─── Flood Risk Prediction ─────────────────────────────────────────────────────
/**
 * Trend-based flood prediction using linear regression on last N readings.
 * Returns probability (0–100) and ETA in minutes.
 */
async function predictFloodRisk(nodeId) {
  const histRef = db.ref(`history/${nodeId}/water_cm`);
  const snap = await histRef.limitToLast(10).once("value");
  const points = [];
  snap.forEach((child, idx) => points.push({ x: points.length, y: child.val().value }));

  if (points.length < 3) return { probability: 0, etaMinutes: null };

  // Linear regression
  const n = points.length;
  const sumX  = points.reduce((a, p) => a + p.x, 0);
  const sumY  = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const currentLevel = points[points.length - 1].y;
  const critLevel = THRESHOLDS.water.crit;

  let etaMinutes = null;
  let probability = 0;

  if (slope > 0 && currentLevel < critLevel) {
    const stepsToFlood = (critLevel - intercept) / slope;
    const remainingSteps = stepsToFlood - (n - 1);
    etaMinutes = Math.round(remainingSteps * (5 / 60)); // 5s per reading
    probability = Math.min(100, Math.round((currentLevel / critLevel) * 100 + (slope * 10)));
  } else if (currentLevel >= critLevel) {
    probability = 100;
    etaMinutes = 0;
  }

  return { probability, etaMinutes, slope: parseFloat(slope.toFixed(3)) };
}

// ─── AI Recommendation Generator ──────────────────────────────────────────────
function generateRecommendations(data, floodPrediction, anomalies) {
  const recs = [];

  // Gas recommendations
  if (data.gas_risk === "high") {
    recs.push({ priority: "critical", action: "Evacuate area and shut off gas supply immediately. Contact emergency services.", sensor: "gas" });
  } else if (data.gas_risk === "medium" || anomalies.gas?.anomaly) {
    recs.push({ priority: "warning", action: "Increase ventilation. Inspect gas lines and connections. Monitor closely.", sensor: "gas" });
  }

  // Flood / water recommendations
  if (floodPrediction.probability > 75) {
    recs.push({ priority: "critical", action: `Activate flood barriers. Flood predicted in ~${floodPrediction.etaMinutes ?? "?"} minutes. Alert downstream residents.`, sensor: "water" });
  } else if (floodPrediction.probability > 40) {
    recs.push({ priority: "warning", action: "Pre-position drainage pumps. Clear drainage channels. Issue flood watch.", sensor: "water" });
  }

  // Moisture / irrigation recommendations
  if (data.moisture_pct < THRESHOLDS.moisture.low) {
    recs.push({ priority: "info", action: "Soil critically dry. Begin irrigation immediately to prevent crop stress.", sensor: "moisture" });
  } else if (data.moisture_pct > THRESHOLDS.moisture.high) {
    recs.push({ priority: "warning", action: "Soil over-saturated. Halt irrigation. Check drainage. Risk of root rot.", sensor: "moisture" });
  } else if (data.zone === "rural" && data.moisture_pct > 65) {
    recs.push({ priority: "info", action: "Soil moisture optimal. Reduce irrigation frequency to conserve water.", sensor: "moisture" });
  }

  // Anomaly recommendations
  if (anomalies.water?.anomaly && data.water_risk !== "high") {
    recs.push({ priority: "warning", action: `Unusual water level spike detected (Z-score: ${anomalies.water.zscore}). Check sensor and drainage.`, sensor: "water" });
  }

  if (recs.length === 0) {
    recs.push({ priority: "info", action: "All systems nominal. No action required.", sensor: "system" });
  }

  return recs;
}

// ─── HTTP Endpoint: Ingest Sensor Data ────────────────────────────────────────
exports.ingestSensorData = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const data = req.body;
  const { node_id, zone, gas_ppm, moisture_pct, water_cm, timestamp } = data;

  if (!node_id || gas_ppm === undefined || moisture_pct === undefined || water_cm === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await processAndStore(node_id, zone, parseFloat(gas_ppm), parseFloat(moisture_pct), parseFloat(water_cm), timestamp);
    res.json({ status: "ok", node_id });
  } catch (err) {
    console.error("ingestSensorData error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Realtime DB Trigger: Process on write ────────────────────────────────────
exports.onSensorWrite = functions.database.ref("/sensors/{nodeId}/latest").onWrite(async (change, context) => {
  const { nodeId } = context.params;
  const data = change.after.val();
  if (!data) return null;

  return processAndStore(
    nodeId, data.zone,
    parseFloat(data.gas_ppm), parseFloat(data.moisture_pct), parseFloat(data.water_cm),
    data.timestamp
  );
});

// ─── Core Processing Pipeline ─────────────────────────────────────────────────
async function processAndStore(nodeId, zone, gasPPM, moisturePct, waterCm, timestamp) {
  const ts = timestamp || new Date().toISOString();

  // 1. Risk assessment
  const gasRisk      = getRisk(gasPPM, THRESHOLDS.gas.warn, THRESHOLDS.gas.crit);
  const waterRisk    = getRisk(waterCm, THRESHOLDS.water.warn, THRESHOLDS.water.crit);
  const moistureRisk = getMoistureRisk(moisturePct);
  const overall      = overallRisk(gasRisk, waterRisk, moistureRisk);

  // 2. Anomaly detection
  const [gasAnomaly, waterAnomaly, moistureAnomaly] = await Promise.all([
    detectAnomaly(nodeId, "gas_ppm",      gasPPM),
    detectAnomaly(nodeId, "water_cm",     waterCm),
    detectAnomaly(nodeId, "moisture_pct", moisturePct),
  ]);
  const anomalies = { gas: gasAnomaly, water: waterAnomaly, moisture: moistureAnomaly };

  // 3. Flood prediction
  const floodPrediction = await predictFloodRisk(nodeId);

  // 4. AI recommendations
  const recommendations = generateRecommendations(
    { gas_ppm: gasPPM, moisture_pct: moisturePct, water_cm: waterCm, zone,
      gas_risk: gasRisk, water_risk: waterRisk, moisture_risk: moistureRisk },
    floodPrediction, anomalies
  );

  // 5. Build processed record
  const processed = {
    node_id:         nodeId,
    zone:            zone || "unknown",
    timestamp:       ts,
    gas_ppm:         gasPPM,
    moisture_pct:    moisturePct,
    water_cm:        waterCm,
    gas_risk:        gasRisk,
    water_risk:      waterRisk,
    moisture_risk:   moistureRisk,
    overall_risk:    overall,
    flood_probability: floodPrediction.probability,
    flood_eta_min:   floodPrediction.etaMinutes,
    anomalies,
    recommendations,
    processed_at:    new Date().toISOString(),
  };

  // 6. Write to DB
  const updates = {};
  updates[`/nodes/${nodeId}/live`]         = processed;
  updates[`/nodes/${nodeId}/last_updated`] = admin.database.ServerValue.TIMESTAMP;

  // Append to history (capped — use Cloud Scheduler to prune old entries)
  const histKey = db.ref(`history/${nodeId}`).push().key;
  updates[`/history/${nodeId}/${histKey}`] = { timestamp: ts, gas_ppm: gasPPM, moisture_pct: moisturePct, water_cm: waterCm };

  // Per-field history for anomaly detection
  ["gas_ppm", "moisture_pct", "water_cm"].forEach(field => {
    const key = db.ref(`/history/${nodeId}/${field}`).push().key;
    const val = field === "gas_ppm" ? gasPPM : field === "water_cm" ? waterCm : moisturePct;
    updates[`/history/${nodeId}/${field}/${key}`] = { value: val, timestamp: ts };
  });

  // Active alerts
  if (overall === "high") {
    const alertKey = db.ref("/alerts/active").push().key;
    updates[`/alerts/active/${alertKey}`] = {
      node_id: nodeId, zone, severity: "critical",
      message: `High risk detected at ${nodeId}`, timestamp: ts,
      gas_ppm: gasPPM, water_cm: waterCm,
    };
  }

  await db.ref().update(updates);
  console.log(`[${nodeId}] Processed: overall=${overall}, flood=${floodPrediction.probability}%`);

  return processed;
}

// ─── Scheduled: Prune History (runs daily) ───────────────────────────────────
exports.pruneHistory = functions.pubsub.schedule("every 24 hours").onRun(async () => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
  const nodes = ["node_a", "node_b"];
  const fields = ["gas_ppm", "water_cm", "moisture_pct"];

  for (const node of nodes) {
    for (const field of fields) {
      const ref = db.ref(`/history/${node}/${field}`);
      const snap = await ref.orderByChild("timestamp").endAt(new Date(cutoff).toISOString()).once("value");
      const updates = {};
      snap.forEach(child => { updates[child.key] = null; });
      if (Object.keys(updates).length > 0) await ref.update(updates);
    }
  }
  console.log("History pruned.");
  return null;
});

// ─── GET: Dashboard Data API ──────────────────────────────────────────────────
exports.getDashboardData = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.set("Access-Control-Allow-Methods", "GET"); return res.status(204).send(""); }

  try {
    const [nodeA, nodeB, alerts] = await Promise.all([
      db.ref("/nodes/node_a/live").once("value"),
      db.ref("/nodes/node_b/live").once("value"),
      db.ref("/alerts/active").limitToLast(10).once("value"),
    ]);

    const alertList = [];
    alerts.forEach(c => alertList.push(c.val()));

    res.json({
      nodes: { node_a: nodeA.val(), node_b: nodeB.val() },
      alerts: alertList.reverse(),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Node History ────────────────────────────────────────────────────────
exports.getHistory = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  const nodeId = req.query.node || "node_a";
  const limit  = parseInt(req.query.limit) || 50;

  try {
    const snap = await db.ref(`/history/${nodeId}`).limitToLast(limit).once("value");
    const records = [];
    snap.forEach(child => records.push(child.val()));
    res.json({ node_id: nodeId, records: records.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});