// index.js
const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const QRCode = require("qrcode");

require("dotenv").config();

const app = express();
app.use(express.json());

// ✅ Init Firebase Admin (Functions already injects credentials)
admin.initializeApp();
const db = admin.firestore();

// LINE channel info from .env
const LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET;
const CALLBACK_URL = process.env.LINE_CALLBACK_URL;

const LINE_MSG_CHANNEL_ACCESS_TOKEN = process.env.LINE_MSG_CHANNEL_ACCESS_TOKEN;
const LINE_MSG_CHANNEL_SECRET = process.env.LINE_MSG_CHANNEL_SECRET; // only if verifying signature

const HOSTING_ORIGIN = (process.env.HOSTING_ORIGIN || "").replace(/\/+$/, "");

if (!LOGIN_CHANNEL_ID || !LOGIN_CHANNEL_SECRET || !CALLBACK_URL) {
  console.error("❌ Missing LINE channel environment variables.");
  process.exit(1);
}

/* --------------------------- Pairing (existing) --------------------------- */

// Endpoint 1: Generate QR code for LINE login
app.get("/pair", async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.status(400).send("No deviceId provided");
  const state = JSON.stringify({ deviceId });
  const loginUrl =
    "https://access.line.me/oauth2/v2.1/authorize" +
    `?response_type=code` +
    `&client_id=${LOGIN_CHANNEL_ID}` +
    `&redirect_uri=${encodeURIComponent(CALLBACK_URL)}` +
    `&state=${encodeURIComponent(state)}` +
    `&scope=${encodeURIComponent("openid profile")}`;

  const qr = await QRCode.toDataURL(loginUrl);
  console.log("🧭 /pair for deviceId:", deviceId);

  res.send(`
    <h2>Scan with LINE app or tap the link</h2>
    <p>deviceId: <code>${deviceId}</code></p>
    <p><a href="${loginUrl}">🔗 Login link (debug)</a></p>
    <img src="${qr}" />
  `);
});

// Endpoint 2: Callback from LINE after login
app.get("/pair/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;
  if (error) return res.status(400).send(`LINE error: ${error} - ${error_description || ""}`);
  let deviceId = null;
  try {
    deviceId = JSON.parse(state).deviceId;
  } catch {
    console.warn("No deviceId in state");
  }
  try {
    // Exchange code for access token
    const tokenRes = await axios.post(
      "https://api.line.me/oauth2/v2.1/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK_URL,
        client_id: LOGIN_CHANNEL_ID,
        client_secret: LOGIN_CHANNEL_SECRET,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;

    // Fetch LINE profile
    const profileRes = await axios.get("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const lineUserId = profileRes.data.userId;

    // Save/update Firestore user
    await db.collection("users").doc(lineUserId).set(
      {
        lineUserId,
        deviceId,
        paired: true,
        alertEnabled: false,
        polygon: [],
        lastPaired: new Date().toISOString(),
      },
      { merge: true }
    );

    console.log("✅ User paired:", lineUserId);
    res.send("✅ Pairing successful! You can close this window.");
  } catch (err) {
    console.error("❌ Error in /pair/callback:", err.response?.data || err.message);
    res.status(500).send("Error during LINE login");
  }
});

// Endpoint 3: Check if any user is paired (simplified)
app.get("/check-paired", async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ paired: false, error: "No deviceId provided" });
    }
    const snapshot = await db
      .collection("users")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.json({ paired: false });
    }

    const userDoc = snapshot.docs[0].data();
    res.json({
      paired: userDoc.paired === true,
      lineUserId: userDoc.lineUserId || null,
    });
  } catch (err) {
    console.error("Error checking paired:", err);
    res.status(500).json({ paired: false, error: err.message });
  }
});

// ✅ Export Express as Firebase HTTPS Function
exports.api = functions.https.onRequest(app);

/* ---------------------- Auth custom token (existing) ---------------------- */

exports.createFirebaseToken = functions.https.onCall(async (data, context) => {
  const { lineUserId } = data;
  if (!lineUserId) throw new functions.https.HttpsError("invalid-argument", "Missing lineUserId");

  try {
    console.log("🔑 Minting custom token for:", lineUserId);
    const customToken = await admin.auth().createCustomToken(lineUserId);
    return { token: customToken };
  } catch (error) {
    console.error("❌ Error creating token:", error);
    throw new functions.https.HttpsError("internal", "Failed to create token");
  }
});

