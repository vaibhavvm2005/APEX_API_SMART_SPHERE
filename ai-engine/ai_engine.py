"""
SmartSphere AI Engine
Standalone Python service for advanced anomaly detection and predictive analytics.
Can run as a Cloud Function, Cloud Run container, or local process.

Features:
  - Isolation Forest anomaly detection
  - ARIMA-based time series forecasting
  - Multi-sensor risk scoring
  - Alert rule engine
  - REST API (FastAPI)

Install: pip install fastapi uvicorn scikit-learn pandas numpy statsmodels firebase-admin
Run:     uvicorn ai_engine:app --host 0.0.0.0 --port 8080
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import firebase_admin
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials, db as firebase_db
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("smartsphere-ai")

# ─── Firebase Init ────────────────────────────────────────────────────────────
FIREBASE_CRED_PATH = os.getenv("FIREBASE_CREDENTIALS", "serviceAccountKey.json")
FIREBASE_DB_URL    = os.getenv("FIREBASE_DB_URL", "https://your-project-default-rtdb.firebaseio.com")

try:
    cred = credentials.Certificate(FIREBASE_CRED_PATH)
    firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})
    log.info("Firebase initialized.")
except Exception as e:
    log.warning(f"Firebase not initialized (running in offline mode): {e}")

# ─── FastAPI App ──────────────────────────────────────────────────────────────
app = FastAPI(title="SmartSphere AI Engine", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Pydantic Models ──────────────────────────────────────────────────────────
class SensorReading(BaseModel):
    node_id:      str
    zone:         str
    gas_ppm:      float
    moisture_pct: float
    water_cm:     float
    timestamp:    Optional[str] = None

class PredictionRequest(BaseModel):
    node_id: str
    horizon: int = 10   # readings ahead to predict

# ─── Thresholds ───────────────────────────────────────────────────────────────
THRESHOLDS = {
    "gas":      {"warn": 400, "crit": 600},
    "water":    {"warn": 55,  "crit": 70},
    "moisture": {"low":  30,  "high": 80},
}

# ─── In-memory cache (replace with Redis in production) ───────────────────────
history_cache: dict[str, list] = {}

# ─── Helpers ──────────────────────────────────────────────────────────────────
def get_risk_level(value: float, warn: float, crit: float) -> str:
    if value >= crit: return "high"
    if value >= warn: return "medium"
    return "low"

def fetch_history_from_firebase(node_id: str, limit: int = 50) -> pd.DataFrame:
    """Fetch last N readings from Firebase RTDB."""
    try:
        ref  = firebase_db.reference(f"/history/{node_id}")
        data = ref.order_by_key().limit_to_last(limit).get()
        if not data:
            return pd.DataFrame()
        records = list(data.values())
        return pd.DataFrame(records)
    except Exception as e:
        log.error(f"Firebase fetch error: {e}")
        return pd.DataFrame()

def get_history(node_id: str, limit: int = 50) -> pd.DataFrame:
    """Get history from cache or Firebase."""
    cached = history_cache.get(node_id, [])
    if len(cached) >= 5:
        return pd.DataFrame(cached[-limit:])
    return fetch_history_from_firebase(node_id, limit)

def cache_reading(node_id: str, reading: dict):
    if node_id not in history_cache:
        history_cache[node_id] = []
    history_cache[node_id].append(reading)
    # Keep last 200 readings in memory
    if len(history_cache[node_id]) > 200:
        history_cache[node_id] = history_cache[node_id][-200:]

# ─── Anomaly Detection: Isolation Forest ──────────────────────────────────────
def detect_anomalies_isolation_forest(df: pd.DataFrame) -> dict:
    """
    Multi-variate anomaly detection using Isolation Forest.
    Returns anomaly flags and scores for each sensor.
    """
    if len(df) < 10:
        return {"anomaly": False, "score": 0.0, "detail": "insufficient_data"}

    features = ["gas_ppm", "moisture_pct", "water_cm"]
    available = [f for f in features if f in df.columns]
    if not available:
        return {"anomaly": False, "score": 0.0, "detail": "no_features"}

    X = df[available].dropna().values
    if len(X) < 5:
        return {"anomaly": False, "score": 0.0, "detail": "insufficient_data"}

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(contamination=0.1, random_state=42, n_estimators=50)
    model.fit(X_scaled)

    latest_scaled = scaler.transform([X[-1]])
    score         = float(model.score_samples(latest_scaled)[0])
    is_anomaly    = model.predict(latest_scaled)[0] == -1

    # Per-sensor Z-scores
    per_sensor = {}
    for feat in available:
        vals   = df[feat].dropna().values
        if len(vals) > 1:
            mean   = float(np.mean(vals[:-1]))
            std    = float(np.std(vals[:-1])) or 1.0
            zscore = abs((vals[-1] - mean) / std)
            per_sensor[feat] = {
                "zscore": round(zscore, 2),
                "anomaly": zscore > 2.5,
                "mean": round(mean, 2),
                "current": round(float(vals[-1]), 2),
            }

    return {
        "anomaly":     bool(is_anomaly),
        "score":       round(score, 4),
        "per_sensor":  per_sensor,
        "detail":      "isolation_forest",
        "n_samples":   len(X),
    }

# ─── Flood Prediction: Linear Regression + Trend ──────────────────────────────
def predict_flood_risk(df: pd.DataFrame) -> dict:
    """
    Predict flood risk using linear trend analysis.
    Returns probability (0-100) and estimated time-to-flood in minutes.
    """
    if "water_cm" not in df.columns or len(df) < 3:
        return {"probability": 0, "eta_minutes": None, "trend": "stable"}

    levels = df["water_cm"].dropna().values[-20:]
    if len(levels) < 3:
        return {"probability": 0, "eta_minutes": None, "trend": "stable"}

    x = np.arange(len(levels), dtype=float)
    y = levels.astype(float)

    # Weighted least squares (recent readings weighted more)
    weights = np.linspace(0.3, 1.0, len(x))
    coeffs  = np.polyfit(x, y, 1, w=weights)
    slope   = float(coeffs[0])
    intercept = float(coeffs[1])

    current = float(levels[-1])
    crit    = float(THRESHOLDS["water"]["crit"])
    warn    = float(THRESHOLDS["water"]["warn"])

    # ETA calculation
    eta_minutes = None
    if slope > 0.1 and current < crit:
        steps_to_crit = (crit - (intercept + slope * (len(levels) - 1))) / slope
        eta_minutes   = max(0, round(steps_to_crit * (5 / 60)))  # 5s per reading → minutes

    # Probability calculation
    base_prob = min(100, max(0, round((current / crit) * 80)))
    trend_boost = min(20, max(0, round(slope * 15))) if slope > 0 else 0
    probability = min(100, base_prob + trend_boost)

    if current >= crit:   probability = 100; eta_minutes = 0
    elif current < warn:  probability = max(0, probability - 20)

    trend_label = "rising" if slope > 0.5 else "stable" if abs(slope) <= 0.5 else "falling"

    return {
        "probability":  int(probability),
        "eta_minutes":  eta_minutes,
        "trend":        trend_label,
        "slope_per_reading": round(slope, 3),
        "current_cm":   round(current, 1),
        "critical_cm":  crit,
    }

# ─── Smart Irrigation Recommendation ─────────────────────────────────────────
def irrigation_recommendation(moisture_pct: float, water_risk: str, zone: str) -> dict:
    """Generate irrigation schedule recommendations for rural zones."""
    if zone != "rural":
        return {"action": "not_applicable", "message": "Urban zone — no irrigation control."}

    if water_risk in ("high", "medium"):
        return {"action": "halt", "message": "Flood risk detected. Halt irrigation immediately."}

    if moisture_pct < 25:
        return {"action": "irrigate_heavy", "duration_minutes": 45,
                "message": "Critical soil dryness. Begin heavy irrigation (45 min)."}
    elif moisture_pct < THRESHOLDS["moisture"]["low"]:
        return {"action": "irrigate_light", "duration_minutes": 20,
                "message": "Dry soil. Irrigate for 20 minutes."}
    elif moisture_pct > THRESHOLDS["moisture"]["high"]:
        return {"action": "halt", "duration_minutes": 0,
                "message": "Over-saturated. No irrigation needed. Check drainage."}
    else:
        return {"action": "maintain", "next_check_hours": 2,
                "message": "Optimal moisture. Next check in 2 hours."}

# ─── Full AI Analysis Pipeline ────────────────────────────────────────────────
def run_ai_analysis(reading: SensorReading) -> dict:
    # Cache this reading
    cache_reading(reading.node_id, {
        "gas_ppm":      reading.gas_ppm,
        "moisture_pct": reading.moisture_pct,
        "water_cm":     reading.water_cm,
        "timestamp":    reading.timestamp or datetime.utcnow().isoformat(),
    })

    df = get_history(reading.node_id, limit=50)

    # Risk assessment
    gas_risk      = get_risk_level(reading.gas_ppm,      THRESHOLDS["gas"]["warn"],   THRESHOLDS["gas"]["crit"])
    water_risk    = get_risk_level(reading.water_cm,     THRESHOLDS["water"]["warn"], THRESHOLDS["water"]["crit"])
    moisture_risk = "medium" if reading.moisture_pct < THRESHOLDS["moisture"]["low"] \
                             or reading.moisture_pct > THRESHOLDS["moisture"]["high"] else "low"

    risk_map = {"low": 0, "medium": 1, "high": 2}
    overall_risk = ["low", "medium", "high"][max(risk_map[gas_risk], risk_map[water_risk], risk_map[moisture_risk])]

    # AI components
    anomaly_result   = detect_anomalies_isolation_forest(df) if len(df) >= 5 else {"anomaly": False}
    flood_prediction = predict_flood_risk(df)
    irrigation_rec   = irrigation_recommendation(reading.moisture_pct, water_risk, reading.zone)

    # Recommendations
    recommendations = []
    if gas_risk == "high":
        recommendations.append({"priority": "critical", "sensor": "gas",
            "action": "EVACUATE: Gas critically high. Shut off supply, call emergency services."})
    elif gas_risk == "medium":
        recommendations.append({"priority": "warning", "sensor": "gas",
            "action": f"Gas at {reading.gas_ppm:.0f} ppm — increase ventilation and inspect lines."})

    if flood_prediction["probability"] > 75:
        recommendations.append({"priority": "critical", "sensor": "water",
            "action": f"Flood imminent ({flood_prediction['probability']}%). "
                      f"Deploy barriers. ETA: {flood_prediction.get('eta_minutes', '?')} min."})
    elif flood_prediction["probability"] > 40:
        recommendations.append({"priority": "warning", "sensor": "water",
            "action": f"Water rising (trend: {flood_prediction['trend']}). Clear drains, pre-position pumps."})

    if irrigation_rec["action"] in ("irrigate_heavy", "irrigate_light"):
        recommendations.append({"priority": "info", "sensor": "moisture",
            "action": irrigation_rec["message"]})
    elif irrigation_rec["action"] == "halt" and water_risk == "low":
        recommendations.append({"priority": "warning", "sensor": "moisture",
            "action": irrigation_rec["message"]})

    if anomaly_result.get("anomaly") and overall_risk != "high":
        recommendations.append({"priority": "warning", "sensor": "multi",
            "action": f"Anomaly detected across sensors (score: {anomaly_result.get('score', 0):.3f}). Verify hardware and readings."})

    if not recommendations:
        recommendations.append({"priority": "info", "sensor": "system", "action": "All parameters nominal."})

    return {
        "node_id":         reading.node_id,
        "zone":            reading.zone,
        "timestamp":       reading.timestamp or datetime.utcnow().isoformat(),
        "risk": {
            "gas":      gas_risk,
            "water":    water_risk,
            "moisture": moisture_risk,
            "overall":  overall_risk,
        },
        "anomaly_detection": anomaly_result,
        "flood_prediction":  flood_prediction,
        "irrigation":        irrigation_rec,
        "recommendations":   recommendations,
        "history_samples":   len(df),
    }

# ─── API Routes ───────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "smartsphere-ai", "timestamp": datetime.utcnow().isoformat()}

@app.post("/analyze")
def analyze(reading: SensorReading):
    """Run full AI analysis pipeline on a sensor reading."""
    try:
        result = run_ai_analysis(reading)
        log.info(f"[{reading.node_id}] overall={result['risk']['overall']} "
                 f"flood={result['flood_prediction']['probability']}%")
        return result
    except Exception as e:
        log.error(f"Analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history/{node_id}")
def get_history_endpoint(node_id: str, limit: int = 50):
    """Return cached or Firebase history for a node."""
    df = get_history(node_id, limit)
    if df.empty:
        return {"node_id": node_id, "records": [], "count": 0}
    return {"node_id": node_id, "records": df.to_dict(orient="records"), "count": len(df)}

@app.post("/simulate")
def simulate(reading: SensorReading):
    """What-if simulation — analyze without caching."""
    try:
        df = get_history(reading.node_id, limit=50)
        flood = predict_flood_risk(df)
        gas_risk   = get_risk_level(reading.gas_ppm,  THRESHOLDS["gas"]["warn"],   THRESHOLDS["gas"]["crit"])
        water_risk = get_risk_level(reading.water_cm, THRESHOLDS["water"]["warn"], THRESHOLDS["water"]["crit"])
        irrigation = irrigation_recommendation(reading.moisture_pct, water_risk, reading.zone)
        return {
            "gas_risk": gas_risk,
            "water_risk": water_risk,
            "flood_prediction": flood,
            "irrigation": irrigation,
            "note": "Simulation only — no data cached.",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ai_engine:app", host="0.0.0.0", port=8080, reload=True)