# SmartSphere IoT Platform — Complete Source Code

## Project Structure

```
smartsphere/
├── firmware/
│   └── smartsphere_node.ino      ← ESP8266 Arduino firmware
├── backend/
│   ├── functions/
│   │   └── index.js              ← Firebase Cloud Functions
│   └── rules/
│       └── database.rules.json   ← Firebase security rules
├── ai-engine/
│   └── ai_engine.py              ← Python AI/ML service (FastAPI)
├── dashboard/
│   └── src/
│       ├── App.jsx               ← React dashboard
│       └── config.js             ← Firebase + API config
└── README.md
```

---

## 1. Hardware Setup

### Components Required
| Component | Model | Connection |
|---|---|---|
| Microcontroller | NodeMCU ESP8266 | — |
| Gas sensor | MQ-2 | A0 (analog) |
| Soil moisture | Capacitive v1.2 | D1 or ADS1115 |
| Ultrasonic | HC-SR04 | D5 (Trig), D6 (Echo) |
| Buzzer | Active 5V | D7 |
| Status LED | Built-in | D4 |

### Wiring Diagram
```
ESP8266          MQ-2
3V3       ───►  VCC
GND       ───►  GND
A0        ───►  AOUT

ESP8266          HC-SR04
5V/VIN    ───►  VCC
GND       ───►  GND
D5 (GPIO14)───► TRIG
D6 (GPIO12)───► ECHO

ESP8266          Soil Moisture
3V3       ───►  VCC
GND       ───►  GND
D1 (GPIO5)───►  AOUT (or use ADS1115 for true analog)

ESP8266          Buzzer
D7 (GPIO13)───► + (positive)
GND       ───►  - (negative)
```

> **Note:** ESP8266 has only one ADC (A0). For multiple analog sensors,
> use an **ADS1115 I2C ADC** (address 0x48) connected on D2 (SDA) and D3 (SCL).

### Arduino Libraries (install via Library Manager)
```
- ESP8266WiFi          (built-in with ESP8266 board package)
- PubSubClient         by Nick O'Leary
- ArduinoJson          by Benoit Blanchon (v6)
- NTPClient            by Fabrice Weinberg
- ESP8266HTTPClient    (built-in)
```

### Board Setup in Arduino IDE
1. File → Preferences → Additional Board URLs:
   `http://arduino.esp8266.com/stable/package_esp8266com_index.json`
2. Tools → Board → ESP8266 → NodeMCU 1.0 (ESP-12E Module)
3. Tools → Upload Speed → 115200
4. Set your Wi-Fi SSID, password, and Firebase credentials in the .ino file

---

## 2. Firebase Backend Setup

### Prerequisites
```bash
npm install -g firebase-tools
firebase login
firebase init   # select Functions + Realtime Database
```

### Install function dependencies
```bash
cd backend/functions
npm init -y
npm install firebase-admin firebase-functions axios
```

### Deploy
```bash
cd backend
firebase deploy --only functions,database
```

### Firebase Realtime Database Schema
```json
{
  "nodes": {
    "node_a": {
      "live": { "gas_ppm": 412, "moisture_pct": 63, "water_cm": 74,
                "gas_risk": "medium", "water_risk": "high", "overall_risk": "high",
                "flood_probability": 78, "recommendations": [...] }
    },
    "node_b": { "live": { ... } }
  },
  "history": {
    "node_a": {
      "gas_ppm":      { "-abc123": { "value": 412, "timestamp": "..." } },
      "water_cm":     { ... },
      "moisture_pct": { ... }
    }
  },
  "alerts": {
    "active": {
      "-xyz789": { "node_id": "node_a", "severity": "critical", "message": "..." }
    }
  }
}
```

---

## 3. AI Engine Setup

### Requirements
```bash
cd ai-engine
pip install fastapi uvicorn scikit-learn pandas numpy firebase-admin axios
```

### Environment variables
```bash
export FIREBASE_CREDENTIALS=path/to/serviceAccountKey.json
export FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com
```

### Run locally
```bash
uvicorn ai_engine:app --host 0.0.0.0 --port 8080 --reload
```

### Deploy to Google Cloud Run
```bash
gcloud run deploy smartsphere-ai \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com
```

### API Endpoints
| Method | Path | Description |
|---|---|---|
| GET  | /health | Health check |
| POST | /analyze | Run full AI pipeline on a reading |
| POST | /simulate | What-if simulation (no caching) |
| GET  | /history/{node_id} | Get cached history |

---

## 4. Dashboard Setup

### Prerequisites
```bash
cd dashboard
npm create vite@latest . -- --template react
npm install chart.js react-chartjs-2 firebase axios
```

### Environment file (.env)
```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_AI_ENGINE_URL=https://your-cloud-run-url.run.app
```

### Run
```bash
npm run dev       # development
npm run build     # production build
npm run preview   # preview production build
```

### Deploy to Firebase Hosting
```bash
npm run build
firebase deploy --only hosting
```

---

## 5. System Configuration

### MQTT Topics
```
smartsphere/sensors/{node_id}    ← sensor data (published by ESP8266)
smartsphere/alerts               ← alert events
smartsphere/command/{node_id}    ← commands to device (buzzer, LED)
```

### MQTT Command Payloads
```json
{ "command": "buzzer_on"   }    // single beep
{ "command": "buzzer_crit" }    // rapid critical beep
{ "command": "led_on"      }    // turn on status LED
{ "command": "led_off"     }    // turn off status LED
```

---

## 6. Calibration Guide

### MQ-2 Gas Sensor Calibration
1. Power on in CLEAN AIR for 24 hours (burn-in period)
2. Measure resistance in clean air → this is R0 (~9.8 kΩ)
3. Update `R0 = 9.8` in firmware with your measured value
4. LPG sensitivity curve: ppm = 10^((log(RS/R0) - b) / m)

### HC-SR04 Ultrasonic (Water Level)
- Mount sensor at top of tank/channel, pointing downward
- `tankDepthCm = 100.0` = distance from sensor to empty tank floor
- Water level = tankDepthCm - measured distance
- Adjust `tankDepthCm` to your actual installation

### Soil Moisture (Capacitive)
- Calibrate `AIR_VALUE` (sensor in dry air ≈ 880) and
  `WATER_VALUE` (sensor submerged in water ≈ 380)
- Values vary by sensor batch — test yours

---

## 7. Production Hardening Checklist

- [ ] Replace `wifiClient.setInsecure()` with TLS certificate fingerprint
- [ ] Store Wi-Fi credentials in EEPROM or ESP8266 flash (not hardcoded)
- [ ] Enable Firebase App Check for API abuse prevention
- [ ] Add Firebase Authentication (service account for nodes)
- [ ] Set up Cloud Monitoring alerts for function errors
- [ ] Enable CORS restrictions on Cloud Functions
- [ ] Add rate limiting on /analyze endpoint
- [ ] Set up daily history pruning (Cloud Scheduler)
- [ ] Configure SMS alerts via Twilio in Cloud Functions
- [ ] Add OTA (Over-The-Air) firmware updates via ArduinoOTA