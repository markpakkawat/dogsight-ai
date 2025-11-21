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
- "ON" / "OFF" → Enable/disable alerts
- "STATUS" → Check alert state
`.trim();
        await reply(helpMessage);
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
    const { deviceId, message, alertType, timestamp } = req.body;

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

    // Customize emoji based on alert type
    let emoji = "🚨";
    if (alertType === "wandering") emoji = "⚠️";
    if (alertType === "returned") emoji = "✅";
    if (alertType === "disappeared") emoji = "🚨";

    const alertMessage = `${emoji} DOG ALERT ${emoji}\n\n${message}\n\nTime: ${new Date(timestamp).toLocaleString("en-US", { timeZone: "Asia/Bangkok" })}`;

    await pushText(lineUserId, alertMessage);

    // Log alert with alert type (for tracking and analytics)
    await db.collection("alertLogs").add({
      deviceId,
      lineUserId,
      message,
      alertType: alertType || "general",  // Store alert type
      timestamp: new Date(timestamp),
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ ${alertType || "general"} alert sent to ${lineUserId}: ${message}`);

    res.json({
      success: true,
      lineUserId,
      alertType: alertType || "general",
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

app.get("/health-check", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

