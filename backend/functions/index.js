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

// ✅ Export as Firebase HTTPS Function
exports.api = functions.https.onRequest(app);

// ✅ Firebase Auth custom token function
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

// LINE Webhook: listen for user messages "ON"/"OFF"
// LINE Webhook: listen for user messages "ON"/"OFF"/"STATUS"/"HELP"
app.post("/line-webhook", async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim().toUpperCase();
        const lineUserId = event.source.userId;

        if (text === "ON" || text === "OFF") {
          const enabled = text === "ON";

          // Update Firestore
          await db.collection("users").doc(lineUserId).set(
            { alertEnabled: enabled },
            { merge: true }
          );

          // Reply
          await axios.post(
            "https://api.line.me/v2/bot/message/reply",
            {
              replyToken: event.replyToken,
              messages: [
                { type: "text", text: `Alerts ${enabled ? "ENABLED ✅" : "DISABLED ❌"}` },
              ],
            },
            {
              headers: {
                Authorization: `Bearer ${LINE_MSG_CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
              },
            }
          );

          console.log(`🔔 Alerts set to ${enabled} for user ${lineUserId}`);
        } 
        
        else if (text === "STATUS") {
          // Fetch state
          const snap = await db.collection("users").doc(lineUserId).get();
          let msg = "⚠️ No record found. Please pair first.";
          if (snap.exists) {
            const data = snap.data();
            msg = `Alerts are currently: ${data.alertEnabled ? "ENABLED ✅" : "DISABLED ❌"}`;
          }

          await axios.post(
            "https://api.line.me/v2/bot/message/reply",
            {
              replyToken: event.replyToken,
              messages: [{ type: "text", text: msg }],
            },
            {
              headers: {
                Authorization: `Bearer ${LINE_MSG_CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
              },
            }
          );

          console.log(`📡 Sent STATUS reply to user ${lineUserId}`);
        } 
        
        else if (text === "HELP") {
          // 👉 Edit this text block anytime
          const helpMessage = `
🐶 Dog Detection Bot Commands:
- Type "ON" → Enable alerts
- Type "OFF" → Disable alerts
- Type "STATUS" → Check current alert state
- Type "HELP" → Show this help message

⚙️ Others instructions will be listed here.
`;

          await axios.post(
            "https://api.line.me/v2/bot/message/reply",
            {
              replyToken: event.replyToken,
              messages: [{ type: "text", text: helpMessage }],
            },
            {
              headers: {
                Authorization: `Bearer ${LINE_MSG_CHANNEL_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
              },
            }
          );

          console.log(`📖 Sent HELP instructions to user ${lineUserId}`);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ LINE webhook error:", err);
    res.sendStatus(500);
  }
});


// // Endpoint to simulate dog outside event
// app.post("/dog-event", async (req, res) => {
//   const { outside } = req.body;

//   const settingsRef = db.collection("settings").doc("alerts");
//   const doc = await settingsRef.get();

//   if (doc.exists && doc.data().alertEnabled && outside) {
//     // Send LINE alert
//     await axios.post("https://api.line.me/v2/bot/message/push", {
//       to: process.env.LINE_USER_ID,
//       messages: [{ type: "text", text: "🚨 Your dog is outside the safe zone!" }]
//     }, {
//       headers: {
//         Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
//         "Content-Type": "application/json"
//       }
//     });
//   }

//   res.json({ success: true });
// });

// app.listen(3000, () => console.log("Server running on port 3000"));
