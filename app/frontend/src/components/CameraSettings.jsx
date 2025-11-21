import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";

export default function CameraSettings({ db, lineUserId }) {
  const [cameraSource, setCameraSource] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // Load current camera config on mount
  useEffect(() => {
    const loadConfig = async () => {
      if (!window.electronAPI?.getCameraConfig) {
        setMessage("Camera config not available (web mode)");
        setLoading(false);
        return;
      }

      try {
        // First try to load from Firestore if available
        if (db && lineUserId) {
          const userDoc = await getDoc(doc(db, "users", lineUserId));
          if (userDoc.exists() && userDoc.data().cameraSource) {
            setCameraSource(userDoc.data().cameraSource);
            // Also update local config
            await window.electronAPI.saveCameraConfig({ source: userDoc.data().cameraSource });
            setLoading(false);
            return;
          }
        }

        // Fall back to local config
        const config = await window.electronAPI.getCameraConfig();
        if (config && config.source !== undefined) {
          setCameraSource(config.source);
        }
      } catch (error) {
        console.error("Failed to load camera config:", error);
        setMessage("Failed to load camera settings");
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, [db, lineUserId]);

  const handleSave = async () => {
    if (!window.electronAPI?.saveCameraConfig) {
      setMessage("Save not available (web mode)");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      // Save to local config
      const result = await window.electronAPI.saveCameraConfig({ source: cameraSource });
      if (!result.success) {
        setMessage("❌ Failed to save settings: " + (result.error || "Unknown error"));
        setSaving(false);
        return;
      }

      // Also save to Firestore if available
      if (db && lineUserId) {
        await setDoc(
          doc(db, "users", lineUserId),
          { cameraSource: cameraSource },
          { merge: true }
        );
      }

      setMessage("✅ Camera settings saved! Restarting detection with new camera...");

      // Automatically restart detection to apply new camera settings
      if (window.electronAPI?.stopDetection && window.electronAPI?.startDetection) {
        window.electronAPI.stopDetection();
        setTimeout(() => {
          window.electronAPI.startDetection();
          setMessage("✅ Camera settings applied! Detection restarted successfully.");
        }, 500);
      }
    } catch (error) {
      console.error("Failed to save camera config:", error);
      setMessage("❌ Failed to save camera settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ opacity: 0.6 }}>Loading camera settings...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, opacity: 0.8 }}>
        Configure your camera source. Use "0" for USB webcam or enter an RTSP URL for IP cameras.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 600 }}>
          Camera Source
        </label>
        <input
          type="text"
          value={cameraSource}
          onChange={(e) => setCameraSource(e.target.value)}
          placeholder="0 or rtsp://192.168.1.100:554/stream"
          style={{
            padding: "10px 12px",
            fontSize: 14,
            border: "1px solid #ccc",
            borderRadius: 6,
            fontFamily: "monospace",
          }}
        />
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          Examples: "0" (default webcam), "1" (second camera), or "rtsp://admin:password@192.168.1.100:554/stream"
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: "10px 20px",
          backgroundColor: saving ? "#ccc" : "#4CAF50",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: "bold",
          cursor: saving ? "not-allowed" : "pointer",
          alignSelf: "flex-start",
        }}
      >
        {saving ? "Saving..." : "Save Camera Settings"}
      </button>

      {message && (
        <div
          style={{
            padding: "10px 12px",
            backgroundColor: message.startsWith("✅") ? "#e8f5e9" : "#ffebee",
            borderRadius: 6,
            fontSize: 14,
            color: message.startsWith("✅") ? "#2e7d32" : "#c62828",
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