/* ----------------------------- LINE Webhook ------------------------------- */
/* Add WATCH/LIVE (create link), STOP (close latest), keep ON/OFF/STATUS/HELP */

async function replyText(replyToken, text) {
  return axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${LINE_MSG_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
  );
}

async function pushText(to, text) {
  return axios.post(
    "https://api.line.me/v2/bot/message/push",
    { to, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${LINE_MSG_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
  );
}

app.post("/line-webhook", async (req, res) => {
  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const text = (event.message.text || "").trim().toUpperCase();
      const lineUserId = event.source.userId;

      // helper to reply (same as before)
      const reply = (msg) =>
        axios.post(
          "https://api.line.me/v2/bot/message/reply",
          { replyToken: event.replyToken, messages: [{ type: "text", text: msg }] },
          { headers: { Authorization: `Bearer ${LINE_MSG_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
        );

      if (text === "ON" || text === "OFF") {
        const enabled = text === "ON";
        await db.collection("users").doc(lineUserId).set({ alertEnabled: enabled }, { merge: true });
        await reply(`Alerts ${enabled ? "ENABLED ✅" : "DISABLED ❌"}`);
        continue;
      }

      if (text === "STATUS") {
        const snap = await db.collection("users").doc(lineUserId).get();
        const msg = snap.exists
          ? `Alerts are currently: ${snap.data().alertEnabled ? "ENABLED ✅" : "DISABLED ❌"}`
          : "⚠️ No record found. Please pair first.";
        await reply(msg);
        continue;
      }

      if (text === "HELP") {
        const helpMessage = `
🐶 Dog Detection Bot Commands:
- "WATCH" / "LIVE" → Get a live link (auto starts/ends)
- "STOP" → Stop the current live stream
- "ON" / "OFF" → Enable/disable alerts
- "STATUS" → Check alert state
`.trim();
        await reply(helpMessage);
        continue;
      }

      // NEW: issue a live link and signal Electron to auto-start
      if (text === "WATCH" || text === "LIVE") {
        if (!HOSTING_ORIGIN) {
          await reply("❗Server is missing HOSTING_ORIGIN.");
          continue;
        }

        const now = admin.firestore.Timestamp.now();
        const ttlMs = 30 * 60 * 1000; // 30 minutes
        const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + ttlMs);

        // create session under /streams/{userId}/sessions/{sessionId}
        const sessionRef = db.collection("streams").doc(lineUserId).collection("sessions").doc();
        await sessionRef.set(
          {
            hostUid: lineUserId,
            status: "open",
            createdAt: now,
            expiresAt,
            hostRequested: true,      // Electron watcher will see this and start
            hostActive: false,
            lastViewerPing: now,      // viewer will keep this fresh
            candidatesHost: [],
            candidatesViewer: [],
          },
          { merge: true }
        );

        // create short-lived watch token
        const tokenId = db.collection("watchTokens").doc().id;
        await db.collection("watchTokens").doc(tokenId).set({
          userId: lineUserId,
          sessionId: sessionRef.id,
          createdAt: now,
          expiresAt,
          consumed: false,
        });

        // build viewer URL
        const watchUrl = `${HOSTING_ORIGIN}/watch/${encodeURIComponent(lineUserId)}/${encodeURIComponent(
          sessionRef.id
        )}?t=${encodeURIComponent(tokenId)}`;

        await reply(`Live link (30m): ${watchUrl}`);
        continue;
      }

      // NEW: stop the latest open session
      if (text === "STOP") {
        const open = await db
          .collection("streams").doc(lineUserId).collection("sessions")
          .where("status", "==", "open").orderBy("createdAt", "desc").limit(1).get();

        if (open.empty) {
          await reply("No live session found.");
        } else {
          const sid = open.docs[0].id;
          await db.collection("streams").doc(lineUserId).collection("sessions").doc(sid)
                  .set({ status: "closed" }, { merge: true });
          await reply("✅ Stopped live.");
        }
        continue;
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ LINE webhook error:", err);
    res.sendStatus(500);
  }
});


app.post("/toggle-alert", async (req, res) => {
  try {
    const { deviceId, enabled } = req.body;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: "Missing deviceId" });
    }

    // Find user by deviceId
    const snapshot = await db
      .collection("users")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: "Device not found" });
    }

    const userDoc = snapshot.docs[0];
    
    // Update alert status
    await userDoc.ref.set({ alertEnabled: enabled }, { merge: true });

    // Send success response
    res.json({ 
      success: true, 
      alertEnabled: enabled 
    });

  } catch (err) {
    console.error("Toggle alert error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

app.get("/check-alert", async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: "Missing deviceId" });
    }

    const snapshot = await db
      .collection("users")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: "Device not found" });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    res.json({ 
      success: true, 
      alertEnabled: !!userData.alertEnabled 
    });

  } catch (err) {
    console.error("Check alert error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

// Send dog alert notification
app.post("/send-dog-alert", async (req, res) => {
  try {
    const { deviceId, message, timestamp } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, error: "Missing deviceId" });
    }

    // Find user by deviceId
    const snapshot = await db
      .collection("users")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ success: false, error: "Device not found" });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // Check if alerts are enabled
    if (!userData.alertEnabled) {
      return res.json({
        success: false,
        reason: "Alerts disabled"
      });
    }

    // Send LINE push notification
    const lineUserId = userData.lineUserId;
    const alertMessage = `🚨 DOG ALERT 🚨\n\n${message}\n\nTime: ${new Date(timestamp).toLocaleString("en-US", { timeZone: "Asia/Bangkok" })}`;

    await pushText(lineUserId, alertMessage);

    // Log alert (optional - for tracking)
    await db.collection("alertLogs").add({
      deviceId,
      lineUserId,
      message,
      timestamp: new Date(timestamp),
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Alert sent to ${lineUserId}: ${message}`);

    res.json({
      success: true,
      lineUserId,
      message: "Alert sent successfully"
    });

  } catch (err) {
    console.error("❌ Send alert error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});

/* ---------------------- Link creation (callable API) ---------------------- */

exports.createWatchLink = functions.https.onCall(async (data, ctx) => {
  try {
    const userId = (data && data.userId) || (ctx.auth && ctx.auth.uid) || data?.lineUserId;
    if (!userId) throw new functions.https.HttpsError("invalid-argument", "Missing userId.");
    if (!HOSTING_ORIGIN) throw new functions.https.HttpsError("failed-precondition", "HOSTING_ORIGIN not set.");

    // 1) Create a session doc
    const sessionRef = db.collection("streams").doc(userId).collection("sessions").doc();
    const now = admin.firestore.Timestamp.now();
    const ttlMs = 30 * 60 * 1000; // 30 minutes
    const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + ttlMs);

    await sessionRef.set(
      {
        hostUid: userId,
        status: "open",
        createdAt: now,
        expiresAt,
        // Signal Electron to auto-start
        hostRequested: true,
        hostActive: false,
        lastViewerPing: now,
        candidatesHost: [],
        candidatesViewer: [],
      },
      { merge: true }
    );

    // 2) Create a watch token
    const tokenId = db.collection("watchTokens").doc().id;
    await db.collection("watchTokens").doc(tokenId).set({
      userId,
      sessionId: sessionRef.id,
      createdAt: now,
      expiresAt,
      consumed: false,
    });

    // 3) Build the viewer URL
    const watchUrl = `${HOSTING_ORIGIN}/watch/${encodeURIComponent(userId)}/${encodeURIComponent(
      sessionRef.id
    )}?t=${encodeURIComponent(tokenId)}`;

    return { watchUrl, sessionId: sessionRef.id, expiresAt: expiresAt.toMillis() };
  } catch (err) {
    console.error("createWatchLink error:", err);
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError("internal", "Failed to create watch link");
  }
});

/* ----------------------- Token verify (existing) -------------------------- */

exports.verifyWatchToken = functions.https.onCall(async (data) => {
  const { tokenId, userId, sessionId } = data || {};
  if (!tokenId || !userId || !sessionId) {
    throw new functions.https.HttpsError("invalid-argument", "tokenId, userId, and sessionId are required.");
  }

  const docSnap = await db.collection("watchTokens").doc(tokenId).get();
  if (!docSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Invalid token.");
  }

  const t = docSnap.data();
  const nowMs = Date.now();

  if (t.userId !== userId || t.sessionId !== sessionId) {
    throw new functions.https.HttpsError("permission-denied", "Token does not match session.");
  }
  if (t.expiresAt.toMillis() < nowMs) {
    throw new functions.https.HttpsError("deadline-exceeded", "Token expired.");
  }

  const sessionRef = db.collection("streams").doc(userId).collection("sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Session not found.");
  }
  const s = sessionSnap.data();
  if (s.status && s.status !== "open") {
    throw new functions.https.HttpsError("permission-denied", "Session is closed.");
  }

  return { ok: true };
});

/* ------------- Viewer signaling proxy (existing, unchanged) -------------- */

// Helper to assert token validity (same logic as verifyWatchToken)
async function _checkWatchToken({ tokenId, userId, sessionId }) {
  const tSnap = await db.collection("watchTokens").doc(tokenId).get();
  if (!tSnap.exists) throw new functions.https.HttpsError("not-found", "Invalid token.");
  const t = tSnap.data();
  if (t.userId !== userId || t.sessionId !== sessionId) {
    throw new functions.https.HttpsError("permission-denied", "Token/session mismatch.");
  }
  if (t.expiresAt.toMillis() < Date.now()) {
    throw new functions.https.HttpsError("deadline-exceeded", "Token expired.");
  }
  const sessionRef = db.collection("streams").doc(userId).collection("sessions").doc(sessionId);
  const sSnap = await sessionRef.get();
  if (!sSnap.exists) throw new functions.https.HttpsError("not-found", "Session not found.");
  const s = sSnap.data();
  if (s.status && s.status !== "open") {
    throw new functions.https.HttpsError("permission-denied", "Session closed.");
  }
  return { sessionRef, session: s };
}

/**
 * getSignaling
 * Input: { tokenId, userId, sessionId, sinceIdx? }
 * Output: { offer, hostCandidates, nextIdx, status }
 */
exports.getSignaling = functions.https.onCall(async (data) => {
  const { tokenId, userId, sessionId, sinceIdx } = data || {};
  if (!tokenId || !userId || !sessionId) {
    throw new functions.https.HttpsError("invalid-argument", "tokenId, userId, sessionId required.");
  }
  const { sessionRef } = await _checkWatchToken({ tokenId, userId, sessionId });
  const snap = await sessionRef.get();
  const s = snap.data() || {};
  const all = Array.isArray(s.candidatesHost) ? s.candidatesHost : [];
  const start = Number.isInteger(sinceIdx) && sinceIdx >= 0 ? sinceIdx : 0;
  const slice = all.slice(start);
  return {
    offer: s.offer || null,
    hostCandidates: slice,
    nextIdx: all.length,
    status: s.status || "open",
  };
});

/**
 * postAnswer
 * Input: { tokenId, userId, sessionId, answer }
 * Output: { ok: true }
 */
exports.postAnswer = functions.https.onCall(async (data) => {
  const { tokenId, userId, sessionId, answer } = data || {};
  if (!tokenId || !userId || !sessionId || !answer || !answer.type || !answer.sdp) {
    throw new functions.https.HttpsError("invalid-argument", "Missing answer or ids.");
  }
  const { sessionRef } = await _checkWatchToken({ tokenId, userId, sessionId });
  await sessionRef.set({ answer }, { merge: true });
  return { ok: true };
});

/**
 * postViewerCandidate
 * Input: { tokenId, userId, sessionId, candidate }
 * Output: { ok: true }
 */
exports.postViewerCandidate = functions.https.onCall(async (data) => {
  const { tokenId, userId, sessionId, candidate } = data || {};
  if (!tokenId || !userId || !sessionId || !candidate) {
    throw new functions.https.HttpsError("invalid-argument", "Missing candidate or ids.");
  }
  const { sessionRef } = await _checkWatchToken({ tokenId, userId, sessionId });
  await sessionRef.update({
    candidatesViewer: admin.firestore.FieldValue.arrayUnion(candidate),
  });
  return { ok: true };
});

/* ------------------- Viewer heartbeat (new for link-only) ----------------- */

/**
 * viewerPing
 * Input: { tokenId, userId, sessionId }
 * Output: { ok: true }
 * Called by viewer every ~3s; Electron will stop if heartbeat is stale.
 */
exports.viewerPing = functions.https.onCall(async (data) => {
  const { tokenId, userId, sessionId } = data || {};
  const { sessionRef } = await _checkWatchToken({ tokenId, userId, sessionId });
  await sessionRef.update({ lastViewerPing: admin.firestore.Timestamp.now() });
  return { ok: true };
});

/* -------------------- Owner close + scheduled sweepers -------------------- */

// --- helpers ---
function nowTs() { return admin.firestore.Timestamp.now(); }
function minutesAgoTs(min) {
  return admin.firestore.Timestamp.fromMillis(Date.now() - min * 60 * 1000);
}

/**
 * closeSession (callable)
 * Input: { userId, sessionId }
 * Owner-only; sets status:"closed" and scrubs volatile signaling fields.
 */
exports.closeSession = functions.https.onCall(async (data, ctx) => {
  const { userId, sessionId } = data || {};
  if (!userId || !sessionId) {
    throw new functions.https.HttpsError("invalid-argument", "userId and sessionId required.");
  }
  if (!ctx.auth || ctx.auth.uid !== userId) {
    throw new functions.https.HttpsError("permission-denied", "Not your session.");
  }

  const ref = db.collection("streams").doc(userId).collection("sessions").doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError("not-found", "Session not found.");

  await ref.set({
    status: "closed",
    closedAt: nowTs(),
    offer: admin.firestore.FieldValue.delete(),
    answer: admin.firestore.FieldValue.delete(),
    candidatesHost: admin.firestore.FieldValue.delete(),
    candidatesViewer: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  return { ok: true };
});

/**
 * sweepExpiredWatch (scheduled)
 * - Closes sessions past expiresAt
 * - Deletes expired or long-done tokens
 * Runs every 15 minutes, Bangkok time.
 */
exports.sweepExpiredWatch = functions.pubsub
  .schedule("every 15 minutes")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const now = nowTs();

    // 1) Close sessions that are past expiresAt but still open
    const streamsRoot = db.collection("streams");
    const usersSnap = await streamsRoot.get();
    const batch = db.batch();
    let ops = 0;

    for (const userDoc of usersSnap.docs) {
      const sessCol = userDoc.ref.collection("sessions");
      const sessSnap = await sessCol.where("expiresAt", "<=", now).get();
      for (const s of sessSnap.docs) {
        const data = s.data();
        if (!data.status || data.status === "open") {
          batch.set(s.ref, {
            status: "closed",
            closedAt: now,
            offer: admin.firestore.FieldValue.delete(),
            answer: admin.firestore.FieldValue.delete(),
            candidatesHost: admin.firestore.FieldValue.delete(),
            candidatesViewer: admin.firestore.FieldValue.delete(),
          }, { merge: true });
          ops++;
          if (ops >= 400) { await batch.commit(); ops = 0; }
        }
      }
    }
    if (ops > 0) await batch.commit();

    // 2) Delete expired tokens (and stale consumed tokens older than 1 day)
    const tokenCol = db.collection("watchTokens");
    const expiredTokens = await tokenCol.where("expiresAt", "<=", now).get();
    const staleConsumed = await tokenCol
      .where("consumed", "==", true)
      .where("createdAt", "<=", minutesAgoTs(60 * 24))
      .get();

    let delBatch = db.batch();
    let dels = 0;
    for (const d of expiredTokens.docs) {
      delBatch.delete(d.ref); dels++;
      if (dels >= 450) { await delBatch.commit(); delBatch = db.batch(); dels = 0; }
    }
    for (const d of staleConsumed.docs) {
      delBatch.delete(d.ref); dels++;
      if (dels >= 450) { await delBatch.commit(); delBatch = db.batch(); dels = 0; }
    }
    if (dels > 0) await delBatch.commit();

    console.log("sweepExpiredWatch done");
    return null;
  });

/**
 * sweepOldClosedSessions (scheduled)
 * - Hard-deletes sessions closed > 7 days ago.
 * Prevents unbounded growth.
 */
exports.sweepOldClosedSessions = functions.pubsub
  .schedule("every 24 hours")
  .timeZone("Asia/Bangkok")
  .onRun(async () => {
    const cutoff = minutesAgoTs(60 * 24 * 7); // 7 days ago
    const usersSnap = await db.collection("streams").get();
    let batch = db.batch();
    let ops = 0;

    for (const userDoc of usersSnap.docs) {
      const sessCol = userDoc.ref.collection("sessions");
      const oldClosed = await sessCol
        .where("status", "==", "closed")
        .where("closedAt", "<=", cutoff)
        .get();

      for (const s of oldClosed.docs) {
        batch.delete(s.ref);
        ops++;
        if (ops >= 450) { await batch.commit(); batch = db.batch(); ops = 0; }
      }
    }
    if (ops > 0) await batch.commit();

    console.log("sweepOldClosedSessions done");
    return null;
  });

app.get("/health-check", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

