// /app/frontend/src/HomePage.js
import React, { useEffect, useState } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, getDoc, deleteDoc } from "firebase/firestore";
import AlertToggle from "./components/AlertToggle";
import SafeZoneCanvas from "./components/SafeZoneCanvas";
import MJPEGStream from "./components/MJPEGStream";
import { useSafeZone } from "./hooks/useSafeZone";

// Add onUnpair to the component props
function HomePage({ lineUserId, onUnpair }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(false);

  const [deviceId] = useState(() => {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("deviceId", id);
    }
    return id;
  });

  // Replace the Firebase connection check
  useEffect(() => {
    // Simple periodic ping to check Firestore connection
    const checkConnection = async () => {
      try {
        // Try to read the user document
        if (lineUserId) {
          const docRef = doc(db, "users", lineUserId);
          await getDoc(docRef);
          setIsOnline(true);
        }
      } catch (error) {
        console.error("Connection check error:", error);
        setIsOnline(false);
      }
    };

    // Check connection status periodically
    checkConnection();
    const interval = setInterval(checkConnection, 30000); // Check every 30 seconds

    // Also check browser's online status
    const handleOnline = () => {
      setIsOnline(navigator.onLine);
      checkConnection(); // Verify Firestore connection when browser comes online
    };
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set initial online state based on browser
    setIsOnline(navigator.onLine);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [lineUserId]);

  // Listen for alert state changes
  useEffect(() => {
    if (!lineUserId) return;

    const unsubscribe = onSnapshot(
      doc(db, "users", lineUserId),
      (doc) => {
        if (doc.exists()) {
          setEnabled(!!doc.data().alertEnabled);
        }
      },
      (error) => {
        console.error("Alert state sync error:", error);
        setIsOnline(false);
      }
    );

    return () => unsubscribe();
  }, [lineUserId]);

  // Add safe zone state management
  const { polygon, save, loading: zoneLoading, saving: zoneSaving } = useSafeZone(db, lineUserId);

  const handleUnpair = async () => {
    if (window.confirm("Are you sure you want to unpair? This will remove all settings.")) {
      try {
        // Delete user document from Firestore
        if (lineUserId) {
          await deleteDoc(doc(db, "users", lineUserId));
        }
        // Clear local storage
        localStorage.removeItem("deviceId");
        // Call parent's unpair handler
        onUnpair();
      } catch (error) {
        console.error("Failed to unpair:", error);
        alert("Failed to unpair. Please try again.");
      }
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: "24px auto", padding: "0 16px" }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h2>🏠 Home Dashboard</h2>
        <button
          onClick={handleUnpair}
          style={{
            padding: '8px 16px',
            backgroundColor: '#ff4444',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>🔓</span>
          Unpair Device
        </button>
      </div>
      <p>Paired LINE User: {lineUserId || "—"}</p>

      {/* Live Video Feed Section - Optimized Canvas Rendering */}
      <MJPEGStream streamUrl="http://localhost:5000/stream" />

      {/* Connection status indicator */}
      <div style={{
        padding: '8px 16px',
        marginBottom: '20px',
        backgroundColor: isOnline ? '#e8f5e9' : '#ffebee',
        borderRadius: '4px',
        color: isOnline ? '#2e7d32' : '#c62828'
      }}>
        {isOnline ? '🟢 Connected' : '🔴 Offline - Check your internet connection'}
      </div>

      <h3 style={{ marginTop: 30 }}>🔘 Alert Controls</h3>
      <AlertToggle 
        deviceId={deviceId} 
        enabled={enabled}
        onStateChange={setEnabled}
        isOnline={isOnline}
      />

      {/* SafeZone section */}
      <h3 style={{ marginTop: 30 }}>📍 Safe Zone</h3>
      <div style={{
        marginTop: 16,
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 16,
        backgroundColor: '#fff',
        overflow: 'hidden', // Add this to prevent overflow
        display: 'flex',    // Add this to center the canvas
        justifyContent: 'center', // Add this to center the canvas
        alignItems: 'center'      // Add this to center the canvas
      }}>
        <SafeZoneCanvas
          initialNormalized={polygon}
          onSave={save}
          disabled={zoneLoading || zoneSaving || !isOnline}
          width={Math.min(800, window.innerWidth - 64)} // Responsive width
          height={450} // Keep aspect ratio
        />
      </div>
    </div>
  );
}

export default HomePage;
