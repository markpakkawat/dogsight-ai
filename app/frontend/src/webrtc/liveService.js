// app/renderer/liveService.js
import {
  collection, query, where, orderBy, limit,
  onSnapshot, getDoc, doc, setDoc
} from "firebase/firestore";
import { startBroadcast } from "./broadcaster.js"; // your broadcaster.js

export function watchLiveSessions(db, userId) {
  let handle = null;
  let sessionRef = null;
  let heartbeatTimer = null;

  const start = async (sid) => {
    sessionRef = doc(db, "streams", userId, "sessions", sid);
    handle = await startBroadcast(db, userId, sid);
    await setDoc(sessionRef, { hostActive: true }, { merge: true });

    // stop if viewer heartbeat goes stale (>10s)
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      const snap = await getDoc(sessionRef);
      const data = snap.data() || {};
      const last = data.lastViewerPing?.toMillis?.() || 0;
      if (Date.now() - last > 10000) {
        await setDoc(sessionRef, { status: "closed" }, { merge: true });
      }
    }, 5000);
  };

  const stop = async () => {
    clearInterval(heartbeatTimer);
    if (handle) { handle.stop(); handle = null; }
    sessionRef = null;
  };

  const qOpen = query(
    collection(db, "streams", userId, "sessions"),
    where("status", "==", "open"),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  const unsub = onSnapshot(qOpen, async (qs) => {
    if (qs.empty) { await stop(); return; }
    const d = qs.docs[0];
    const s = d.data();

    if (s.hostRequested && !s.hostActive && !handle) {
      await start(d.id);
      return;
    }
    if (s.status && s.status !== "open") {
      await stop();
    }
  });

  return () => { unsub(); stop(); };
}
