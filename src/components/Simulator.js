// src/components/Simulator.js
// What-if simulation — sliders adjust sensor values, updates risk + recommendations

import React, { useState, useCallback } from "react";
import { calcRiskScore, riskColor, riskLabel, THRESHOLDS } from "../hooks/useAlertSystem";

// ── Risk gauge ────────────────────────────────────────────────────────────────
function RiskGauge({ score }) {
  const color  = riskColor(score);
  const label  = riskLabel(score);
  const radius = 52;
  const circ   = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width="130" height="130" viewBox="0 0 130 130" role="img" aria-label={`Risk gauge showing ${score}% ${label} risk`}>
        {/* Track */}
        <circle cx="65" cy="65" r={radius} fill="none" stroke="#1e293b" strokeWidth="10"/>
        {/* Progress */}
        <circle cx="65" cy="65" r={radius} fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 65 65)"
          style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.4s ease" }}
        />
        <text x="65" y="60" textAnchor="middle" fill="#e2e8f0" fontSize="22" fontWeight="700" fontFamily="monospace">{score}</text>
        <text x="65" y="78" textAnchor="middle" fill={color}    fontSize="11" fontWeight="600">{label.toUpperCase()}</text>
      </svg>
    </div>
  );
}

// ── AI rule-based recommendations ─────────────────────────────────────────────
function getRecommendations(data) {
  const recs = [];
  const { gas_ppm, moisture_pct, water_cm } = data;

  if (water_cm > THRESHOLDS.water.critical)
    recs.push({ icon: "🚨", text: "CRITICAL: Deploy flood barriers immediately. Alert downstream residents.", color: "#ef4444" });
  else if (water_cm > THRESHOLDS.water.warning)
    recs.push({ icon: "⚠️", text: "Water elevated — pre-position pumps and clear drainage channels.", color: "#f59e0b" });

  if (gas_ppm > THRESHOLDS.gas.critical)
    recs.push({ icon: "🚨", text: "CRITICAL: Gas dangerous — evacuate area and shut off supply.", color: "#ef4444" });
  else if (gas_ppm > THRESHOLDS.gas.warning)
    recs.push({ icon: "💨", text: "Gas rising — increase ventilation, inspect gas lines.", color: "#f59e0b" });

  if (moisture_pct < THRESHOLDS.moisture.critical)
    recs.push({ icon: "🌵", text: "CRITICAL: Soil very dry — begin irrigation immediately.", color: "#ef4444" });
  else if (moisture_pct < THRESHOLDS.moisture.warning)
    recs.push({ icon: "🌱", text: "Soil drying — schedule irrigation within 2 hours.", color: "#f59e0b" });
  else if (moisture_pct > 80 && water_cm < THRESHOLDS.water.warning)
    recs.push({ icon: "💧", text: "Soil well-saturated — pause irrigation to avoid waterlogging.", color: "#22c55e" });

  if (recs.length === 0)
    recs.push({ icon: "✅", text: "All parameters nominal — no action required.", color: "#22c55e" });

  return recs;
}

// ── Slider row ────────────────────────────────────────────────────────────────
function SliderRow({ label, icon, value, min, max, step, unit, warn, crit, onChange }) {
  const pct   = ((value - min) / (max - min)) * 100;
  const color = value > crit ? "#ef4444" : value > warn ? "#f59e0b" : "#22c55e";

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>{icon} {label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "monospace" }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: "100%", accentColor: color, cursor: "pointer",
          height: 6, borderRadius: 3,
        }}
        aria-label={`${label} slider`}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 10, color: "#475569" }}>{min}{unit}</span>
        <span style={{ fontSize: 10, color: "#f59e0b" }}>warn: {warn}{unit}</span>
        <span style={{ fontSize: 10, color: "#ef4444" }}>crit: {crit}{unit}</span>
        <span style={{ fontSize: 10, color: "#475569" }}>{max}{unit}</span>
      </div>
    </div>
  );
}

