// src/components/Logo.js
export default function Logo({ width = 120, height = 120 }) {
  return (
    <svg width={width} height={height} viewBox="0 0 400 400"
      xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sphereGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "#1a73e8", stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: "#34a853", stopOpacity: 1 }} />
        </linearGradient>
      </defs>
      <circle cx="200" cy="180" r="120" fill="none"
        stroke="url(#sphereGrad)" strokeWidth="8" strokeDasharray="10 5" />
      <path d="M100 220 Q 140 160, 200 200 T 280 180"
        fill="none" stroke="#34a853" strokeWidth="6" strokeLinecap="round" />
      <path d="M110 240 Q 150 200, 200 230"
        fill="none" stroke="#34a853" strokeWidth="4" opacity="0.6" />
      <rect x="210" y="140" width="15" height="60" fill="#1a73e8" />
      <rect x="230" y="110" width="15" height="90" fill="#1a73e8" />
      <rect x="250" y="155" width="15" height="45" fill="#1a73e8" />
      <circle cx="200" cy="180" r="15" fill="#4285f4" />
      <circle cx="200" cy="180" r="25" fill="none"
        stroke="#4285f4" strokeWidth="2" opacity="0.5">
        <animate attributeName="r" values="25;35;25" dur="3s" repeatCount="indefinite" />
      </circle>
      <line x1="200" y1="180" x2="140" y2="150" stroke="#4285f4" strokeWidth="2" />
      <line x1="200" y1="180" x2="260" y2="230" stroke="#4285f4" strokeWidth="2" />
      <circle cx="140" cy="150" r="5" fill="#4285f4" />
      <circle cx="260" cy="230" r="5" fill="#4285f4" />
      <text x="200" y="340" fontFamily="Arial, sans-serif" fontSize="36"
        fontWeight="bold" textAnchor="middle" fill="#202124">
        SMARTSPHERE
      </text>
      <text x="200" y="370" fontFamily="Arial, sans-serif" fontSize="12"
        letterSpacing="2" textAnchor="middle" fill="#5f6368">
        AI-POWERED MONITORING
      </text>
    </svg>
  );
}