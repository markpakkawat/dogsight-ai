// /app/frontend/src/HomePage.js
import React, { useEffect, useState } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, getDoc, deleteDoc, setDoc } from "firebase/firestore";
import AlertToggle from "./components/AlertToggle";
import SafeZoneCanvas from "./components/SafeZoneCanvas";
import DetectionView from "./components/DetectionView";
import CameraSettings from "./components/CameraSettings";
import { useSafeZone } from "./hooks/useSafeZone";
import { watchLiveSessions } from "./webrtc/liveService";

// Add onUnpair to the component props
function HomePage({ lineUserId, onUnpair }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [streamStatus, setStreamStatus] = useState({ status: "idle", message: "" });

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

  // Alert monitoring integration
  useEffect(() => {
    if (!lineUserId || !window.electronAPI) return;

    // Get API base URL from environment or use default
    const apiBaseUrl = process.env.REACT_APP_API_BASE;

    // Start/stop alert monitoring based on enabled state
    if (enabled && isOnline) {
      console.log("🔔 Starting alert monitoring...");
      window.electronAPI.startAlertMonitoring({
        deviceId,
        lineUserId,
        safeZone: polygon || [],
        apiBaseUrl
      });
    } else {
      console.log("🔕 Stopping alert monitoring...");
      window.electronAPI.stopAlertMonitoring();
    }

    return () => {
      if (window.electronAPI.stopAlertMonitoring) {
        window.electronAPI.stopAlertMonitoring();
      }
    };
  }, [enabled, isOnline, lineUserId, deviceId, polygon]);

  // Live streaming session watcher
  useEffect(() => {
    if (!lineUserId) return;

    console.log("📡 Starting live session watcher for user:", lineUserId);
    const cleanup = watchLiveSessions(db, lineUserId, (status) => {
      setStreamStatus(status);
    });

    return () => {
      console.log("📡 Stopping live session watcher");
      cleanup();
      setStreamStatus({ status: "idle", message: "" });
    };
  }, [lineUserId]);

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

  const handleStopStreaming = async () => {
    try {
      // Find the active session and close it
      const { collection: firestoreCollection, query: firestoreQuery, where: firestoreWhere, orderBy: firestoreOrderBy, limit: firestoreLimit, getDocs } = await import("firebase/firestore");
      const sessionsRef = firestoreCollection(db, "streams", lineUserId, "sessions");
      const q = firestoreQuery(
        sessionsRef,
        firestoreWhere("status", "==", "open"),
        firestoreOrderBy("createdAt", "desc"),
        firestoreLimit(1)
      );
      const snapshot = await getDocs(q);

      if (!snapshot.empty) {
        const sessionDoc = snapshot.docs[0];
        await setDoc(doc(db, "streams", lineUserId, "sessions", sessionDoc.id), {
          status: "closed"
        }, { merge: true });
        console.log("✅ Stream stopped manually");
      }
    } catch (error) {
      console.error("Failed to stop streaming:", error);
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
            padding: '10px 20px',
            backgroundColor: '#ff4444',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => e.target.style.backgroundColor = '#ff2222'}
          onMouseLeave={(e) => e.target.style.backgroundColor = '#ff4444'}
        >
          <span>🔓</span>
          Unpair Device
        </button>
      </div>
      <p>Paired LINE User: {lineUserId || "—"}</p>

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

      {/* Streaming status indicator */}
      {streamStatus.status !== "idle" && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '20px',
          backgroundColor:
            streamStatus.status === 'active' ? '#e3f2fd' :
            streamStatus.status === 'error' ? '#ffebee' :
            streamStatus.status === 'stopping' ? '#fff3e0' :
            '#f3e5f5',
          borderRadius: '8px',
          border: `2px solid ${
            streamStatus.status === 'active' ? '#2196f3' :
            streamStatus.status === 'error' ? '#f44336' :
            streamStatus.status === 'stopping' ? '#ff9800' :
            '#9c27b0'
          }`,
          color: '#000',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: streamStatus.status !== 'active' && streamStatus.status !== 'error' ? 'pulse 2s infinite' : 'none'
        }}>
          <div style={{ fontSize: '24px' }}>
            {streamStatus.status === 'active' ? '🎥' :
             streamStatus.status === 'error' ? '❌' :
             streamStatus.status === 'stopping' ? '⏹️' :
             '⏳'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              {streamStatus.status === 'requested' ? 'Stream Requested' :
               streamStatus.status === 'preparing' ? 'Preparing Camera...' :
               streamStatus.status === 'starting' ? 'Starting Broadcast...' :
               streamStatus.status === 'active' ? 'Streaming Active' :
               streamStatus.status === 'stopping' ? 'Stopping Stream...' :
               streamStatus.status === 'switching' ? 'Switching Streams...' :
               streamStatus.status === 'error' ? 'Stream Error' :
               'Processing...'}
            </div>
            <div style={{ fontSize: '14px', opacity: 0.8 }}>
              {streamStatus.message}
            </div>
          </div>
          {streamStatus.status !== 'active' && streamStatus.status !== 'error' && (
            <div className="spinner" style={{
              width: '20px',
              height: '20px',
              border: '3px solid rgba(0,0,0,0.1)',
              borderTop: '3px solid #9c27b0',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
          )}
        </div>
      )}

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>

      <h3 style={{ marginTop: 30 }}>🔘 Alert Controls</h3>
      <AlertToggle
        deviceId={deviceId}
        enabled={enabled}
        onStateChange={setEnabled}
        isOnline={isOnline}
      />

      {/* Camera Settings section */}
      <h3 style={{ marginTop: 30 }}>📹 Camera Settings</h3>
      <div style={{
        marginTop: 16,
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 16,
        backgroundColor: '#fff',
      }}>
        <CameraSettings db={db} lineUserId={lineUserId} />
      </div>

      {/* Detection View section */}
      <h3 style={{ marginTop: 30 }}>🐶 Dog Detection</h3>
      <div style={{
        marginTop: 16,
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 16,
        backgroundColor: '#fff',
        overflow: 'hidden',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <DetectionView
          width={Math.min(800, window.innerWidth - 64)}
          height={450}
          safeZone={polygon}
          alertEnabled={enabled}
          onSaveZone={save}
          streamStatus={streamStatus}
          onStopStreaming={handleStopStreaming}
        />
      </div>

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
