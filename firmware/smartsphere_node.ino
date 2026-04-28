/**
 * SmartSphere IoT Node Firmware
 * Hardware: ESP8266 (NodeMCU / Wemos D1 Mini)
 * Sensors: MQ-2 Gas, Soil Moisture (Capacitive), HC-SR04 Ultrasonic
 * Protocol: MQTT over Wi-Fi → Firebase / AWS IoT
 *
 * Pin Mapping:
 *   MQ-2 Gas Sensor    → A0  (Analog)
 *   Soil Moisture      → D1  (GPIO5, Analog via ADS1115 or direct A0 mux)
 *   HC-SR04 Trig       → D5  (GPIO14)
 *   HC-SR04 Echo       → D6  (GPIO12)
 *   Buzzer             → D7  (GPIO13)
 *   Status LED         → D4  (GPIO2, built-in LED)
 */

#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <NTPClient.h>
#include <WiFiUDP.h>

// ─── Configuration ────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// MQTT Broker (use your Firebase RTDB or HiveMQ Cloud)
const char* MQTT_BROKER   = "your-project.firebaseio.com";
const int   MQTT_PORT     = 8883;
const char* MQTT_USER     = "your_mqtt_user";
const char* MQTT_PASSWORD = "your_mqtt_password";
const char* NODE_ID       = "node_a";          // "node_a" = rural, "node_b" = urban
const char* ZONE_TYPE     = "rural";           // "rural" or "urban"

// MQTT Topics
const char* TOPIC_SENSORS   = "smartsphere/sensors";
const char* TOPIC_ALERTS    = "smartsphere/alerts";
const char* TOPIC_COMMAND   = "smartsphere/command";

// Firebase REST API (for direct HTTP writes if MQTT unavailable)
const char* FIREBASE_HOST   = "your-project-default-rtdb.firebaseio.com";
const char* FIREBASE_SECRET = "your_firebase_database_secret";

// ─── Sensor Pins ──────────────────────────────────────────────────────────────
#define GAS_PIN        A0
#define TRIG_PIN       D5
#define ECHO_PIN       D6
#define BUZZER_PIN     D7
#define LED_PIN        D4
#define MOISTURE_PIN   D1    // Digital high/low, or use separate ADC

// ─── Thresholds ───────────────────────────────────────────────────────────────
#define GAS_WARN_PPM     400
#define GAS_CRIT_PPM     600
#define WATER_WARN_CM     55
#define WATER_CRIT_CM     70
#define MOISTURE_LOW_PCT  30
#define MOISTURE_HIGH_PCT 80

// ─── Intervals ────────────────────────────────────────────────────────────────
#define READ_INTERVAL_MS   2000
#define PUBLISH_INTERVAL_MS 5000
#define RECONNECT_DELAY_MS  5000

// ─── Global State ─────────────────────────────────────────────────────────────
WiFiClientSecure   wifiClient;
PubSubClient       mqttClient(wifiClient);
WiFiUDP            ntpUDP;
NTPClient          timeClient(ntpUDP, "pool.ntp.org", 19800, 60000); // IST UTC+5:30

unsigned long lastReadTime    = 0;
unsigned long lastPublishTime = 0;
bool          buzzerActive    = false;

struct SensorData {
  float  gasPPM;
  float  moisturePct;
  float  waterLevelCm;
  int    gasRisk;      // 0=low 1=med 2=high
  int    waterRisk;
  int    moistureRisk;
  String timestamp;
};

SensorData latest;

// ─── MQ-2 Calibration ─────────────────────────────────────────────────────────
// R0 value calibrated in clean air (default ~9.8 kΩ)
float R0 = 9.8;

float readGasPPM() {
  int raw = analogRead(GAS_PIN);
  float voltage = raw * (3.3 / 1023.0);
  float RS = ((3.3 * 10.0) / voltage) - 10.0;  // RL = 10kΩ
  float ratio = RS / R0;
  // LPG curve from MQ-2 datasheet: ppm = 10^((log(ratio) - b) / m)
  float ppm = pow(10, ((log10(ratio) - (-0.45)) / (-0.55)));
  return constrain(ppm, 0, 10000);
}

// ─── HC-SR04 Ultrasonic ───────────────────────────────────────────────────────
float readWaterLevelCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // 30ms timeout
  if (duration == 0) return -1.0;  // timeout / no echo

  float distanceCm = (duration * 0.0343) / 2.0;

  // Convert distance to water level:
  // Sensor mounted 100cm above tank floor; water level = 100 - distance
  float tankDepthCm = 100.0;
  float level = tankDepthCm - distanceCm;
  return constrain(level, 0, tankDepthCm);
}

