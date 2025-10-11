// /app/frontend/src/HomePage.js
import React, { useEffect, useState } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { watchLiveSessions } from "./webrtc/liveService.js";
import SafeZoneCanvas from "./components/SafeZoneCanvas.jsx";
import { useSafeZone } from "./hooks/useSafeZone.js";

function HomePage({ lineUserId }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  // background watcher (as before)
  useEffect(() => {
    let stopWatching = null;
    const unsub = onAuthStateChanged(auth, (user) => {
      if (stopWatching) { stopWatching(); stopWatching = null; }
      if (user) stopWatching = watchLiveSessions(db, user.uid);
    });
    return () => { unsub(); if (stopWatching) stopWatching(); };
  }, []);

  // alert state
  useEffect(() => {
    const run = async () => {
      if (!lineUserId) return;
      const ref = doc(db, "users", lineUserId);
      const snap = await getDoc(ref);
      if (snap.exists()) setEnabled(!!snap.data().alertEnabled);
      else await setDoc(ref, { alertEnabled: false }, { merge: true });
    };
    run();
  }, [lineUserId]);

  const toggleAlert = async (state) => {
    setLoading(true);
    try {
      if (!lineUserId) return;
      await setDoc(doc(db, "users", lineUserId), { alertEnabled: state }, { merge: true });
      setEnabled(state);
    } finally { setLoading(false); }
  };

  // safe zone load/save
  const { polygon, save, loading: zoneLoading, saving: zoneSaving } = useSafeZone(db, lineUserId);

  return (
    <div style={{ maxWidth: 960, margin:"24px auto", padding:"0 16px" }}>
      <h2>🏠 Home Dashboard</h2>
      <p>Paired LINE User: {lineUserId || "—"}</p>

      <h3 style={{ marginTop: 30 }}>🔘 Alert Controls</h3>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={() => toggleAlert(true)} disabled={loading} style={btn(enabled ? "green" : "gray")}>
          {loading ? "⏳…" : "Enable (ON)"}
        </button>
        <button onClick={() => toggleAlert(false)} disabled={loading} style={btn(!enabled ? "red" : "gray")}>
          {loading ? "⏳…" : "Disable (OFF)"}
        </button>
      </div>

      <h3 style={{ marginTop: 30 }}>🗺️ Safe Zone</h3>
      <p style={{ opacity:.8, marginTop:-6 }}>Draw the allowed area. Points are saved as normalized (0..1) coords.</p>

      <div style={{ opacity: zoneLoading ? 0.6 : 1 }}>
        <SafeZoneCanvas
          width={900}
          height={506}                 // keep aspect close to your camera; change if needed
          initialNormalized={polygon}  // load from Firestore
          onSave={async (norm) => {
            await save(norm);
            alert(zoneSaving ? "Saving..." : "Saved!");
          }}
        />
      </div>
    </div>
  );
}

const btn = (bg) => ({
  padding:"8px 12px",
  border:"0",
  borderRadius:8,
  background:bg,
  color:"#fff",
  cursor:"pointer"
});

export default HomePage;
