// /app/frontend/src/HomePage.js
import React, { useEffect, useState } from "react";
import { auth, db } from "./firebase"; // make sure your firebase.js exports both auth & db
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { watchLiveSessions } from "./webrtc/liveService.js"; // background auto-start/stop streamer

function HomePage({ lineUserId }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  // Start/stop background live watcher when Auth state changes
  useEffect(() => {
    let stopWatching = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // cleanup any previous watcher
      if (stopWatching) {
        stopWatching();
        stopWatching = null;
      }
      if (user) {
        // user.uid should equal your paired LINE userId (custom token UID)
        stopWatching = watchLiveSessions(db, user.uid);
      }
    });

    return () => {
      unsubAuth();
      if (stopWatching) stopWatching();
    };
  }, []);

  // Load initial alert state (owner-only)
  useEffect(() => {
    const fetchState = async () => {
      try {
        if (!lineUserId) return;
        const ref = doc(db, "users", lineUserId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setEnabled(!!snap.data().alertEnabled);
        } else {
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
      if (!lineUserId) return;
      const ref = doc(db, "users", lineUserId);
      await setDoc(ref, { alertEnabled: state }, { merge: true });
      setEnabled(state);
    } catch (err) {
      console.error("⚠️ Error toggling alert:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: 24 }}>
      <h2>🏠 Home Dashboard</h2>
      <p>Paired with LINE User: {lineUserId || "—"}</p>

      {/* No in-app camera preview or Go Live button.
          Streaming now runs in the background and is controlled via LINE:
          - Send "WATCH" to get a link (auto-starts stream)
          - Closing the link stops the stream automatically */}

      <h3 style={{ marginTop: 30 }}>🔘 Alert Controls</h3>
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

      <h3 style={{ marginTop: 30 }}>✏️ Define Safe Zone</h3>
      <p>[Polygon drawing tool placeholder — model output will show here later]</p>
    </div>
  );
}

export default HomePage;
