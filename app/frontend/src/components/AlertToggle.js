import React, { useState, useEffect } from "react";

export default function AlertToggle({ deviceId }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  // Handle toggle click
  const handleToggle = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:4000/toggle-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, enabled: !enabled }),
      });
      const data = await res.json();
      if (data.success) {
        setEnabled(data.alertEnabled);
      } else {
        console.error("Toggle failed:", data.error);
      }
    } catch (err) {
      console.error("Request error:", err);
    }
    setLoading(false);
  };

  return (
    <div style={{ margin: "1rem" }}>
      <button
        onClick={handleToggle}
        disabled={loading}
        style={{
          padding: "0.5rem 1rem",
          backgroundColor: enabled ? "green" : "gray",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
        }}
      >
        {loading ? "⏳ Updating..." : enabled ? "✅ Alerts ON" : "❌ Alerts OFF"}
      </button>
    </div>
  );
}
