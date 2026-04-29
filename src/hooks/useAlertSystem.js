// src/hooks/useAlertSystem.js
// Monitors sensor data, fires toast notifications and audio on threshold breach

import { useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";

// ── Thresholds ────────────────────────────────────────────────────────────────
export const THRESHOLDS = {
  water:    { warning: 55,  critical: 70  },
  gas:      { warning: 400, critical: 600 },
  moisture: { warning: 20,  critical: 15  },  // low moisture = dry = bad
};

// ── Risk score 0-100 from sensor data ─────────────────────────────────────────
export function calcRiskScore(data) {
  if (!data) return 0;
  let score = 0;
  const { gas_ppm = 0, moisture_pct = 100, water_cm = 0 } = data;

  // Water (40% weight)
  if (water_cm >= THRESHOLDS.water.critical)      score += 40;
  else if (water_cm >= THRESHOLDS.water.warning)  score += 20;

  // Gas (40% weight)
  if (gas_ppm >= THRESHOLDS.gas.critical)         score += 40;
  else if (gas_ppm >= THRESHOLDS.gas.warning)     score += 20;

  // Moisture (20% weight — dryness risk)
  if (moisture_pct <= THRESHOLDS.moisture.critical)      score += 20;
  else if (moisture_pct <= THRESHOLDS.moisture.warning)  score += 10;

  return Math.min(score, 100);
}

export function riskLabel(score) {
  if (score >= 60) return "critical";
  if (score >= 30) return "warning";
  return "safe";
}

export function riskColor(score) {
  if (score >= 60) return "#ef4444";
  if (score >= 30) return "#f59e0b";
  return "#22c55e";
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export default function useAlertSystem(sensorData, nodeId = "node_a") {
  // Track which alerts have already fired so we don't spam
  const firedAlerts = useRef(new Set());
  const audioRef    = useRef(null);

  // Init audio once
  useEffect(() => {
    try {
      audioRef.current = new Audio("/alert.mp3");
      audioRef.current.volume = 0.6;
    } catch { /* audio not available */ }
  }, []);

  const playAlert = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!sensorData) return;
    const { gas_ppm, moisture_pct, water_cm } = sensorData;
    const key = (type) => `${nodeId}-${type}`;

    // Water critical
    if (water_cm > THRESHOLDS.water.critical && !firedAlerts.current.has(key("water-crit"))) {
      firedAlerts.current.add(key("water-crit"));
      toast.error(`🌊 FLOOD ALERT [${nodeId}]: Water at ${water_cm.toFixed(1)} cm!`, { duration: 7000 });
      playAlert();
    } else if (water_cm <= THRESHOLDS.water.critical) {
      firedAlerts.current.delete(key("water-crit"));
    }

    // Water warning
    if (water_cm > THRESHOLDS.water.warning && water_cm <= THRESHOLDS.water.critical
        && !firedAlerts.current.has(key("water-warn"))) {
      firedAlerts.current.add(key("water-warn"));
      toast(`⚠️ Water rising [${nodeId}]: ${water_cm.toFixed(1)} cm`, { icon: "🌊", duration: 5000 });
    } else if (water_cm <= THRESHOLDS.water.warning) {
      firedAlerts.current.delete(key("water-warn"));
    }

    // Gas critical
    if (gas_ppm > THRESHOLDS.gas.critical && !firedAlerts.current.has(key("gas-crit"))) {
      firedAlerts.current.add(key("gas-crit"));
      toast.error(`☠️ GAS CRITICAL [${nodeId}]: ${gas_ppm.toFixed(0)} ppm!`, { duration: 7000 });
      playAlert();
    } else if (gas_ppm <= THRESHOLDS.gas.critical) {
      firedAlerts.current.delete(key("gas-crit"));
    }

    // Gas warning
    if (gas_ppm > THRESHOLDS.gas.warning && gas_ppm <= THRESHOLDS.gas.critical
        && !firedAlerts.current.has(key("gas-warn"))) {
      firedAlerts.current.add(key("gas-warn"));
      toast(`⚠️ Gas rising [${nodeId}]: ${gas_ppm.toFixed(0)} ppm`, { icon: "💨", duration: 5000 });
    } else if (gas_ppm <= THRESHOLDS.gas.warning) {
      firedAlerts.current.delete(key("gas-warn"));
    }

    // Moisture critical (too dry)
    if (moisture_pct < THRESHOLDS.moisture.critical && !firedAlerts.current.has(key("moist-crit"))) {
      firedAlerts.current.add(key("moist-crit"));
      toast.error(`🌵 SOIL CRITICAL [${nodeId}]: Moisture at ${moisture_pct.toFixed(0)}%`, { duration: 6000 });
      playAlert();
    } else if (moisture_pct >= THRESHOLDS.moisture.critical) {
      firedAlerts.current.delete(key("moist-crit"));
    }

  }, [sensorData, nodeId, playAlert]);

  const riskScore = calcRiskScore(sensorData);
  return { riskScore, riskLabel: riskLabel(riskScore), riskColor: riskColor(riskScore) };
}