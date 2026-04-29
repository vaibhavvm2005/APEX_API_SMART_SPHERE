// src/components/Predictions.js
// Calculates 30-min flood/gas/dryness predictions from sensor history trends

import React, { useMemo } from "react";

// ── Trend calculation from last N values ──────────────────────────────────────
function calcTrend(values) {
  if (!values || values.length < 2) return 0;
  const recent = values.slice(-5);
  const diffs  = recent.slice(1).map((v, i) => v - recent[i]);
  return diffs.reduce((a, b) => a + b, 0) / diffs.length; // avg change per reading
}

function projectValue(current, trendPerReading, minutesAhead, readingIntervalSec = 5) {
  const readings = (minutesAhead * 60) / readingIntervalSec;
  return current + trendPerReading * readings;
}

// ── Single prediction card ─────────────────────────────────────────────────────
function PredCard({ icon, label, probability, explanation, urgency, trend }) {
  const urgencyColor = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444" };
  const color = urgencyColor[urgency] || "#22c55e";
  const pct = Math.min(100, Math.max(0, probability));

  return (
    <div style={{
      background: "#111827",
      border: `1px solid ${color}33`,
      borderRadius: 12,
      padding: "16px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      transition: "transform 0.2s",
    }}
    onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
    onMouseLeave={e => e.currentTarget.style.transform = "translateY(0)"}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>{icon}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
          background: `${color}22`, color, textTransform: "uppercase", letterSpacing: "0.06em"
        }}>{urgency}</span>
      </div>

      {/* Probability bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>30-min probability</span>
          <span style={{ fontSize: 16, fontWeight: 700, color }}>{pct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "#1e293b", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: 3,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            transition: "width 0.8s ease",
          }}/>
        </div>
      </div>

      {/* Trend */}
      {trend !== undefined && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, color: trend > 0 ? "#ef4444" : trend < 0 ? "#22c55e" : "#94a3b8" }}>
            {trend > 0.1 ? "▲" : trend < -0.1 ? "▼" : "→"}
          </span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {Math.abs(trend) < 0.1 ? "Stable" : `${trend > 0 ? "+" : ""}${trend.toFixed(2)} per reading`}
          </span>
        </div>
      )}

      <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, margin: 0 }}>{explanation}</p>
    </div>
  );
}

