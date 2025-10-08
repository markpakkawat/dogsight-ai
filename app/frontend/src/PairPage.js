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
    const url = `${BASE}/pair?deviceId=${encodeURIComponent(deviceId)}&ts=${Date.now()}`;
    fetch(url, {
      headers: { "ngrok-skip-browser-warning": "true" }, // ← avoid banner HTML
    })
      .then((res) => res.text())
      .then((html) => {
        if (html && html.includes("<img")) setQrHtml(html);
        else setQrHtml(`<a href="${url}" target="_blank" rel="noreferrer">Click here to login with LINE</a>`);
      })
      .catch(() =>
        setQrHtml(
          `<p>⚠️ Error loading QR. Try this link: <a href="${url}" target="_blank" rel="noreferrer">Login with LINE</a></p>`
        )
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
      <p>Scan the QR code or click the login link below:</p>
      <div dangerouslySetInnerHTML={{ __html: qrHtml }} />
      Waiting for pairing confirmation for device:
        <br />
        <code>{deviceId}</code>
    </div>
  );
}

export default PairPage;
