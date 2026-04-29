/**
 * SmartSphere Dashboard — src/App.jsx
 * Full production React dashboard
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { initializeApp }    from "firebase/app";
import { getDatabase, ref, onValue, query, limitToLast } from "firebase/database";
import { Chart, registerables } from "chart.js";
import axios from "axios";

Chart.register(...registerables);

// ─── Firebase Setup ──────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:      import.meta.env.VITE_FIREBASE_API_KEY      || "demo",
  authDomain:  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN  || "demo.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://demo-default-rtdb.firebaseio.com",
  projectId:   import.meta.env.VITE_FIREBASE_PROJECT_ID   || "demo",
};
const AI_URL = import.meta.env.VITE_AI_ENGINE_URL || "http://localhost:8080";

let firebaseApp, database;
try {
  firebaseApp = initializeApp(FIREBASE_CONFIG);
  database    = getDatabase(firebaseApp);
} catch { /* demo mode */ }

// ─── Demo data generator (used when Firebase not connected) ──────────────────
const generateDemo = (seed = 0) => ({
  node_a: {
    gas_ppm:       Math.round(380 + 60 * Math.sin(seed * 0.3) + Math.random() * 20),
    moisture_pct:  Math.round(58 + 10 * Math.cos(seed * 0.2) + Math.random() * 5),
    water_cm:      Math.round(62 + 15 * Math.sin(seed * 0.15) + Math.random() * 8),
    gas_risk:      "medium",
    water_risk:    "high",
    overall_risk:  "high",
    zone:          "rural",
    flood_probability: 68,
    recommendations: [
      { priority: "critical", action: "Flood risk detected — deploy barriers and alert downstream residents.", sensor: "water" },
      { priority: "warning",  action: "Gas level rising. Increase ventilation and inspect connections.", sensor: "gas"   },
      { priority: "info",     action: "Soil moisture at 63% — optimal, reduce irrigation frequency.", sensor: "moisture" },
    ],
  },
  node_b: {
    gas_ppm:       Math.round(290 + 40 * Math.sin(seed * 0.25) + Math.random() * 15),
    moisture_pct:  Math.round(45 + 8 * Math.cos(seed * 0.18) + Math.random() * 4),
    water_cm:      Math.round(48 + 10 * Math.sin(seed * 0.12) + Math.random() * 6),
    gas_risk:      "low",
    water_risk:    "medium",
    overall_risk:  "medium",
    zone:          "urban",
    flood_probability: 35,
    recommendations: [
      { priority: "warning", action: "Water level at watch threshold — clear drainage channels.", sensor: "water" },
      { priority: "info",    action: "All gas readings within safe limits.", sensor: "gas" },
    ],
  },
});

const generateAlerts = (seed = 0) => [
  { severity: "critical", node_id: "node_a", message: "Flood threshold exceeded — water at 74 cm", timestamp: "just now" },
  { severity: "warning",  node_id: "node_b", message: "Water level elevated — drainage check needed", timestamp: "2 min ago" },
  { severity: "warning",  node_id: "node_a", message: "Gas level rising — 412 ppm", timestamp: "4 min ago" },
  { severity: "ok",       node_id: "node_a", message: "Soil moisture nominal — irrigation paused", timestamp: "6 min ago" },
];

// ─── Colour helpers ───────────────────────────────────────────────────────────
const RISK_COLOR = { low: "#22d3a0", medium: "#f5a623", high: "#ff4f6a" };
const PRIORITY_COLOR = { critical: "#ff4f6a", warning: "#f5a623", info: "#6378ff", ok: "#22d3a0" };

function riskBadge(level) {
  const colors = { low: { bg: "rgba(34,211,160,0.12)", c: "#22d3a0" },
                   medium: { bg: "rgba(245,166,35,0.12)", c: "#f5a623" },
                   high: { bg: "rgba(255,79,106,0.12)", c: "#ff4f6a" } };
  const s = colors[level] || colors.low;
  return { background: s.bg, color: s.c, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500, display: "inline-block" };
}