// ── Main Simulator ────────────────────────────────────────────────────────────
export default function Simulator({ liveData, isSimMode, onToggleMode, onSimDataChange }) {
  const [simGas,      setSimGas]      = useState(liveData?.gas_ppm      ?? 300);
  const [simMoisture, setSimMoisture] = useState(liveData?.moisture_pct ?? 60);
  const [simWater,    setSimWater]    = useState(liveData?.water_cm     ?? 40);

  const simData = { gas_ppm: simGas, moisture_pct: simMoisture, water_cm: simWater };
  const displayData = isSimMode ? simData : (liveData || simData);
  const score  = calcRiskScore(displayData);
  const recs   = getRecommendations(displayData);

  const handleChange = useCallback((setter, field) => (val) => {
    setter(val);
    if (onSimDataChange) onSimDataChange({ gas_ppm: simGas, moisture_pct: simMoisture, water_cm: simWater, [field]: val });
  }, [simGas, simMoisture, simWater, onSimDataChange]);

  const resetToLive = () => {
    if (!liveData) return;
    setSimGas(liveData.gas_ppm ?? 300);
    setSimMoisture(liveData.moisture_pct ?? 60);
    setSimWater(liveData.water_cm ?? 40);
  };

  return (
    <div>
      {/* Header + toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h3 style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", margin: 0 }}>
          {isSimMode ? "🧪 SIMULATION MODE" : "📡 LIVE DATA"}
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          {isSimMode && (
            <button onClick={resetToLive} style={{
              background: "#1e293b", color: "#94a3b8", border: "1px solid #334155",
              borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer",
            }}>↺ Reset to Live</button>
          )}
          <button onClick={onToggleMode} style={{
            background: isSimMode ? "#7c3aed" : "#1d4ed8",
            color: "#fff", border: "none", borderRadius: 8,
            padding: "6px 16px", fontSize: 12, cursor: "pointer", fontWeight: 600,
          }}>
            {isSimMode ? "📡 Go Live" : "🧪 Simulate"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Left — sliders (only editable in sim mode) */}
        <div style={{
          background: "#111827", borderRadius: 12, padding: 18,
          border: isSimMode ? "1px solid #7c3aed44" : "1px solid #1e293b",
          opacity: isSimMode ? 1 : 0.6,
          pointerEvents: isSimMode ? "auto" : "none",
        }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 16 }}>
            {isSimMode ? "Drag sliders to simulate scenarios" : "Switch to simulation mode to edit"}
          </p>

          <SliderRow label="Gas Level"      icon="💨" value={simGas}
            min={0} max={1000} step={5} unit=" ppm"
            warn={THRESHOLDS.gas.warning} crit={THRESHOLDS.gas.critical}
            onChange={handleChange(setSimGas, "gas_ppm")} />

          <SliderRow label="Soil Moisture"  icon="🌱" value={simMoisture}
            min={0} max={100} step={1} unit="%"
            warn={THRESHOLDS.moisture.warning} crit={THRESHOLDS.moisture.critical}
            onChange={handleChange(setSimMoisture, "moisture_pct")} />

          <SliderRow label="Water Level"    icon="🌊" value={simWater}
            min={0} max={120} step={1} unit=" cm"
            warn={THRESHOLDS.water.warning} crit={THRESHOLDS.water.critical}
            onChange={handleChange(setSimWater, "water_cm")} />
        </div>

        {/* Right — risk + recommendations */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#111827", borderRadius: 12, padding: 18, border: "1px solid #1e293b", display: "flex", justifyContent: "center" }}>
            <RiskGauge score={score} />
          </div>
          <div style={{ background: "#111827", borderRadius: 12, padding: 16, border: "1px solid #1e293b", flex: 1 }}>
            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>AI RECOMMENDATIONS</p>
            {recs.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, padding: "8px 10px",
                background: `${r.color}11`, borderLeft: `2px solid ${r.color}`, borderRadius: "0 6px 6px 0" }}>
                <span style={{ fontSize: 14 }}>{r.icon}</span>
                <span style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}