// src/components/AIChatbot.js
import React, { useState, useRef, useEffect, useCallback } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase"; // you need to export app from firebase.js

// Initialize callable function
const functions = getFunctions();
const smartsphereChat = httpsCallable(functions, "smartsphereChat");

// ── Helper: format timestamp ───────────────────────────────────────────────
function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Message bubble component (unchanged, works fine) ────────────────────────
function Message({ msg }) {
  const isUser = msg.role === "user";
  let content = msg.content;
  let isPrediction = false;
  try {
    const parsed = JSON.parse(msg.content);
    if (parsed.flood || parsed.gas || parsed.dryness) {
      isPrediction = true;
      content = parsed;
    }
  } catch { /* not JSON */ }

  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 12,
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, marginRight: 8, flexShrink: 0, marginTop: 2,
        }}>🤖</div>
      )}
      <div style={{
        maxWidth: "80%",
        background: isUser ? "#1d4ed8" : "#1e293b",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        padding: "10px 14px",
        border: isUser ? "none" : "1px solid #334155",
      }}>
        {isPrediction ? <PredictionResult data={content} /> : <p style={{ fontSize: 13, color: "#e2e8f0", margin: 0 }}>{content}</p>}
        <span style={{ fontSize: 10, color: "#64748b", display: "block", marginTop: 4 }}>{msg.time}</span>
      </div>
    </div>
  );
}

function PredictionResult({ data }) {
  const urgColor = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444" };
  const items = [
    { key: "flood",   icon: "🌊", label: "Flood" },
    { key: "gas",     icon: "💨", label: "Gas Danger" },
    { key: "dryness", icon: "🌵", label: "Soil Dryness" },
  ].filter(i => data[i.key]);
  return (
    <div>
      <p style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>30-MIN PREDICTION</p>
      {items.map(({ key, icon, label }) => {
        const d = data[key];
        const c = urgColor[d.urgency] || "#22c55e";
        return (
          <div key={key} style={{ marginBottom: 8, padding: "8px 10px", background: `${c}11`, borderRadius: 8, border: `1px solid ${c}33` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{icon} {label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: c }}>{d.probability}%</span>
            </div>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: 0 }}>{d.explanation}</p>
          </div>
        );
      })}
      {data.recommendedAction && (
        <div style={{ marginTop: 8, padding: "8px 10px", background: "#1e293b", borderRadius: 8, borderLeft: "3px solid #6366f1" }}>
          <p style={{ fontSize: 12, color: "#a5b4fc", margin: 0 }}>⚡ {data.recommendedAction}</p>
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "10px 14px", background: "#1e293b", borderRadius: "16px 16px 16px 4px", width: "fit-content", marginBottom: 12 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%", background: "#6366f1",
          animation: `bounce 1.2s ${i * 0.2}s infinite`,
        }}/>
      ))}
      <style>{`@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}}`}</style>
    </div>
  );
}