// ─── Soil Moisture ────────────────────────────────────────────────────────────
// Capacitive sensor: 0V = wet (100%), 3.3V = dry (0%)
// Calibrate: AIR_VALUE (dry) and WATER_VALUE (submerged in water)
float readMoisturePct() {
  // If sharing A0 with gas, mux via digital pin — here using digital threshold
  // For production, use ADS1115 I2C ADC for multiple analog inputs
  int raw = analogRead(GAS_PIN);  // Swap mux here in real wiring
  int AIR_VALUE   = 880;
  int WATER_VALUE = 380;
  float pct = map(raw, AIR_VALUE, WATER_VALUE, 0, 100);
  return constrain(pct, 0, 100);
}

// ─── Risk Assessment ──────────────────────────────────────────────────────────
int assessRisk(float value, float warnThreshold, float critThreshold) {
  if (value >= critThreshold) return 2;   // HIGH
  if (value >= warnThreshold) return 1;   // MEDIUM
  return 0;                                // LOW
}

int assessMoistureRisk(float pct) {
  if (pct < MOISTURE_LOW_PCT || pct > MOISTURE_HIGH_PCT) return 1;
  return 0;
}

// ─── Publish to MQTT ──────────────────────────────────────────────────────────
void publishSensorData(const SensorData& data) {
  StaticJsonDocument<512> doc;
  doc["node_id"]       = NODE_ID;
  doc["zone"]          = ZONE_TYPE;
  doc["timestamp"]     = data.timestamp;
  doc["gas_ppm"]       = serialized(String(data.gasPPM, 1));
  doc["moisture_pct"]  = serialized(String(data.moisturePct, 1));
  doc["water_cm"]      = serialized(String(data.waterLevelCm, 1));
  doc["gas_risk"]      = data.gasRisk;
  doc["water_risk"]    = data.waterRisk;
  doc["moisture_risk"] = data.moistureRisk;

  char payload[512];
  serializeJson(doc, payload);

  String topic = String(TOPIC_SENSORS) + "/" + NODE_ID;
  bool ok = mqttClient.publish(topic.c_str(), payload, true); // retained
  if (ok) {
    Serial.println("[MQTT] Published: " + String(payload));
  } else {
    Serial.println("[MQTT] Publish FAILED — queueing for HTTP fallback");
    publishViaHTTP(data);
  }
}

// ─── Firebase HTTP Fallback ───────────────────────────────────────────────────
void publishViaHTTP(const SensorData& data) {
  WiFiClientSecure client;
  client.setInsecure(); // For dev only — use fingerprint in production
  HTTPClient https;

  String url = "https://" + String(FIREBASE_HOST)
             + "/sensors/" + String(NODE_ID) + "/latest.json"
             + "?auth=" + String(FIREBASE_SECRET);

  https.begin(client, url);
  https.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["gas_ppm"]      = data.gasPPM;
  doc["moisture_pct"] = data.moisturePct;
  doc["water_cm"]     = data.waterLevelCm;
  doc["timestamp"]    = data.timestamp;

  char body[256];
  serializeJson(doc, body);

  int code = https.PUT(body);
  Serial.println("[HTTP] Firebase response: " + String(code));
  https.end();
}

// ─── Publish Alert ────────────────────────────────────────────────────────────
void publishAlert(const char* type, const char* message, int severity) {
  StaticJsonDocument<256> doc;
  doc["node_id"]   = NODE_ID;
  doc["zone"]      = ZONE_TYPE;
  doc["type"]      = type;
  doc["message"]   = message;
  doc["severity"]  = severity;  // 1=warn 2=critical
  doc["timestamp"] = latest.timestamp;

  char payload[256];
  serializeJson(doc, payload);
  mqttClient.publish(TOPIC_ALERTS, payload);
  Serial.println("[ALERT] " + String(message));
}

// ─── Buzzer Control ───────────────────────────────────────────────────────────
void triggerBuzzer(int pattern) {
  // pattern 1 = single beep, 2 = rapid beep (critical)
  if (pattern == 1) {
    digitalWrite(BUZZER_PIN, HIGH); delay(500); digitalWrite(BUZZER_PIN, LOW);
  } else if (pattern == 2) {
    for (int i = 0; i < 5; i++) {
      digitalWrite(BUZZER_PIN, HIGH); delay(150);
      digitalWrite(BUZZER_PIN, LOW);  delay(100);
    }
  }
}