// ─── CSS-in-JS base styles ────────────────────────────────────────────────────
const S = {
  wrap:    { background: "#0d0f1a", minHeight: "100vh", padding: "20px 24px", color: "#e8eaf6", fontFamily: "system-ui, sans-serif" },
  header:  { display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "0.5px solid rgba(99,120,255,0.2)", paddingBottom: 16, marginBottom: 20 },
  logoText:{ fontSize: 22, fontWeight: 500, letterSpacing: "0.02em" },
  card:    { background: "#1a1e35", border: "0.5px solid rgba(99,120,255,0.18)", borderRadius: 12, padding: "14px 16px" },
  label:   { fontSize: 11, color: "#8892b0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 },
  grid3:   { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 },
  grid2:   { display: "grid", gridTemplateColumns: "1fr 1fr",        gap: 12, marginBottom: 14 },
  gridMid: { display: "grid", gridTemplateColumns: "2fr 1fr",        gap: 12, marginBottom: 14 },
};

// ─── Sensor Card ──────────────────────────────────────────────────────────────
function SensorCard({ label, value, unit, risk, accentColor, sparkData }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !sparkData?.length) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { labels: sparkData.map((_, i) => i),
              datasets: [{ data: sparkData, borderColor: accentColor, borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
                 plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [sparkData, accentColor]);

  return (
    <div style={{ ...S.card, borderTop: `2px solid ${accentColor}` }}>
      <div style={S.label}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 500, lineHeight: 1 }}>
        {value} <span style={{ fontSize: 13, color: "#8892b0" }}>{unit}</span>
      </div>
      <div style={{ marginTop: 6 }}><span style={riskBadge(risk)}>{risk.charAt(0).toUpperCase() + risk.slice(1)} risk</span></div>
      <div style={{ height: 36, marginTop: 10 }}>
        <canvas ref={canvasRef} role="img" aria-label={`${label} trend sparkline`} />
      </div>
    </div>
  );
}