// ── Main Chatbot Component (using Firebase callable function) ────────────────
export default function AIChatbot({ sensorData, history = {} }) {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm SmartSphere AI. Ask me about your sensor data, or click 'Predict' for a 30-min risk forecast.", time: now() }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = useCallback(async (userMsg, isPredictMode = false) => {
    if (!userMsg.trim() && !isPredictMode) return;
    setLoading(true);
    const userMessageText = isPredictMode ? "Predict risks" : userMsg;
    const userMessageObj = {
      role: "user",
      content: userMessageText,
      time: now(),
    };
    setMessages(prev => [...prev, userMessageObj]);
    setInput("");

    // Calculate simple trends from history
    const trends = {
      gasTrend: calcTrend(history.gas),
      waterTrend: calcTrend(history.water),
      moistureTrend: calcTrend(history.moisture),
    };

    // Prepare chat history (last 4 messages excluding the new user message)
    const chatHistory = messages.slice(-4).map(m => ({ role: m.role, content: m.content }));

    try {
      const result = await smartsphereChat({
        userMessage: userMessageText,
        sensorData: sensorData || {},
        trends,
        chatHistory,
        isPredictMode,
      });
      const aiResponse = result.data.response;
      setMessages(prev => [...prev, {
        role: "assistant",
        content: aiResponse,
        time: now(),
      }]);
    } catch (error) {
      console.error("Callable function error:", error);
      // Fallback rule-based response
      const fallback = generateFallback(userMessageText, sensorData, isPredictMode);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: fallback,
        time: now(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [messages, sensorData, history]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && input.trim()) {
      e.preventDefault();
      sendMessage(input, false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h3 style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", margin: 0 }}>
          🤖 SMARTSPHERE AI
        </h3>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", animation: "pulse 2s infinite" }}/>
          <span style={{ fontSize: 11, color: "#64748b" }}>Claude 3 Haiku</span>
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: "auto", padding: "4px 0",
        minHeight: 280, maxHeight: 320,
        scrollbarWidth: "thin",
      }}>
        {messages.map((msg, i) => <Message key={i} msg={msg} />)}
        {loading && <TypingDots />}
        <div ref={endRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          onClick={() => sendMessage("", true)}
          disabled={loading}
          style={{
            background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff",
            border: "none", borderRadius: 10, padding: "10px 14px",
            fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
            whiteSpace: "nowrap", opacity: loading ? 0.5 : 1,
          }}
        >
          ⚡ Predict
        </button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me anything – I'm like ChatGPT with your sensor data!"
          disabled={loading}
          style={{
            flex: 1, background: "#1e293b", border: "1px solid #334155",
            borderRadius: 10, padding: "10px 14px", color: "#e2e8f0",
            fontSize: 13, outline: "none",
          }}
        />
        <button
          onClick={() => sendMessage(input, false)}
          disabled={loading || !input.trim()}
          style={{
            background: loading || !input.trim() ? "#1e293b" : "#1d4ed8",
            color: "#fff", border: "none", borderRadius: 10,
            padding: "10px 16px", fontSize: 13, cursor: loading ? "not-allowed" : "pointer",
            opacity: !input.trim() ? 0.4 : 1,
          }}
        >
          ➤
        </button>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

// ── Helper functions ─────────────────────────────────────────────────────────
function calcTrend(arr) {
  if (!arr || arr.length < 2) return 0;
  const recent = arr.slice(-5);
  return (recent[recent.length - 1] - recent[0]) / recent.length;
}

function generateFallback(userMsg, data, isPredictMode) {
  if (!data) return "No sensor data available. Please check your hardware connection.";
  const { gas_ppm = 0, moisture_pct = 50, water_cm = 0 } = data;
  if (isPredictMode) {
    const floodProb = water_cm > 70 ? 95 : water_cm > 55 ? 60 : 20;
    const gasProb   = gas_ppm  > 600 ? 90 : gas_ppm  > 400 ? 55 : 15;
    const dryProb   = moisture_pct < 15 ? 90 : moisture_pct < 20 ? 55 : 10;
    return JSON.stringify({
      flood: { probability: floodProb, explanation: water_cm > 55 ? "Water elevated." : "Water safe.", urgency: floodProb > 70 ? "high" : "low" },
      gas: { probability: gasProb, explanation: gas_ppm > 400 ? "Gas rising." : "Gas safe.", urgency: gasProb > 70 ? "high" : "low" },
      dryness: { probability: dryProb, explanation: moisture_pct < 20 ? "Soil dry." : "Soil OK.", urgency: dryProb > 70 ? "high" : "low" },
      recommendedAction: water_cm > 70 ? "Activate flood barriers." : "Continue monitoring.",
    });
  }
  const lower = userMsg.toLowerCase();
  if (lower.includes("water")) return `Water level is ${water_cm.toFixed(1)} cm. ${water_cm > 70 ? "Critical flood risk!" : "Within safe range."}`;
  if (lower.includes("gas")) return `Gas is ${gas_ppm.toFixed(0)} ppm. ${gas_ppm > 400 ? "Ventilate area." : "Safe level."}`;
  if (lower.includes("moisture")) return `Soil moisture is ${moisture_pct.toFixed(0)}%. ${moisture_pct < 20 ? "Consider irrigating." : "Adequate."}`;
  return `Current readings: Gas ${gas_ppm} ppm, Moisture ${moisture_pct}%, Water ${water_cm} cm. Ask me anything!`;
}