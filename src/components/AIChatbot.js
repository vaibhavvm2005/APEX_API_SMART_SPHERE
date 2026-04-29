// src/components/AIChatbot.js
// SmartSphere AI — ChatGPT-style professional chatbot
// Behaviour: every message (even "hi") returns greeting + sensor snapshot
//            + 30-min predictions + active alerts + suggested actions

import React, { useState, useRef, useEffect, useCallback } from "react";

const FUNCTIONS_URL =
  process.env.REACT_APP_FUNCTIONS_URL ||
  "https://us-central1-YOUR_PROJECT.cloudfunctions.net";

// ── Thresholds ────────────────────────────────────────────────
const T = {
  gas:      { warn: 400, crit: 600 },
  water:    { warn: 55,  crit: 70  },
  moisture: { warn: 20,  crit: 15  },
};

// ── Tiny helpers ──────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function calcTrend(arr) {
  if (!arr || arr.length < 2) return 0;
  const s = arr.slice(-5);
  return (s[s.length - 1] - s[0]) / s.length;
}
function sensorColor(value, field) {
  if (field === "moisture") {
    if (value < T.moisture.crit) return "#ef4444";
    if (value < T.moisture.warn) return "#f59e0b";
    return "#22c55e";
  }
  const th = T[field];
  if (!th) return "#94a3b8";
  if (value > th.crit) return "#ef4444";
  if (value > th.warn) return "#f59e0b";
  return "#22c55e";
}
function overallStatus(data) {
  if (!data) return { label: "NO DATA", color: "#94a3b8", emoji: "⚪" };
  const { gas_ppm: g = 0, moisture_pct: m = 50, water_cm: w = 0 } = data;
  if (w > T.water.crit || g > T.gas.crit || m < T.moisture.crit)
    return { label: "CRITICAL", color: "#ef4444", emoji: "🔴" };
  if (w > T.water.warn || g > T.gas.warn || m < T.moisture.warn)
    return { label: "WARNING",  color: "#f59e0b", emoji: "🟡" };
  return   { label: "SAFE",     color: "#22c55e", emoji: "🟢" };
}