// ── Main Predictions component ────────────────────────────────────────────────
export default function Predictions({ sensorData, history = {} }) {
  const predictions = useMemo(() => {
    if (!sensorData) return null;
    const { gas_ppm = 0, moisture_pct = 50, water_cm = 0 } = sensorData;

    // Trends from history arrays
    const waterTrend    = calcTrend(history.water    || [water_cm]);
    const gasTrend      = calcTrend(history.gas      || [gas_ppm]);
    const moistureTrend = calcTrend(history.moisture || [moisture_pct]);

    // Project 30 min ahead (readings every 5s → 360 readings in 30 min)
    const waterIn30   = projectValue(water_cm,    waterTrend,    30);
    const gasIn30     = projectValue(gas_ppm,     gasTrend,      30);
    const moistIn30   = projectValue(moisture_pct, moistureTrend, 30);

    // ── Flood ──
    const floodCrit = 70;
    let floodProb = 0;
    let floodExpl = "Water level stable, no flood risk.";
    let floodUrg  = "low";
    if (water_cm >= floodCrit) {
      floodProb = 95; floodExpl = "Water already above flood threshold!"; floodUrg = "high";
    } else if (waterTrend > 0) {
      const minutesToFlood = waterTrend > 0 ? ((floodCrit - water_cm) / waterTrend) * (5/60) : Infinity;
      floodProb = Math.min(95, Math.round((water_cm / floodCrit) * 60 + waterTrend * 20));
      if (minutesToFlood < 30) {
        floodExpl = `Water rising fast — flood expected in ~${Math.round(minutesToFlood)} min.`;
        floodUrg  = minutesToFlood < 10 ? "high" : "medium";
      } else {
        floodExpl = `Water slowly rising. Projected: ${waterIn30.toFixed(1)} cm in 30 min.`;
        floodUrg  = floodProb > 50 ? "medium" : "low";
      }
    } else if (waterTrend < 0) {
      floodProb = Math.max(0, Math.round(floodProb - 15));
      floodExpl = "Water level falling — flood risk reducing.";
    }

    // ── Gas ──
    const gasCrit = 600;
    let gasProb = 0;
    let gasExpl = "Gas levels within safe range.";
    let gasUrg  = "low";
    if (gas_ppm >= gasCrit) {
      gasProb = 95; gasExpl = "Gas already at critical level! Ventilate immediately."; gasUrg = "high";
    } else if (gasTrend > 0) {
      const minutesToCrit = gasTrend > 0 ? ((gasCrit - gas_ppm) / gasTrend) * (5/60) : Infinity;
      gasProb = Math.min(90, Math.round((gas_ppm / gasCrit) * 55 + gasTrend * 5));
      if (minutesToCrit < 30) {
        gasExpl = `Gas rising — critical level in ~${Math.round(minutesToCrit)} min.`;
        gasUrg  = minutesToCrit < 10 ? "high" : "medium";
      } else {
        gasExpl = `Gas slowly increasing. Projected: ${gasIn30.toFixed(0)} ppm in 30 min.`;
        gasUrg  = gasProb > 50 ? "medium" : "low";
      }
    } else {
      gasExpl = `Gas stable or falling. Currently ${gas_ppm.toFixed(0)} ppm.`;
    }

    // ── Dryness ──
    const moistWarn = 20;
    let dryProb = 0;
    let dryExpl = "Soil moisture at healthy levels.";
    let dryUrg  = "low";
    if (moisture_pct <= moistWarn) {
      dryProb = Math.round(100 - moisture_pct * 3);
      dryExpl = moisture_pct < 15
        ? "Soil critically dry — irrigation needed immediately!"
        : "Soil moisture low — consider irrigating soon.";
      dryUrg  = moisture_pct < 15 ? "high" : "medium";
    } else if (moistureTrend < 0) {
      const minutesToDry = Math.abs(moistureTrend) > 0 ? ((moisture_pct - moistWarn) / Math.abs(moistureTrend)) * (5/60) : Infinity;
      dryProb = Math.min(80, Math.round((1 - moisture_pct / 100) * 40 + Math.abs(moistureTrend) * 10));
      if (minutesToDry < 30) {
        dryExpl = `Moisture dropping — dry threshold in ~${Math.round(minutesToDry)} min.`;
        dryUrg  = minutesToDry < 10 ? "high" : "medium";
      } else {
        dryExpl = `Moisture slowly decreasing. Projected: ${moistIn30.toFixed(0)}% in 30 min.`;
      }
    } else {
      dryExpl = `Moisture stable at ${moisture_pct.toFixed(0)}%.`;
    }

    return {
      flood:    { probability: floodProb, explanation: floodExpl, urgency: floodUrg,  trend: waterTrend },
      gas:      { probability: gasProb,   explanation: gasExpl,   urgency: gasUrg,    trend: gasTrend },
      dryness:  { probability: dryProb,   explanation: dryExpl,   urgency: dryUrg,    trend: moistureTrend },
    };
  }, [sensorData, history]);

  if (!predictions) {
    return (
      <div style={{ color: "#64748b", textAlign: "center", padding: 32 }}>
        Waiting for sensor data…
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 700, marginBottom: 16, letterSpacing: "0.04em" }}>
        AI PREDICTIONS — NEXT 30 MINUTES
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <PredCard icon="🌊" label="Flood Risk"   {...predictions.flood}   />
        <PredCard icon="💨" label="Gas Danger"   {...predictions.gas}     />
        <PredCard icon="🌵" label="Soil Dryness" {...predictions.dryness} />
      </div>
    </div>
  );
}