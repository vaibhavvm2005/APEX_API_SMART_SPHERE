// src/components/NodeMap.js
// Live Leaflet map showing sensor nodes + user geolocation

import React, { useEffect, useRef, useState, useCallback } from "react";
import { calcRiskScore, riskColor } from "../hooks/useAlertSystem";

// ── Default node locations (fallback if Firebase has no location) ─────────────
const DEFAULT_LOCATIONS = {
  node_a: { lat: 51.505,  lng: -0.09,  label: "Rural Zone A"  },
  node_b: { lat: 51.515,  lng: -0.075, label: "Urban Zone B"  },
};

// ── Inject Leaflet CSS once ───────────────────────────────────────────────────
function ensureLeafletCSS() {
  if (document.getElementById("leaflet-css")) return;
  const link = document.createElement("link");
  link.id   = "leaflet-css";
  link.rel  = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

export default function NodeMap({ nodesData = {} }) {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const markersRef      = useRef({});
  const userMarkerRef   = useRef(null);
  const watchIdRef      = useRef(null);
  const [userPos, setUserPos] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [L, setL]       = useState(null);

  // ── Load Leaflet dynamically ──────────────────────────────────────────────
  useEffect(() => {
    ensureLeafletCSS();
    const script = document.createElement("script");
    script.src  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => setL(window.L);
    document.head.appendChild(script);
    return () => {};
  }, []);

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!L || !mapContainerRef.current || mapRef.current) return;

    mapRef.current = L.map(mapContainerRef.current, {
      center:    [51.505, -0.09],
      zoom:      14,
      zoomControl: true,
    });

    // Dark tile layer
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CartoDB",
      maxZoom: 19,
    }).addTo(mapRef.current);

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [L]);

  // ── Helper: create coloured circle icon ──────────────────────────────────
  const makeNodeIcon = useCallback((color, label) => {
    if (!L) return null;
    return L.divIcon({
      className: "",
      html: `
        <div style="
          width:36px; height:36px; border-radius:50%;
          background:${color}33; border:2.5px solid ${color};
          display:flex; align-items:center; justify-content:center;
          box-shadow: 0 0 12px ${color}88;
          font-size:10px; color:#fff; font-weight:700; text-align:center;
          line-height:1.2;
        ">${label}</div>`,
      iconSize:   [36, 36],
      iconAnchor: [18, 18],
      popupAnchor:[0, -20],
    });
  }, [L]);

  const makeUserIcon = useCallback(() => {
    if (!L) return null;
    return L.divIcon({
      className: "",
      html: `<div style="
        width:18px; height:18px; border-radius:50%;
        background:#3b82f6; border:3px solid #fff;
        box-shadow:0 0 0 4px rgba(59,130,246,0.3);
        animation: ripple 1.5s infinite;
      "></div>
      <style>@keyframes ripple{0%{box-shadow:0 0 0 0 rgba(59,130,246,0.4)}70%{box-shadow:0 0 0 12px rgba(59,130,246,0)}100%{box-shadow:0 0 0 0 rgba(59,130,246,0)}}</style>`,
      iconSize:   [18, 18],
      iconAnchor: [9, 9],
    });
  }, [L]);

  // ── Update node markers when data changes ─────────────────────────────────
  useEffect(() => {
    if (!L || !mapRef.current) return;

    ["node_a", "node_b"].forEach(nodeId => {
      const data     = nodesData[nodeId];
      const loc      = data?.location || DEFAULT_LOCATIONS[nodeId];
      const score    = calcRiskScore(data);
      const color    = riskColor(score);
      const shortId  = nodeId === "node_a" ? "A" : "B";
      const icon     = makeNodeIcon(color, shortId);
      if (!icon) return;

      const popupHtml = `
        <div style="background:#111827;color:#e2e8f0;padding:10px 14px;border-radius:8px;min-width:160px;font-family:monospace">
          <b style="color:${color}">${nodeId.toUpperCase()}</b><br/>
          💨 Gas: <b>${data?.gas_ppm?.toFixed(0) ?? "—"} ppm</b><br/>
          💧 Water: <b>${data?.water_cm?.toFixed(1) ?? "—"} cm</b><br/>
          🌱 Moisture: <b>${data?.moisture_pct?.toFixed(0) ?? "—"}%</b><br/>
          <span style="color:${color};font-size:11px">Risk: ${score}%</span>
        </div>`;

      if (markersRef.current[nodeId]) {
        markersRef.current[nodeId].setLatLng([loc.lat, loc.lng]);
        markersRef.current[nodeId].setIcon(icon);
        markersRef.current[nodeId].getPopup()?.setContent(popupHtml);
      } else {
        const marker = L.marker([loc.lat, loc.lng], { icon })
          .addTo(mapRef.current)
          .bindPopup(popupHtml, { className: "ss-popup" });
        markersRef.current[nodeId] = marker;
      }
    });
  }, [L, nodesData, makeNodeIcon]);

  // ── Geolocation watch ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) { setGeoError("Geolocation not supported"); return; }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoError(null);
      },
      (err) => setGeoError(err.message),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );

    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // ── Update user marker when position changes ──────────────────────────────
  useEffect(() => {
    if (!L || !mapRef.current || !userPos) return;
    const icon = makeUserIcon();
    if (!icon) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([userPos.lat, userPos.lng]);
    } else {
      userMarkerRef.current = L.marker([userPos.lat, userPos.lng], { icon })
        .addTo(mapRef.current)
        .bindPopup("<b style='color:#3b82f6'>You are here</b>");
    }
  }, [L, userPos, makeUserIcon]);

  // ── Locate Me button ──────────────────────────────────────────────────────
  const locateMe = () => {
    if (!mapRef.current || !userPos) return;
    mapRef.current.flyTo([userPos.lat, userPos.lng], 15, { animate: true, duration: 1.2 });
  };

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ color: "#e2e8f0", fontSize: 15, fontWeight: 700, letterSpacing: "0.04em", margin: 0 }}>
          LIVE LOCATION MAP
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {geoError && <span style={{ fontSize: 11, color: "#f59e0b" }}>📍 {geoError}</span>}
          <button
            onClick={locateMe}
            style={{
              background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8,
              padding: "6px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600,
              opacity: userPos ? 1 : 0.5,
            }}
          >
            📍 Locate Me
          </button>
        </div>
      </div>

      {/* Map container */}
      <div
        ref={mapContainerRef}
        style={{
          height: 320, borderRadius: 12, overflow: "hidden",
          border: "1px solid #1e293b",
        }}
      />

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
        {[["#22c55e", "Safe"], ["#f59e0b", "Warning"], ["#ef4444", "Critical"], ["#3b82f6", "You"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: c }}/>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}