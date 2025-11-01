import React, { useState} from "react";

export default function AlertToggle({ deviceId, enabled, onStateChange, isOnline }) {
  const [loading, setLoading] = useState(false);

  // Handle toggle click
  const handleToggle = async () => {
    if (!isOnline) {
      alert("Cannot toggle alerts while offline");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_API_BASE}/toggle-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, enabled: !enabled }),
      });
      const data = await res.json();
      if (data.success) {
        onStateChange(data.alertEnabled);
      } else {
        console.error("Toggle failed:", data.error);
      }
    } catch (err) {
      console.error("Request error:", err);
      alert("Failed to toggle alerts. Please check your connection.");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", gap: "1rem", margin: "1rem" }}>
      <button
        onClick={handleToggle}
        disabled={loading || !isOnline}
        style={{
          padding: "0.5rem 1rem",
          backgroundColor: enabled ? "green" : "gray",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          opacity: !isOnline ? 0.6 : 1
        }}
      >
        {loading ? "⏳ Updating..." : enabled ? "✅ Alerts ON" : "❌ Alerts OFF"}
        {!isOnline && " (Offline)"}
      </button>
    </div>
  );
}
