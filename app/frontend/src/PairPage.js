import React, { useEffect, useState } from "react";
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

  // Step 1: fetch QR (ngrok header + cache-bust)
  useEffect(() => {
    const url = `${BASE}/pair?deviceId=${encodeURIComponent(deviceId)}&ts=${Date.now()}`;
    fetch(url, {
      headers: { "ngrok-skip-browser-warning": "true" }, // ← avoid banner HTML
    })
      .then((res) => res.text())
      .then((html) => {
        if (html && html.includes("<img")) setQrHtml(html);
        else
          setQrHtml(
            `<a href="${url}" target="_blank" rel="noreferrer">Click here to login with LINE</a>`
          );
      })
      .catch(() =>
        setQrHtml(
          `<p>⚠️ Error loading QR. Try this link: <a href="${url}" target="_blank" rel="noreferrer">Login with LINE</a></p>`
        )
      );
  }, [deviceId]);

  // Step 2: poll pairing (ngrok header + robust JSON)
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `${BASE}/check-paired?deviceId=${encodeURIComponent(deviceId)}&ts=${Date.now()}`,
          { headers: { "ngrok-skip-browser-warning": "true" } }
        );

        // ensure JSON (ngrok banner returns HTML)
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const txt = await res.text();
          console.warn("Non-JSON from /check-paired:", txt.slice(0, 120));
          return; // try again next tick
        }

        const data = await res.json();
        console.log("🔍 Polling result:", data);

        if (data.paired) {
          onPaired(data.lineUserId);
          clearInterval(interval);
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
      <p style={{ marginTop: 16, color: "#666" }}>
        Waiting for pairing confirmation for device:
        <br />
        <code>{deviceId}</code>
      </p>
    </div>
  );
}

export default PairPage;
