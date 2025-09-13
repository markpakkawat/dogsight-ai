// Instead of import
const express = require("express");
const dotenv = require("dotenv");
const axios = require("axios");
const admin = require("firebase-admin");

dotenv.config();

const app = express();
app.use(express.json());

// Firebase Admin init
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

// LINE Webhook (user sends ON/OFF)
app.post("/line-webhook", async (req, res) => {
  try {
    const events = req.body.events;
    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.toUpperCase();

        if (text === "ON" || text === "OFF") {
          const enabled = text === "ON";
          await db.collection("settings").doc("alerts").set({ alertEnabled: enabled });

          // Reply to user
          await axios.post("https://api.line.me/v2/bot/message/reply", {
            replyToken: event.replyToken,
            messages: [{ type: "text", text: `Alerts ${enabled ? "ENABLED ✅" : "DISABLED ❌"}` }]
          }, {
            headers: {
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
              "Content-Type": "application/json"
            }
          });
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// Endpoint to simulate dog outside event
app.post("/dog-event", async (req, res) => {
  const { outside } = req.body;

  const settingsRef = db.collection("settings").doc("alerts");
  const doc = await settingsRef.get();

  if (doc.exists && doc.data().alertEnabled && outside) {
    // Send LINE alert
    await axios.post("https://api.line.me/v2/bot/message/push", {
      to: process.env.LINE_USER_ID,
      messages: [{ type: "text", text: "🚨 Your dog is outside the safe zone!" }]
    }, {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  }

  res.json({ success: true });
});

app.listen(3000, () => console.log("Server running on port 3000"));
