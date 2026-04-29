// src/App.js
// SmartSphere — Live IoT Dashboard (no demo fallback)

import React, { useState, useEffect } from "react";
import { db } from "./firebase";
import { ref, onValue } from "firebase/database";
import { Line } from "react-chartjs-2";
import { Toaster } from "react-hot-toast";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from "chart.js";

import useAlertSystem, { calcRiskScore, riskColor, riskLabel, THRESHOLDS } from "./hooks/useAlertSystem";
import Predictions  from "./components/Predictions";
import NodeMap      from "./components/NodeMap";
import Simulator    from "./components/Simulator";
import AIChatbot    from "./components/AIChatbot";
import Logo from "./components/Logo";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// ── Sensor card ───────────────────────────────────────────────────────────────
function SensorCard({ icon, label, value, unit, warn, crit, trend }) {
  const isLow = label === "Moisture";
  const atCrit   = isLow ? value < crit : value > crit;
  const atWarn   = isLow ? value < warn : value > warn;
  const color    = atCrit ? "#ef4444" : atWarn ? "#f59e0b" : "#22c55e";
  const trendDir = trend > 0.1 ? "▲" : trend < -0.1 ? "▼" : "→";
  const trendClr = isLow
    ? (trend < -0.1 ? "#ef4444" : trend > 0.1 ? "#22c55e" : "#94a3b8")
    : (trend > 0.1 ? "#ef4444" : trend < -0.1 ? "#22c55e" : "#94a3b8");

  return (
    <div style={{
      background: "#111827",
      border: `1px solid ${color}33`,
      borderRadius: 14,
      padding: "18px 20px",
      position: "relative",
      overflow: "hidden",
      transition: "transform 0.2s, box-shadow 0.2s",
    }}
    onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${color}22`; }}
    onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)";    e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "14px 14px 0 0" }}/>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 32, fontWeight: 700, color, fontFamily: "monospace", lineHeight: 1 }}>
            {typeof value === "number" ? value.toFixed(1) : "—"}
            <span style={{ fontSize: 14, fontWeight: 400, color: "#64748b", marginLeft: 3 }}>{unit}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: 22, color: trendClr }}>{trendDir}</span>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
            warn: {warn}{unit}<br/>crit: {crit}{unit}
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
          background: `${color}22`, color, textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          {atCrit ? "Critical" : atWarn ? "Warning" : "Normal"}
        </span>
      </div>
    </div>
  );
}

// ── Risk gauge ────────────────────────────────────────────────────────────────
function RiskGauge({ score }) {
  const color  = riskColor(score);
  const label  = riskLabel(score);
  const r = 54, circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Overall risk ${score}%`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#1e293b" strokeWidth="12"/>
        <circle cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 0.7s ease, stroke 0.4s ease" }}
        />
        <text x="70" y="64" textAnchor="middle" fill="#e2e8f0" fontSize="26" fontWeight="700" fontFamily="monospace">{score}</text>
        <text x="70" y="84" textAnchor="middle" fill={color}    fontSize="12" fontWeight="600">{label.toUpperCase()}</text>
      </svg>
      <div style={{ fontSize: 11, color: "#64748b" }}>Overall Risk Score</div>
    </div>
  );
}

// ── Trend chart ───────────────────────────────────────────────────────────────
function TrendChart({ history }) {
  const labels = history.timestamps?.map((_, i) => `t-${history.timestamps.length - 1 - i}`) || [];
  const data = {
    labels,
    datasets: [
      {
        label: "Gas (ppm/10)", data: (history.gas || []).map(v => v / 10),
        borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.05)",
        borderWidth: 2, pointRadius: 2, tension: 0.4, fill: true,
      },
      {
        label: "Moisture (%)", data: history.moisture || [],
        borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.05)",
        borderWidth: 2, pointRadius: 2, tension: 0.4, fill: true, borderDash: [4,3],
      },
      {
        label: "Water (cm)", data: history.water || [],
        borderColor: "#a78bfa", backgroundColor: "rgba(167,139,250,0.05)",
        borderWidth: 2, pointRadius: 2, tension: 0.4, fill: true, borderDash: [2,2],
      },
    ],
  };
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: {
      legend: { labels: { color: "#94a3b8", font: { size: 11 }, boxWidth: 20 } },
      tooltip: { backgroundColor: "rgba(15,23,42,0.95)", titleColor: "#e2e8f0", bodyColor: "#94a3b8", borderColor: "#334155", borderWidth: 1 },
    },
    scales: {
      x: { ticks: { color: "#475569", font: { size: 10 } }, grid: { color: "#1e293b" } },
      y: { ticks: { color: "#475569", font: { size: 10 } }, grid: { color: "#1e293b" } },
    },
  };
  return (
    <div style={{ height: 200, position: "relative" }}>
      <Line data={data} options={opts} />
    </div>
  );
}

