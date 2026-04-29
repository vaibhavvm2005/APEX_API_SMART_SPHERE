/**
 * SmartSphere Dashboard — React + Chart.js
 * Full production dashboard with live data, alerts, AI recommendations, simulation
 * 
 * Setup:
 *   npm create vite@latest smartsphere-dashboard -- --template react
 *   cd smartsphere-dashboard
 *   npm install chart.js react-chartjs-2 firebase axios
 *   Replace src/App.jsx and src/components/ with these files
 */

// ─────────────────────────────────────────────────────────────────────────────
// src/config/firebase.js
// ─────────────────────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey:            "YOUR_FIREBASE_API_KEY",
  authDomain:        "your-project.firebaseapp.com",
  databaseURL:       "https://your-project-default-rtdb.firebaseio.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

export const AI_ENGINE_URL = "http://localhost:8080";   // or your Cloud Run URL
export const FUNCTIONS_URL = "https://us-central1-your-project.cloudfunctions.net";