// ─── Trend Chart ──────────────────────────────────────────────────────────────
function TrendChart({ history }) {
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    const labels = history.map((_, i) => `t-${history.length - 1 - i}`);
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Gas (ppm/10)", data: history.map(h => Math.round(h.gas / 10)), borderColor: "#f5a623", borderWidth: 2, pointRadius: 2, fill: false, tension: 0.4, borderDash: [], pointStyle: "circle" },
          { label: "Moisture (%)", data: history.map(h => h.moisture),             borderColor: "#38bdf8", borderWidth: 2, pointRadius: 2, fill: false, tension: 0.4, borderDash: [4,3], pointStyle: "triangle" },
          { label: "Water (cm)",   data: history.map(h => h.water),                borderColor: "#a259ff", borderWidth: 2, pointRadius: 2, fill: false, tension: 0.4, borderDash: [2,2], pointStyle: "rect" },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false },
                   tooltip: { backgroundColor: "rgba(20,22,40,0.95)", titleColor: "#e8eaf6", bodyColor: "#8892b0" } },
        scales: {
          x: { ticks: { color: "#8892b0", font: { size: 10 }, autoSkip: false, maxRotation: 0 }, grid: { color: "rgba(99,120,255,0.06)" }, border: { color: "rgba(99,120,255,0.1)" } },
          y: { ticks: { color: "#8892b0", font: { size: 10 } }, grid: { color: "rgba(99,120,255,0.06)" }, border: { color: "rgba(99,120,255,0.1)" } },
        }
      }
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [history]);

  return (
    <div style={S.card}>
      <div style={{ ...S.label, display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span>Sensor Trends — last {history.length} readings</span>
        <span style={{ fontSize: 10, color: "#8892b0" }}>
          <span style={{ color: "#f5a623" }}>● Gas</span>
          {"  "}<span style={{ color: "#38bdf8" }}>● Moisture</span>
          {"  "}<span style={{ color: "#a259ff" }}>● Water</span>
        </span>
      </div>
      <div style={{ position: "relative", height: 160 }}>
        <canvas ref={canvasRef} role="img" aria-label="Multi-sensor trend chart over last readings" />
      </div>
    </div>
  );
}

// ─── Risk Meter ───────────────────────────────────────────────────────────────
function RiskMeter({ overall, floodProbability }) {
  const arc = { low: 130, medium: 80, high: 30 };
  const color = RISK_COLOR[overall] || "#22d3a0";
  const offset = arc[overall] ?? 130;
  return (
    <div style={{ ...S.card, display: "flex", flexDirection: "column" }}>
      <div style={S.label}>Overall risk</div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
        <svg width="120" height="72" viewBox="0 0 120 72" role="img" aria-label={`Risk meter showing ${overall} risk`}>
          <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke="rgba(99,120,255,0.12)" strokeWidth="10" strokeLinecap="round"/>
          <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
                strokeDasharray="157" strokeDashoffset={offset} style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.4s ease" }}/>
          <text x="60" y="62" textAnchor="middle" fill="#8892b0" fontSize="10" fontFamily="system-ui">{overall.toUpperCase()}</text>
        </svg>
        <div style={{ fontSize: 22, fontWeight: 500, color, transition: "color 0.4s" }}>{overall.charAt(0).toUpperCase() + overall.slice(1)}</div>
        <div style={{ fontSize: 11, color: "#8892b0", textAlign: "center", lineHeight: 1.5 }}>
          Flood prob: <span style={{ color: floodProbability > 70 ? "#ff4f6a" : floodProbability > 40 ? "#f5a623" : "#22d3a0", fontWeight: 500 }}>{floodProbability}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Alert Panel ──────────────────────────────────────────────────────────────
function AlertPanel({ alerts }) {
  const bg = { critical: "rgba(255,79,106,0.07)", warning: "rgba(245,166,35,0.07)", ok: "rgba(34,211,160,0.06)" };
  const border = { critical: "#ff4f6a", warning: "#f5a623", ok: "#22d3a0" };
  const icon = { critical: "⚠", warning: "◉", ok: "✓" };
  return (
    <div style={S.card}>
      <div style={{ ...S.label, marginBottom: 10 }}>Alert Panel</div>
      {alerts.map((a, i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 10px", borderRadius: 8,
          background: bg[a.severity] || bg.warning, borderLeft: `2px solid ${border[a.severity] || "#f5a623"}`,
          marginBottom: 7, animation: a.severity === "critical" ? "flash 1.8s infinite" : "none" }}>
          <span style={{ fontSize: 13, lineHeight: "1.4", color: border[a.severity] }}>{icon[a.severity] || "◉"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#e8eaf6", marginBottom: 2 }}>{a.message}</div>
            <div style={{ fontSize: 10, color: "#8892b0" }}>{a.node_id} · {a.timestamp}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AI Recommendations ───────────────────────────────────────────────────────
function AIRecommendations({ recs }) {
  return (
    <div style={S.card}>
      <div style={{ ...S.label, marginBottom: 10 }}>AI Recommendations</div>
      {recs.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 10, padding: "8px 10px", borderRadius: 8,
          background: "rgba(99,120,255,0.07)", borderLeft: `2px solid ${PRIORITY_COLOR[r.priority] || "#6378ff"}`, marginBottom: 7 }}>
          <span style={{ fontSize: 12, color: PRIORITY_COLOR[r.priority] || "#6378ff", lineHeight: "1.6" }}>◆</span>
          <div style={{ fontSize: 12, color: "#e8eaf6", lineHeight: 1.6 }}>{r.action}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Zone Cards ───────────────────────────────────────────────────────────────
function ZoneCard({ node, data }) {
  const isRural = data?.zone === "rural";
  const tagStyle = { display: "inline-flex", fontSize: 10, fontWeight: 500, padding: "3px 9px", borderRadius: 20, marginBottom: 10,
    background: isRural ? "rgba(34,211,160,0.1)" : "rgba(99,120,255,0.1)",
    color: isRural ? "#22d3a0" : "#6378ff" };
  const row = (label, val, color) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8892b0",
      padding: "4px 0", borderBottom: "0.5px solid rgba(255,255,255,0.04)" }}>
      <span>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 12, color: color || "#e8eaf6" }}>{val}</span>
    </div>
  );
  if (!data) return <div style={S.card}><div style={S.label}>{node} — loading…</div></div>;
  return (
    <div style={S.card}>
      <div style={tagStyle}>{isRural ? "Rural" : "Urban"} Zone — {node.toUpperCase()}</div>
      {isRural ? <>
        {row("Irrigation", data.moisture_pct > 65 ? "Reduce" : data.moisture_pct < 30 ? "Active" : "Optimal", data.moisture_pct < 30 ? "#f5a623" : "#22d3a0")}
        {row("Flood prediction", data.flood_probability > 70 ? "High" : data.flood_probability > 40 ? "Moderate" : "Low", data.flood_probability > 70 ? "#ff4f6a" : data.flood_probability > 40 ? "#f5a623" : "#22d3a0")}
        {row("Soil status", data.moisture_risk === "medium" ? "Alert" : "Normal", data.moisture_risk === "medium" ? "#f5a623" : "#22d3a0")}
        {row("Crop rec", "Adjust based on moisture", "#38bdf8")}
      </> : <>
        {row("Drainage", data.water_risk === "high" ? "Critical" : data.water_risk === "medium" ? "Watch" : "Clear", data.water_risk === "high" ? "#ff4f6a" : data.water_risk === "medium" ? "#f5a623" : "#22d3a0")}
        {row("Gas safety", data.gas_risk === "high" ? "Critical" : data.gas_risk === "medium" ? "Monitor" : "Safe", data.gas_risk === "high" ? "#ff4f6a" : data.gas_risk === "medium" ? "#f5a623" : "#22d3a0")}
        {row("Public safety", data.overall_risk === "high" ? "Alert" : "Normal", data.overall_risk === "high" ? "#ff4f6a" : "#22d3a0")}
        {row("Maintenance", data.water_risk !== "low" ? "Drain check" : "None needed", data.water_risk !== "low" ? "#f5a623" : "#8892b0")}
      </>}
    </div>
  );
}

// ─── What-if Simulation ───────────────────────────────────────────────────────
function Simulation({ zone }) {
  const [gas, setGas]       = useState(400);
  const [water, setWater]   = useState(60);
  const [moist, setMoist]   = useState(60);
  const [result, setResult] = useState("Adjust sliders to simulate different sensor states and see AI predictions.");
  const [loading, setLoading] = useState(false);

  const simulate = useCallback(async (g, w, m) => {
    setLoading(true);
    try {
      const res = await axios.post(`${AI_URL}/simulate`, {
        node_id: "sim", zone, gas_ppm: g, moisture_pct: m, water_cm: w
      });
      const d = res.data;
      setResult(
        `Gas: ${d.gas_risk} risk. Water: ${d.water_risk} risk. ` +
        (d.flood_prediction?.probability > 0 ? `Flood probability: ${d.flood_prediction.probability}%. ` : "") +
        (d.irrigation?.message || "")
      );
    } catch {
      // Offline fallback
      const parts = [];
      if (g > 600) parts.push("Gas CRITICAL — evacuate and shut off supply.");
      else if (g > 400) parts.push(`Gas at ${g} ppm — ventilation needed.`);
      else parts.push(`Gas at ${g} ppm — safe.`);
      if (w > 70) parts.push(`Water ${w} cm — FLOOD threshold exceeded! Deploy barriers.`);
      else if (w > 55) parts.push(`Water ${w} cm — elevated, monitor closely.`);
      else parts.push(`Water ${w} cm — normal.`);
      if (m < 30) parts.push("Soil critically dry — irrigate immediately.");
      else if (m > 80) parts.push("Soil over-saturated — halt irrigation.");
      else parts.push(`Soil ${m}% — optimal.`);
      setResult(parts.join(" "));
    }
    setLoading(false);
  }, [zone]);

  useEffect(() => { simulate(gas, water, moist); }, [gas, water, moist]);

  const sliderStyle = { accentColor: "#6378ff", width: "100%" };
  return (
    <div style={S.card}>
      <div style={{ ...S.label, marginBottom: 12 }}>What-if Simulation</div>
      {[
        { label: "Gas (ppm)", val: gas, set: setGas, min: 0, max: 1000 },
        { label: "Water (cm)", val: water, set: setWater, min: 0, max: 120 },
        { label: "Soil moisture (%)", val: moist, set: setMoist, min: 0, max: 100 },
      ].map(({ label, val, set, min, max }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#8892b0", width: 120, flexShrink: 0 }}>{label}</span>
          <input type="range" min={min} max={max} value={val} step={1}
                 onChange={e => set(Number(e.target.value))} style={sliderStyle} />
          <span style={{ fontSize: 12, color: "#6378ff", fontWeight: 500, width: 36, textAlign: "right" }}>{val}</span>
        </div>
      ))}
      <div style={{ background: "rgba(99,120,255,0.08)", border: "0.5px solid rgba(99,120,255,0.2)", borderRadius: 8,
        padding: "10px 12px", fontSize: 12, color: "#e8eaf6", lineHeight: 1.7, marginTop: 4 }}>
        {loading ? "Analyzing…" : result}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [nodes, setNodes]     = useState(generateDemo(0));
  const [alerts, setAlerts]   = useState(generateAlerts(0));
  const [history, setHistory] = useState(() => {
    const h = [];
    for (let i = 0; i < 12; i++) {
      h.push({ gas: 360 + i * 5 + Math.random() * 20, moisture: 60 + Math.random() * 6, water: 58 + i * 1.2 + Math.random() * 5 });
    }
    return h;
  });
  const [clock, setClock]     = useState("");
  const seedRef               = useRef(0);

  // ── Live clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setClock(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Firebase listener OR demo tick ──────────────────────────────────────────
  useEffect(() => {
    if (database) {
      const nodeARef = ref(database, "/nodes/node_a/live");
      const nodeBRef = ref(database, "/nodes/node_b/live");
      const alertRef = query(ref(database, "/alerts/active"), limitToLast(6));

      const unsubA = onValue(nodeARef, snap => { if (snap.val()) setNodes(n => ({ ...n, node_a: snap.val() })); });
      const unsubB = onValue(nodeBRef, snap => { if (snap.val()) setNodes(n => ({ ...n, node_b: snap.val() })); });
      const unsubAl = onValue(alertRef, snap => {
        const arr = [];
        snap.forEach(c => arr.push(c.val()));
        if (arr.length) setAlerts(arr.reverse());
      });
      return () => { unsubA(); unsubB(); unsubAl(); };
    } else {
      // Demo mode: update every 2.5s
      const id = setInterval(() => {
        seedRef.current += 1;
        const demo = generateDemo(seedRef.current);
        setNodes(demo);
        setHistory(prev => {
          const next = [...prev.slice(1), {
            gas:      demo.node_a.gas_ppm,
            moisture: demo.node_a.moisture_pct,
            water:    demo.node_a.water_cm,
          }];
          return next;
        });
      }, 2500);
      return () => clearInterval(id);
    }
  }, []);

  const na = nodes.node_a;
  const nb = nodes.node_b;

  const gasSparkData   = history.map(h => h.gas);
  const moistSparkData = history.map(h => h.moisture);
  const waterSparkData = history.map(h => h.water);

  return (
    <>
      <style>{`
        @keyframes flash { 0%,100%{opacity:1} 50%{opacity:0.5} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0f1a; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(99,120,255,0.3); border-radius: 3px; }
      `}</style>

      <div style={S.wrap}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#6378ff,#a259ff)",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="white">
                <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 2a6 6 0 014.5 10.05l-8.55-8.55A5.97 5.97 0 0110 4zm-4.5 1.95l8.55 8.55A6 6 0 015.5 5.95z"/>
              </svg>
            </div>
            <span style={S.logoText}>Smart<span style={{ color: "#6378ff" }}>Sphere</span></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8892b0" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22d3a0", animation: "flash 2s infinite" }} />
            <span>Live — ESP8266 nodes connected</span>
            <span style={{ color: "#6378ff", marginLeft: 12 }}>{clock}</span>
            {!database && <span style={{ color: "#f5a623", marginLeft: 8, fontSize: 10 }}>DEMO MODE</span>}
          </div>
        </div>

        {/* Sensor Cards */}
        <div style={S.grid3}>
          <SensorCard label="Gas Sensor (MQ-2)"    value={na?.gas_ppm ?? 0}      unit="ppm" risk={na?.gas_risk ?? "low"}      accentColor="#f5a623" sparkData={gasSparkData} />
          <SensorCard label="Soil Moisture"         value={na?.moisture_pct ?? 0}  unit="%"   risk={na?.moisture_risk ?? "low"}  accentColor="#38bdf8" sparkData={moistSparkData} />
          <SensorCard label="Water Level"           value={na?.water_cm ?? 0}      unit="cm"  risk={na?.water_risk ?? "low"}     accentColor="#a259ff" sparkData={waterSparkData} />
        </div>

        {/* Trend + Risk */}
        <div style={S.gridMid}>
          <TrendChart history={history} />
          <RiskMeter overall={na?.overall_risk ?? "low"} floodProbability={na?.flood_probability ?? 0} />
        </div>

        {/* Zone Cards */}
        <div style={S.grid2}>
          <ZoneCard node="node_a" data={na} />
          <ZoneCard node="node_b" data={nb} />
        </div>

        {/* Alerts + AI */}
        <div style={S.grid2}>
          <AlertPanel alerts={alerts} />
          <AIRecommendations recs={na?.recommendations ?? []} />
        </div>

        {/* Simulation */}
        <Simulation zone={na?.zone ?? "rural"} />

        {/* System Flow */}
        <div style={{ ...S.card, marginTop: 14 }}>
          <div style={{ ...S.label, marginBottom: 12 }}>System data flow</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 0 }}>
            {["Gas / Moisture / Ultrasonic", "ESP8266 Wi-Fi", "MQTT / REST API", "Firebase RTDB", "AI Engine", "Dashboard + Alerts"].map((step, i, arr) => (
              <div key={i} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ fontSize: 10, color: "#e8eaf6", background: "rgba(99,120,255,0.1)",
                  border: "0.5px solid rgba(99,120,255,0.3)", borderRadius: 6, padding: "5px 10px", textAlign: "center", whiteSpace: "pre-line" }}>
                  {step}
                </div>
                {i < arr.length - 1 && <span style={{ color: "#6378ff", fontSize: 14, margin: "0 4px" }}>→</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}