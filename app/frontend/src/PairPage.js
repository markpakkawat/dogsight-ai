import React, { useEffect, useState } from "react";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { app } from "./firebase.js";
import { v4 as uuidv4 } from "uuid";

const BASE = process.env.REACT_APP_API_BASE;

function PairPage({ onPaired }) {
  const [qrHtml, setQrHtml] = useState("");

  // persistent deviceId per app install
  const [deviceId] = useState(() => {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = uuidv4();
      localStorage.setItem("deviceId", id);
    }
    return id;
  });
  // Step 1: fetch QR
  useEffect(() => {
    const url = `${BASE}/pair?deviceId=${encodeURIComponent(deviceId)}`;
    fetch(url, {
      headers: { "ngrok-skip-browser-warning": "true" },
    })
      .then((res) => res.text())
      .then((html) => {
        if (html && html.includes("<img")) {
          // Extract just the img tag
          const imgMatch = html.match(/<img[^>]+>/);
          setQrHtml(imgMatch ? imgMatch[0] : '<p>⚠️ Error loading QR code.</p>');
        } else {
          setQrHtml('<p>⚠️ Error loading QR code. Please try again.</p>');
        }
      })
      .catch(() =>
        setQrHtml('<p>⚠️ Error loading QR code. Please try again.</p>')
      );
  }, [deviceId]);

  // Step 2: poll pairing
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${BASE}/check-paired?deviceId=${encodeURIComponent(deviceId)}&ts=${Date.now()}`,
          { headers: { "ngrok-skip-browser-warning": "true" } }
        );

        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const txt = await res.text();
          console.warn("Non-JSON from /check-paired:", txt.slice(0, 120));
          return;
        }

        const data = await res.json();
        console.log("🔍 Polling result:", data);

        if (data.paired && data.lineUserId) {
          try {
            // Get custom Firebase token
            const functions = getFunctions(app);
            const createToken = httpsCallable(functions, "createFirebaseToken");
            const result = await createToken({ lineUserId: data.lineUserId });

            // Sign in to Firebase
            const auth = getAuth(app);
            await signInWithCustomToken(auth, result.data.token);
            console.log("✅ Signed in as", data.lineUserId);

            // Notify Electron main process
            if (window.electronAPI && window.electronAPI.sendPaired) {
              window.electronAPI.sendPaired(data.lineUserId);
            }

            // Notify App.js
            onPaired(data.lineUserId);
            clearInterval(interval);
          } catch (err) {
            console.error("❌ Firebase sign-in failed:", err);
          }
        }
      } catch (e) {
        console.error("Pairing check failed:", e);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [deviceId, onPaired]);

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h2>🐶 Pair your LINE account</h2>
      <p>Scan this QR code with LINE to connect:</p>
      <div style={{ marginTop: "20px" }} dangerouslySetInnerHTML={{ __html: qrHtml }} />
      <div style={{ color: '#666', fontSize: '0.8em', marginTop: '20px' }}>
        <code>{deviceId}</code>
      </div>
    </div>
  );
}

export default PairPage;