// ── Build full contextual response ───────────────────────────
function buildResponse(userText, data, history) {
  const lower = (userText || "").toLowerCase().trim();

  // No data edge case
  if (!data) {
    return {
      greeting:    "Hey! 👋 I'm SmartSphere AI. I can't see any sensor data right now — please check your ESP8266 connection and Firebase rules.",
      snapshot:    null,
      predictions: null,
      alerts:      [{ type: "warning", msg: "⚠️ No sensor data available — check hardware connection" }],
      suggestions: ["Verify ESP8266 is powered and connected to Wi-Fi", "Check Firebase rules allow .read and .write", "Open Serial Monitor in Arduino IDE to debug"],
    };
  }

  const { gas_ppm: g = 0, moisture_pct: m = 50, water_cm: w = 0 } = data;

  // ── Greeting text (context-aware) ──────────────────────────
  const hour   = new Date().getHours();
  const timeStr = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const greetWords = ["hi", "hey", "hello", "hii", "helo", "yo", "sup", "howdy"];
  const isGreet    = greetWords.some(w => lower === w || lower.startsWith(w + "!") || lower.startsWith(w + " "));
  const isThanks   = lower.includes("thank") || lower.includes("thx");
  const isHowAreU  = lower.includes("how are you") || lower.includes("how r u");

  let greeting = "";
  if (isGreet) {
    greeting = `${timeStr}! 👋 I'm SmartSphere AI — your real-time environmental intelligence system. Here's a live snapshot of your environment:`;
  } else if (isHowAreU) {
    greeting = `All my systems are running perfectly! 😊 More importantly, here's how YOUR environment is doing:`;
  } else if (isThanks) {
    greeting = `You're welcome! 😊 Here's your latest environmental update:`;
  } else if (lower.includes("flood") || lower.includes("water")) {
    greeting = `Here's the complete flood and water level analysis for your zone:`;
  } else if (lower.includes("gas") || lower.includes("air") || lower.includes("ventil")) {
    greeting = `Here's the current air quality and gas risk assessment:`;
  } else if (lower.includes("soil") || lower.includes("moisture") || lower.includes("irrig") || lower.includes("crop") || lower.includes("farm")) {
    greeting = `Here's your soil health and irrigation recommendation:`;
  } else if (lower.includes("safe") || lower.includes("danger") || lower.includes("risk") || lower.includes("status")) {
    greeting = `Here's your complete safety assessment right now:`;
  } else if (lower.includes("predict") || lower.includes("forecast") || lower.includes("next") || lower.includes("future")) {
    greeting = `Here's my 30-minute predictive forecast based on current sensor trends:`;
  } else if (lower.includes("summar") || lower.includes("report") || lower.includes("overview")) {
    greeting = `Here's a full environmental report from all your sensors:`;
  } else if (lower.includes("help") || lower.includes("what can")) {
    greeting = `I monitor gas, moisture, and water levels 24/7, predict risks up to 30 minutes ahead, and give you actionable recommendations. Here's your current status:`;
  } else {
    greeting = `Got it! Here's your current environmental status:`;
  }

  // ── Sensor snapshot ────────────────────────────────────────
  const snapshot = [
    { label: "Gas",      value: g.toFixed(0), unit: " ppm", color: sensorColor(g, "gas"),      icon: "💨" },
    { label: "Moisture", value: m.toFixed(0), unit: "%",    color: sensorColor(m, "moisture"), icon: "🌱" },
    { label: "Water",    value: w.toFixed(1), unit: " cm",  color: sensorColor(w, "water"),    icon: "🌊" },
  ];

  // ── Predictions ────────────────────────────────────────────
  const wTrend = calcTrend(history?.water);
  const gTrend = calcTrend(history?.gas);
  const mTrend = calcTrend(history?.moisture);

  const fp = w > T.water.crit ? 95 : Math.min(90, Math.max(5, Math.round(
    (w / T.water.crit) * 60 + wTrend * 12)));
  const gp = g > T.gas.crit ? 95 : Math.min(88, Math.max(3, Math.round(
    (g / T.gas.crit) * 55 + gTrend * 6)));
  const dp = m < T.moisture.crit ? 92 : Math.min(80, Math.max(5, Math.round(
    (1 - m / 100) * 35 + Math.abs(mTrend) * 8)));

  const predictions = {
    flood: {
      prob: fp, urgency: fp > 65 ? "high" : fp > 30 ? "medium" : "low",
      text: w > T.water.crit
        ? `Water at ${w.toFixed(1)} cm — above critical threshold! Act now.`
        : wTrend > 0.5 ? `Rising +${wTrend.toFixed(1)} cm/reading — flood risk climbing.`
        : w > T.water.warn ? `Elevated at ${w.toFixed(1)} cm — monitor closely.`
        : `Safe at ${w.toFixed(1)} cm — no flood risk.`,
    },
    gas: {
      prob: gp, urgency: gp > 65 ? "high" : gp > 30 ? "medium" : "low",
      text: g > T.gas.crit
        ? `Gas critical at ${g.toFixed(0)} ppm! Evacuate and ventilate.`
        : gTrend > 3 ? `Rising fast +${gTrend.toFixed(1)} ppm/reading.`
        : g > T.gas.warn ? `At ${g.toFixed(0)} ppm — approaching limit.`
        : `Safe at ${g.toFixed(0)} ppm.`,
    },
    dryness: {
      prob: dp, urgency: dp > 65 ? "high" : dp > 30 ? "medium" : "low",
      text: m < T.moisture.crit
        ? `Critically dry at ${m.toFixed(0)}%! Irrigate immediately.`
        : mTrend < -1.5 ? `Dropping fast ${mTrend.toFixed(1)}%/reading — irrigate soon.`
        : m < T.moisture.warn ? `Low at ${m.toFixed(0)}% — consider irrigation.`
        : `Healthy at ${m.toFixed(0)}%.`,
    },
  };

  // ── Active alerts ───────────────────────────────────────────
  const alerts = [];
  if      (w > T.water.crit) alerts.push({ type: "critical", msg: `🌊 FLOOD ALERT: Water ${w.toFixed(1)} cm — above ${T.water.crit} cm critical threshold` });
  else if (w > T.water.warn) alerts.push({ type: "warning",  msg: `⚠️ Water elevated: ${w.toFixed(1)} cm (warning at ${T.water.warn} cm)` });
  if      (g > T.gas.crit)   alerts.push({ type: "critical", msg: `☠️ GAS CRITICAL: ${g.toFixed(0)} ppm — above ${T.gas.crit} ppm limit` });
  else if (g > T.gas.warn)   alerts.push({ type: "warning",  msg: `⚠️ Gas rising: ${g.toFixed(0)} ppm (warning at ${T.gas.warn} ppm)` });
  if      (m < T.moisture.crit) alerts.push({ type: "critical", msg: `🌵 SOIL CRITICAL: Moisture ${m.toFixed(0)}% — below ${T.moisture.crit}% minimum` });
  else if (m < T.moisture.warn) alerts.push({ type: "warning",  msg: `⚠️ Soil dry: ${m.toFixed(0)}% (warning at ${T.moisture.warn}%)` });
  if (alerts.length === 0)   alerts.push({ type: "ok",       msg: `✅ All parameters within safe thresholds — no active alerts` });

  // ── Suggestions ────────────────────────────────────────────
  const suggestions = [];
  if      (w > T.water.crit) suggestions.push("🚨 Deploy flood barriers and alert downstream residents immediately");
  else if (w > T.water.warn) suggestions.push("⚠️ Pre-position drainage pumps and clear channels");
  else                       suggestions.push("✅ Water normal — no action needed");

  if      (g > T.gas.crit)   suggestions.push("🚨 Evacuate area and shut off gas supply now");
  else if (g > T.gas.warn)   suggestions.push("💨 Increase ventilation and inspect gas lines");
  else                       suggestions.push("✅ Air quality safe — continue normal operations");

  if      (m < T.moisture.crit) suggestions.push("🌵 Begin emergency irrigation immediately");
  else if (m < T.moisture.warn) suggestions.push("🌱 Schedule irrigation within the next 2 hours");
  else if (m > 80)              suggestions.push("💧 Soil saturated — pause irrigation, check drainage");
  else                          suggestions.push("✅ Soil moisture optimal — maintain current schedule");

  if (wTrend > 1)    suggestions.push("📈 Water rising trend — increase monitoring frequency");
  if (gTrend > 3)    suggestions.push("📈 Gas increasing — identify and seal the source");
  if (mTrend < -2)   suggestions.push("📉 Moisture falling fast — check irrigation system");

  return { greeting, snapshot, predictions, alerts, suggestions };
}

