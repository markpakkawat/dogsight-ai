// app/renderer/liveService.js
import {
  collection, query, where, orderBy, limit,
  onSnapshot, getDoc, doc, setDoc
} from "firebase/firestore";
import { startBroadcast } from "./broadcaster.js"; // your broadcaster.js

export function watchLiveSessions(db, userId, onStatusChange = null) {
  let handle = null;
  let sessionRef = null;
  let heartbeatTimer = null;

  // Helper to emit status updates
  const emitStatus = (status, message) => {
    console.log(`📡 Stream status: ${status} - ${message}`);
    if (onStatusChange) {
      onStatusChange({ status, message, timestamp: Date.now() });
    }
  };

  const start = async (sid) => {
    try {
      // Stop any existing session first (only one camera available)
      if (handle) {
        console.log("Stopping previous stream session to start new one");
        emitStatus("switching", "Switching to new stream request...");
        await stop();
      }

      emitStatus("preparing", "Preparing camera for streaming...");
      sessionRef = doc(db, "streams", userId, "sessions", sid);

      emitStatus("starting", "Starting broadcast...");
      handle = await startBroadcast(db, userId, sid);
      await setDoc(sessionRef, { hostActive: true }, { merge: true });

      emitStatus("active", "Stream is live! Viewers can now watch.");

      // stop if viewer heartbeat goes stale (>2 minutes)
      // This gives users time to receive and click the link
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(async () => {
        const snap = await getDoc(sessionRef);
        const data = snap.data() || {};
        const last = data.lastViewerPing?.toMillis?.() || 0;
        // Only check if lastViewerPing exists (viewer has connected)
        if (last > 0 && Date.now() - last > 120000) {
          console.log("Viewer heartbeat stale, closing session");
          emitStatus("stopping", "No viewers detected, stopping stream...");
          await setDoc(sessionRef, { status: "closed" }, { merge: true });
        }
      }, 5000);
    } catch (error) {
      console.error("Failed to start broadcast:", error);
      emitStatus("error", `Failed to start stream: ${error.message}`);
      throw error;
    }
  };

  const stop = async () => {
    emitStatus("stopping", "Stopping stream and resuming detection...");
    clearInterval(heartbeatTimer);
    if (handle) { handle.stop(); handle = null; }
    sessionRef = null;
    emitStatus("idle", "Ready for streaming requests");
  };

  // Watch for ANY open session requests (removed limit to allow multiple concurrent requests)
  // Note: Only one session can be active at a time due to camera constraints,
  // but we'll process the most recent request and close older ones
  const qOpen = query(
    collection(db, "streams", userId, "sessions"),
    where("status", "==", "open"),
    orderBy("createdAt", "desc"),
    limit(1) // Keep limit(1) for now to handle most recent session
  );

  // Initialize as idle
  emitStatus("idle", "Watching for streaming requests...");

  const unsub = onSnapshot(qOpen, async (qs) => {
    if (qs.empty) { await stop(); return; }
    const d = qs.docs[0];
    const s = d.data();

    if (s.hostRequested && !s.hostActive && !handle) {
      console.log("Starting broadcast for session:", d.id);
      emitStatus("requested", "Stream requested via LINE");
      await start(d.id);
      return;
    }
    if (s.status && s.status !== "open") {
      console.log("Session closed, stopping broadcast");
      await stop();
    }
  });

  return () => { unsub(); stop(); };
}
