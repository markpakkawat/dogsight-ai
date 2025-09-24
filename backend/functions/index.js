const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const QRCode = require("qrcode");

require("dotenv").config();

const app = express();
app.use(express.json());

// Firebase Admin init

admin.initializeApp({
  databaseURL: "https://dogsight-alert.firebaseio.com"
});
const db = admin.firestore();

app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});


// LINE channel info from .env
const CHANNEL_ID = process.env.LINE_CHANNEL_ID;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CALLBACK_URL = process.env.LINE_CALLBACK_URL;

if (!CHANNEL_ID || !CHANNEL_SECRET || !CALLBACK_URL) {
  console.error("❌ Missing LINE channel environment variables.");
  process.exit(1);
}

// Endpoint 1: Generate QR code for login
app.get("/pair", async (req, res) => {
  const { deviceId } = req.query;
  if (!deviceId) return res.status(400).send("No deviceId provided");

  const state = JSON.stringify({ deviceId });
  const loginUrl = "https://access.line.me/oauth2/v2.1/authorize"
    + `?response_type=code`
    + `&client_id=${CHANNEL_ID}`
    + `&redirect_uri=${encodeURIComponent(CALLBACK_URL)}`
    + `&state=${encodeURIComponent(state)}`
    + `&scope=${encodeURIComponent("openid profile")}`;

  const qr = await QRCode.toDataURL(loginUrl);
  console.log("🧭 /pair for deviceId:", deviceId);

  res.send(`
    <h2>Scan with camera or tap the link</h2>
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
    const tokenRes = await axios.post("https://api.line.me/oauth2/v2.1/token", new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: CALLBACK_URL,
      client_id: CHANNEL_ID,
      client_secret: CHANNEL_SECRET,
    }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

    const accessToken = tokenRes.data.access_token;

    const profileRes = await axios.get("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const lineUserId = profileRes.data.userId;

    await db.collection("users").doc(lineUserId).set({
      lineUserId,
      deviceId,              
      paired: true,
      alertEnabled: false,
      polygon: [],
      lastPaired: new Date().toISOString(),
    }, { merge: true });

    res.send("✅ Pairing successful! You can close this window.");
  } catch (err) {
    console.error("❌ Error in /pair/callback:", err.response?.data || err.message);
    res.status(500).send("Error during LINE login");
  }
});


// Endpoint 3: Check if user is paired
app.get("/check-paired", async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ paired: false, error: "No deviceId provided" });
    }

    // Look up user by deviceId
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






// ✅ Test Firestore route
app.get("/test-firestore", async (req, res) => {
  try {
    const testDoc = {
      name: "Test User",
      createdAt: new Date().toISOString(),
      alertEnabled: true,
    };

    await db.collection("users").doc("test-user-123").set(testDoc);

    console.log("🔥 Test user written:", testDoc);

    res.send("✅ Firestore write successful");
  } catch (err) {
    console.error("❌ Firestore write error:", err);
    res.status(500).send("Error writing to Firestore");
  }
});

// Export as Firebase Function
exports.api = functions.https.onRequest(app);


// // LINE Webhook (user sends ON/OFF)
// app.post("/line-webhook", async (req, res) => {
//   try {
//     const events = req.body.events;
//     for (const event of events) {
//       if (event.type === "message" && event.message.type === "text") {
//         const text = event.message.text.toUpperCase();

//         if (text === "ON" || text === "OFF") {
//           const enabled = text === "ON";
//           await db.collection("settings").doc("alerts").set({ alertEnabled: enabled });

//           // Reply to user
//           await axios.post("https://api.line.me/v2/bot/message/reply", {
//             replyToken: event.replyToken,
//             messages: [{ type: "text", text: `Alerts ${enabled ? "ENABLED ✅" : "DISABLED ❌"}` }]
//           }, {
//             headers: {
//               Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
//               "Content-Type": "application/json"
//             }
//           });
//         }
//       }
//     }
//     res.sendStatus(200);
//   } catch (err) {
//     console.error(err);
//     res.sendStatus(500);
//   }
// });

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