// ─── MQTT Message Handler (incoming commands) ─────────────────────────────────
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.println("[CMD] Received: " + msg);

  StaticJsonDocument<128> doc;
  deserializeJson(doc, msg);

  const char* cmd = doc["command"];
  if (strcmp(cmd, "buzzer_on")  == 0) { triggerBuzzer(1); }
  if (strcmp(cmd, "buzzer_crit")== 0) { triggerBuzzer(2); }
  if (strcmp(cmd, "led_on")     == 0) { digitalWrite(LED_PIN, LOW); }  // LOW = on
  if (strcmp(cmd, "led_off")    == 0) { digitalWrite(LED_PIN, HIGH); }
}

// ─── Wi-Fi Setup ──────────────────────────────────────────────────────────────
void setupWiFi() {
  Serial.print("[WiFi] Connecting to " + String(WIFI_SSID));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500); Serial.print("."); retries++;
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // blink while connecting
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected. IP: " + WiFi.localIP().toString());
    digitalWrite(LED_PIN, LOW); // solid = connected
  } else {
    Serial.println("\n[WiFi] FAILED — restarting");
    ESP.restart();
  }
}

// ─── MQTT Setup ───────────────────────────────────────────────────────────────
void setupMQTT() {
  wifiClient.setInsecure(); // dev mode; use setCACert() in production
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(512);
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting...");
    String clientId = "SmartSphere-" + String(NODE_ID) + "-" + String(random(0xffff), HEX);
    if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD)) {
      Serial.println(" connected.");
      // Subscribe to command topic for this node
      String cmdTopic = String(TOPIC_COMMAND) + "/" + NODE_ID;
      mqttClient.subscribe(cmdTopic.c_str());
    } else {
      Serial.println(" failed (rc=" + String(mqttClient.state()) + ") — retry in 5s");
      delay(RECONNECT_DELAY_MS);
    }
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial.println("\n\n=== SmartSphere Node Booting ===");
  Serial.println("Node: " + String(NODE_ID) + " | Zone: " + String(ZONE_TYPE));

  pinMode(TRIG_PIN,    OUTPUT);
  pinMode(ECHO_PIN,    INPUT);
  pinMode(BUZZER_PIN,  OUTPUT);
  pinMode(LED_PIN,     OUTPUT);

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN,    HIGH); // HIGH = off (active low)

  setupWiFi();
  setupMQTT();

  timeClient.begin();
  timeClient.update();

  // Startup beep — node is online
  triggerBuzzer(1);
  Serial.println("[BOOT] SmartSphere node online.");
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
void loop() {
  // Maintain connections
  if (!mqttClient.connected()) reconnectMQTT();
  mqttClient.loop();
  timeClient.update();

  unsigned long now = millis();

  // ── Read sensors every READ_INTERVAL_MS ────────────────────────────────────
  if (now - lastReadTime >= READ_INTERVAL_MS) {
    lastReadTime = now;

    latest.gasPPM       = readGasPPM();
    latest.waterLevelCm = readWaterLevelCm();
    latest.moisturePct  = readMoisturePct();
    latest.gasRisk      = assessRisk(latest.gasPPM, GAS_WARN_PPM, GAS_CRIT_PPM);
    latest.waterRisk    = assessRisk(latest.waterLevelCm, WATER_WARN_CM, WATER_CRIT_CM);
    latest.moistureRisk = assessMoistureRisk(latest.moisturePct);
    latest.timestamp    = timeClient.getFormattedTime();

    Serial.printf("[SENSOR] Gas=%.1f ppm | Moisture=%.1f%% | Water=%.1f cm\n",
      latest.gasPPM, latest.moisturePct, latest.waterLevelCm);

    // Immediate critical alerts
    if (latest.gasRisk == 2) {
      publishAlert("gas_critical", "CRITICAL: Gas level exceeded safe limit", 2);
      triggerBuzzer(2);
    } else if (latest.gasRisk == 1) {
      publishAlert("gas_warning", "WARNING: Gas level rising", 1);
    }

    if (latest.waterRisk == 2) {
      publishAlert("flood_critical", "CRITICAL: Flood threshold exceeded", 2);
      triggerBuzzer(2);
    } else if (latest.waterRisk == 1) {
      publishAlert("flood_warning", "WARNING: Water level elevated", 1);
    }
  }

  // ── Publish to cloud every PUBLISH_INTERVAL_MS ─────────────────────────────
  if (now - lastPublishTime >= PUBLISH_INTERVAL_MS) {
    lastPublishTime = now;
    publishSensorData(latest);
  }
}