// ── Helper: sanitise negative water ──────────────────────────────────────────
function sanitiseNodeData(raw) {
  if (!raw) return null;
  return {
    gas_ppm: Math.max(0, raw.gas_ppm ?? 0),
    moisture_pct: Math.min(100, Math.max(0, raw.moisture_pct ?? 0)),
    water_cm: Math.max(0, raw.water_cm ?? 0),
    location: raw.location,
  };
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [activeNode, setActiveNode] = useState("node_a");
  const [nodesData,  setNodesData]  = useState({ node_a: null, node_b: null });
  const [history,    setHistory]    = useState({ gas: [], moisture: [], water: [], timestamps: [] });
  const [isSimMode,  setIsSimMode]  = useState(false);
  const [simData,    setSimData]    = useState(null);
  const [liveError,  setLiveError]  = useState(null);

  // ── Firebase listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    const nodeARef = ref(db, "/sensors/node_a");
    const nodeBRef = ref(db, "/sensors/node_b");

    const unsubA = onValue(nodeARef, 
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.val();
          setNodesData(prev => ({ ...prev, node_a: sanitiseNodeData(raw) }));
          setLiveError(null);
        } else {
          setLiveError("Node A: No data in Firebase. Please add sensor data.");
        }
      },
      (error) => {
        console.error("Firebase node_a error:", error);
        setLiveError(`Firebase error: ${error.message}`);
      }
    );

    const unsubB = onValue(nodeBRef, 
      (snapshot) => {
        if (snapshot.exists()) {
          const raw = snapshot.val();
          setNodesData(prev => ({ ...prev, node_b: sanitiseNodeData(raw) }));
        } else {
          console.warn("Node B has no data yet");
        }
      },
      (error) => console.error("Firebase node_b error:", error)
    );

    return () => {
      unsubA();
      unsubB();
    };
  }, []);

  // ── Update history when current node data changes ───────────────────────────
  const currentRaw = nodesData[activeNode];
  useEffect(() => {
    if (!currentRaw) return;
    const { gas_ppm, moisture_pct, water_cm } = currentRaw;
    setHistory(prev => {
      const push = (arr, val) => [...arr.slice(-19), val];
      return {
        gas:        push(prev.gas,        gas_ppm),
        moisture:   push(prev.moisture,   moisture_pct),
        water:      push(prev.water,      water_cm),
        timestamps: push(prev.timestamps, Date.now()),
      };
    });
  }, [currentRaw]);

  // ── Determine displayed data (live or simulation) ───────────────────────────
  const displayData = (isSimMode && simData) ? simData : currentRaw;

  // ── Risk score (current data) ───────────────────────────────────────────────
  const riskScore = calcRiskScore(displayData);
  const isCritical = riskScore >= 60;

  // ── Calculate trends for sensor cards ───────────────────────────────────────
  const trend = (arr) => arr.length < 2 ? 0 : arr[arr.length - 1] - arr[arr.length - 2];

  // ── Loading state ───────────────────────────────────────────────────────────
  if (!nodesData.node_a && !nodesData.node_b && !liveError) {
    return (
      <div style={{
        background: "#0a0c12", minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontFamily: "monospace"
      }}>
        <div style={{ textAlign: "center" }}>
          <div>⏳ Connecting to Firebase...</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 12 }}>Make sure your database has data at /sensors/node_a</div>
        </div>
      </div>
    );
  }

  if (liveError && !nodesData.node_a) {
    return (
      <div style={{
        background: "#0a0c12", minHeight: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontFamily: "monospace"
      }}>
        <div style={{ background: "#1e293b", padding: 24, borderRadius: 16, maxWidth: 500, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Live Data Unavailable</div>
          <div style={{ fontSize: 14, color: "#94a3b8" }}>{liveError}</div>
          <div style={{ marginTop: 16, fontSize: 12, color: "#64748b" }}>
            Check your Firebase config and security rules (".read": true)
          </div>
        </div>
      </div>
    );
  }

  // ── Main dashboard render (live data present) ───────────────────────────────
  return (
    <div style={{
      background: "#0a0c12",
      minHeight: "100vh",
      fontFamily: "'Space Mono', 'Courier New', monospace",
      color: "#e2e8f0",
      animation: isCritical ? "critFlash 2s infinite" : "none",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        @keyframes critFlash { 0%,100%{background:#0a0c12} 50%{background:#1a0c0c} }
        @keyframes fadeIn    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        .card { animation: fadeIn 0.4s ease; }
      `}</style>

      <Toaster position="top-right" toastOptions={{ style: { background: "#111827", color: "#e2e8f0", border: "1px solid #334155" } }} />

      {/* Header */}
      <header style={{
        background: "#0d111c",
        borderBottom: "1px solid #1e293b",
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Logo width={48} height={48} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.06em" }}>
              SmartSphere
            </div>
            <div style={{ fontSize: 10, color: "#22c55e", letterSpacing: "0.08em" }}>
              ● LIVE (Firebase)
            </div>
          </div>
        </div>

        {/* Node selector */}
        <div style={{ display: "flex", gap: 8 }}>
          {["node_a", "node_b"].map(n => {
            const d = nodesData[n];
            const s = d ? calcRiskScore(d) : 0;
            const c = riskColor(s);
            return (
              <button key={n} onClick={() => setActiveNode(n)} style={{
                background: activeNode === n ? "#111827" : "transparent",
                border: `1px solid ${activeNode === n ? c : "#334155"}`,
                borderRadius: 8, padding: "8px 16px", color: activeNode === n ? c : "#94a3b8",
                cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
              }}>
                <span style={{ marginRight: 6 }}>{n === "node_a" ? "🌾" : "🏙️"}</span>
                {n.replace("_", " ").toUpperCase()}
                <span style={{ marginLeft: 8, fontSize: 10, color: c }}>{s}%</span>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: "#475569" }} id="clock"/>
      </header>

      {/* Main content */}
      <main style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>

        {/* Sensor cards + risk gauge */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }} className="card">
          <SensorCard icon="💨" label="Gas"      value={displayData?.gas_ppm}      unit=" ppm" warn={THRESHOLDS.gas.warning}      crit={THRESHOLDS.gas.critical}      trend={trend(history.gas)}      />
          <SensorCard icon="🌱" label="Moisture" value={displayData?.moisture_pct} unit="%"    warn={THRESHOLDS.moisture.warning}  crit={THRESHOLDS.moisture.critical}  trend={trend(history.moisture)} />
          <SensorCard icon="🌊" label="Water"    value={displayData?.water_cm}     unit=" cm"  warn={THRESHOLDS.water.warning}     crit={THRESHOLDS.water.critical}     trend={trend(history.water)}    />
          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: 18, display: "flex", justifyContent: "center", alignItems: "center" }}>
            <RiskGauge score={riskScore} />
          </div>
        </div>

        {/* Trend chart */}
        <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: 20, marginBottom: 20 }} className="card">
          <h3 style={{ fontSize: 13, color: "#64748b", letterSpacing: "0.06em", marginBottom: 14 }}>SENSOR TRENDS — LAST 20 READINGS</h3>
          <TrendChart history={history} />
        </div>

        {/* Middle row: Predictions + Map */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: 20 }} className="card">
            <Predictions sensorData={displayData} history={history} />
          </div>
          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: 20 }} className="card">
            <NodeMap nodesData={nodesData} />
          </div>
        </div>

        {/* Bottom row: Simulator + Chatbot */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: 20 }} className="card">
            <Simulator
              liveData={currentRaw}
              isSimMode={isSimMode}
              onToggleMode={() => setIsSimMode(v => !v)}
              onSimDataChange={setSimData}
            />
          </div>
          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column" }} className="card">
            <AIChatbot sensorData={displayData} history={history} />
          </div>
        </div>

      </main>

      <ClockUpdater />
    </div>
  );
}

// ── Clock updater component ───────────────────────────────────────────────────
function ClockUpdater() {
  useEffect(() => {
    const tick = () => {
      const el = document.getElementById("clock");
      if (el) el.textContent = new Date().toLocaleTimeString();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}