// ── Prediction bar ────────────────────────────────────────────
function PredBar({ label, icon, prob, urgency, text }) {
  const C = {
    low:    { bar: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0", fg: "#166534" },
    medium: { bar: "#f59e0b", bg: "#fffbeb", border: "#fde68a", fg: "#92400e" },
    high:   { bar: "#ef4444", bg: "#fef2f2", border: "#fecaca", fg: "#991b1b" },
  }[urgency] || { bar: "#22c55e", bg: "#f0fdf4", border: "#bbf7d0", fg: "#166534" };
  const p = Math.min(100, Math.max(0, Math.round(prob)));
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.fg }}>{icon} {label}</span>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          <span style={{ fontSize: 15, fontWeight: 500, color: C.fg, fontFamily: "monospace" }}>{p}%</span>
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: C.bar + "33", color: C.fg, fontWeight: 500, textTransform: "uppercase" }}>{urgency}</span>
        </div>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(0,0,0,0.08)", marginBottom: 6 }}>
        <div style={{ height: "100%", width: `${p}%`, borderRadius: 3, background: C.bar, transition: "width 1s ease" }}/>
      </div>
      <p style={{ fontSize: 12, color: C.fg, margin: 0, lineHeight: 1.5, opacity: 0.85 }}>{text}</p>
    </div>
  );
}

