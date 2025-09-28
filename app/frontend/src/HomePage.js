import React, { useEffect, useState } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onSnapshot } from "firebase/firestore"; // to watch doc changes
import { onSnapshot as onConnectionSnapshot } from "firebase/firestore"; // alias

function HomePage({ lineUserId }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("🔄 Connecting...");

  // Monitor Firestore connection state
  useEffect(() => {
    const unsubscribe = onConnectionSnapshot(doc(db, ".info/connected"), (snap) => {
      if (snap.exists() && snap.data() === true) {
        setStatus("✅ Firestore is online");
        console.log("✅ Firestore is online");
      } else {
        setStatus("⚠️ Firestore is offline");
        console.warn("⚠️ Firestore is offline");
      }
    });

    return () => unsubscribe();
  }, []);

  // Load initial alert state
  useEffect(() => {
    const fetchState = async () => {
      try {
        if (!lineUserId) return;
        const ref = doc(db, "users", lineUserId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setEnabled(snap.data().alertEnabled || false);
        } else {
          // Initialize doc if missing
          await setDoc(ref, { alertEnabled: false }, { merge: true });
          setEnabled(false);
        }
      } catch (err) {
        console.error("⚠️ Error fetching alert state:", err);
      }
    };
    fetchState();
  }, [lineUserId]);

  // Toggle alert ON/OFF
  const toggleAlert = async (state) => {
    setLoading(true);
    try {
      const ref = doc(db, "users", lineUserId);
      await setDoc(ref, { alertEnabled: state }, { merge: true });
      setEnabled(state);
    } catch (err) {
      console.error("⚠️ Error toggling alert:", err);
    }
    setLoading(false);
  };

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h2>🏠 Home Dashboard</h2>
      <p>Paired with LINE User: {lineUserId}</p>
      <p style={{ marginTop: "10px", fontStyle: "italic", color: "#555" }}>{status}</p>

      <div style={{ marginTop: "30px" }}>
        <h3>🎥 Video Streaming</h3>
        <div
          style={{
            width: "640px",
            height: "360px",
            border: "1px solid #ccc",
            margin: "auto",
          }}
        >
          <p>Video will go here</p>
        </div>

        <h3 style={{ marginTop: "30px" }}>🔘 Alert Controls</h3>
        <div>
          <button
            onClick={() => toggleAlert(true)}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: enabled ? "green" : "gray",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              marginRight: "10px",
            }}
          >
            {loading ? "⏳..." : enabled ? "✅ Alerts ON" : "Enable Alerts"}
          </button>

          <button
            onClick={() => toggleAlert(false)}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: !enabled ? "red" : "gray",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            {loading ? "⏳..." : !enabled ? "❌ Alerts OFF" : "Disable Alerts"}
          </button>
        </div>

        <h3 style={{ marginTop: "30px" }}>✏️ Define Safe Zone</h3>
        <p>[Polygon drawing tool placeholder]</p>
      </div>
    </div>
  );
}

export default HomePage;