// ── AI message (streams in, then shows full card) ─────────────
function AIMessage({ msg }) {
  const [displayed, setDisplayed] = useState("");
  const [done,      setDone]      = useState(false);

  useEffect(() => {
    if (!msg.streaming) { setDisplayed(msg.greeting || ""); setDone(true); return; }
    const words = (msg.greeting || "").split(" ");
    let i = 0; setDisplayed("");
    const id = setInterval(() => {
      i++;
      setDisplayed(words.slice(0, i).join(" "));
      if (i >= words.length) { clearInterval(id); setDone(true); }
    }, 28);
    return () => clearInterval(id);
  }, [msg.greeting, msg.streaming]);

  return (
    <div style={{ fontSize: 14, color: "var(--color-text-primary)", lineHeight: 1.7 }}>
      <p style={{ margin: "0 0 14px", whiteSpace: "pre-wrap" }}>
        {displayed}
        {!done && <span style={{ animation: "ss-blink 0.8s infinite" }}>▍</span>}
      </p>

      {done && (
        <>
          {/* Sensor snapshot grid */}
          {msg.snapshot && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
              {msg.snapshot.map(({ label, value, unit, color, icon }) => (
                <div key={label} style={{
                  background: "var(--color-background-secondary)",
                  border: `1px solid ${color}44`, borderRadius: 10,
                  padding: "8px 10px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
                  <div style={{ fontSize: 17, fontWeight: 500, color, fontFamily: "monospace" }}>{value}{unit}</div>
                  <div style={{ fontSize: 10, color: "var(--color-text-secondary)", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Alerts */}
          {msg.alerts && (
            <div style={{ marginBottom: 14 }}>
              <p style={sectionLabel}>Active alerts</p>
              {msg.alerts.map((a, i) => (
                <div key={i} style={{
                  padding: "8px 12px", borderRadius: 8, marginBottom: 5, fontSize: 13,
                  background: a.type === "critical" ? "#fef2f2" : a.type === "warning" ? "#fffbeb" : "#f0fdf4",
                  border: `1px solid ${a.type === "critical" ? "#fecaca" : a.type === "warning" ? "#fde68a" : "#bbf7d0"}`,
                  color:  a.type === "critical" ? "#991b1b" : a.type === "warning" ? "#92400e" : "#166534",
                  animation: a.type === "critical" ? "ss-flash 2s infinite" : "none",
                }}>{a.msg}</div>
              ))}
            </div>
          )}

          {/* Predictions */}
          {msg.predictions && (
            <div style={{ marginBottom: 14 }}>
              <p style={sectionLabel}>30-minute predictions</p>
              <PredBar icon="🌊" label="Flood risk"   {...msg.predictions.flood}   />
              <PredBar icon="💨" label="Gas danger"   {...msg.predictions.gas}     />
              <PredBar icon="🌵" label="Soil dryness" {...msg.predictions.dryness} />
            </div>
          )}

          {/* Suggestions */}
          {msg.suggestions && (
            <div>
              <p style={sectionLabel}>Recommended actions</p>
              {msg.suggestions.slice(0, 4).map((s, i) => (
                <div key={i} style={{
                  padding: "7px 12px", marginBottom: 5, fontSize: 13,
                  background: "var(--color-background-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)",
                  borderLeft: "3px solid #6366f1",
                  borderRadius: "0 8px 8px 0",
                  color: "var(--color-text-primary)",
                }}>{s}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const sectionLabel = {
  fontSize: 11, fontWeight: 500, color: "var(--color-text-secondary)",
  marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.06em",
};

// ── Typing indicator ──────────────────────────────────────────
function Typing() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 18 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "#eff6ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🤖</div>
      <div style={{ padding: "11px 15px", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "18px 18px 18px 4px", display: "flex", gap: 5, alignItems: "center" }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--color-text-secondary)", animation: `ss-bounce 1.3s ${i*0.15}s infinite ease-in-out` }}/>
        ))}
      </div>
    </div>
  );
}

// ── Quick chips ───────────────────────────────────────────────
const CHIPS = [
  { label: "Hi 👋",             msg: "Hi"                                    },
  { label: "Is it safe?",       msg: "Is the environment safe right now?"     },
  { label: "Flood risk",        msg: "What is the current flood risk?"        },
  { label: "Gas status",        msg: "Explain the current gas reading"        },
  { label: "Should I irrigate?",msg: "Should I irrigate the crops right now?" },
  { label: "Full report 📊",    msg: "Give me a complete sensor status report" },
];

// ── Main export ───────────────────────────────────────────────
export default function AIChatbot({ sensorData, history = {} }) {
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const initRef    = useRef(false);

  // Welcome message on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const r = buildResponse("hello", sensorData, history);
    setMessages([{
      id: 0, role: "assistant", streaming: true,
      greeting: "Hello! 👋 I'm SmartSphere AI — your real-time environmental intelligence assistant. I'll keep you informed about gas levels, soil moisture, and flood risk 24/7. Here's your current status:",
      snapshot: r.snapshot, predictions: r.predictions,
      alerts: r.alerts, suggestions: r.suggestions, time: ts(),
    }]);
  }, []); // eslint-disable-line

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const send = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    setInput("");
    setLoading(true);

    const userMsg = { id: Date.now(), role: "user", content: text, time: ts() };
    setMessages(prev => [...prev, userMsg]);

    // Try Claude API via Cloud Function
    let cloudGreeting = null;
    try {
      const trends = { waterTrend: calcTrend(history?.water), gasTrend: calcTrend(history?.gas), moistureTrend: calcTrend(history?.moisture) };
      const chatHistory = messages.slice(-6).map(m =>
        m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.greeting || "" }
      );
      const res = await fetch(`${FUNCTIONS_URL}/smartsphereChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage: text, sensorData: sensorData || {}, trends, chatHistory }),
        signal: AbortSignal.timeout(18000),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.response && !d.error) cloudGreeting = d.response;
      }
    } catch { /* use local */ }

    // Always enrich with local predictions + alerts + suggestions
    const r = buildResponse(text, sensorData, history);

    setMessages(prev => [...prev, {
      id: Date.now() + 1, role: "assistant", streaming: true,
      greeting:    cloudGreeting || r.greeting,
      snapshot:    r.snapshot,
      predictions: r.predictions,
      alerts:      r.alerts,
      suggestions: r.suggestions,
      time:        ts(),
    }]);
    setLoading(false);
    inputRef.current?.focus();
  }, [loading, messages, sensorData, history]);

  const handleKey = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } };
  const status = overallStatus(sensorData);

  return (
    <>
      <style>{`
        @keyframes ss-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
        @keyframes ss-blink  { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes ss-flash  { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes ss-pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .ss-chip:hover:not(:disabled) { background: var(--color-background-tertiary) !important; }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", height: 560, background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 16, overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "12px 16px", background: "var(--color-background-secondary)", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#eff6ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>🤖</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>SmartSphere AI</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", animation: "ss-pulse 2s infinite" }}/>
                Always online · context-aware predictions
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, fontWeight: 500, background: status.color + "18", color: status.color, border: `1px solid ${status.color}44` }}>
            {status.emoji} {status.label}
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column" }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", alignItems: "flex-start", gap: 8, marginBottom: 18 }}>
              {msg.role === "assistant" && (
                <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: "#eff6ff", border: "1px solid #bfdbfe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, marginTop: 2 }}>🤖</div>
              )}
              <div style={{
                maxWidth: msg.role === "user" ? "62%" : "88%",
                background: msg.role === "user" ? "var(--color-background-info, #eff6ff)" : "var(--color-background-primary)",
                border: "0.5px solid var(--color-border-tertiary)",
                borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "4px 18px 18px 18px",
                padding: "12px 16px",
              }}>
                {msg.role === "user"
                  ? <p style={{ fontSize: 14, color: "var(--color-text-primary)", margin: 0, lineHeight: 1.6 }}>{msg.content}</p>
                  : <AIMessage msg={msg} />
                }
                <span style={{ fontSize: 10, color: "var(--color-text-secondary)", display: "block", marginTop: 6 }}>{msg.time}</span>
              </div>
            </div>
          ))}
          {loading && <Typing />}
          <div ref={bottomRef} />
        </div>

        {/* Quick chips */}
        <div style={{ padding: "8px 12px 6px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0, background: "var(--color-background-primary)" }}>
          {CHIPS.map(({ label, msg }) => (
            <button key={label} className="ss-chip" onClick={() => send(msg)} disabled={loading}
              style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, cursor: loading ? "not-allowed" : "pointer", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-primary)", transition: "background 0.15s" }}>
              {label}
            </button>
          ))}
        </div>

        {/* Input */}
        <div style={{ padding: "10px 12px", borderTop: "0.5px solid var(--color-border-tertiary)", display: "flex", gap: 8, alignItems: "flex-end", background: "var(--color-background-secondary)", flexShrink: 0 }}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
            placeholder="Message SmartSphere AI…" disabled={loading} rows={1}
            style={{ flex: 1, resize: "none", padding: "9px 14px", fontSize: 14, lineHeight: 1.5, borderRadius: 12, border: "0.5px solid var(--color-border-secondary)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", outline: "none", fontFamily: "inherit", maxHeight: 100, overflowY: "auto" }}
            onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
          />
          <button onClick={() => send(input)} disabled={loading || !input.trim()}
            style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: !input.trim() || loading ? "var(--color-background-tertiary)" : "#6366f1", border: "none", cursor: !input.trim() || loading ? "not-allowed" : "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", transition: "opacity 0.15s" }}>
            ➤
          </button>
        </div>

      </div>
    </>
  );
}