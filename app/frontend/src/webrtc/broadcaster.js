// broadcaster.js
// Electron renderer-side WebRTC broadcaster using Firestore for signaling.
// Requires Firebase v9+ modular Firestore passed in as `db`.
// Usage:
//   import { startBroadcast } from "./broadcaster";
//   const handle = await startBroadcast(db, userId, sessionId);
//   // handle.local -> MediaStream (preview)
//   // handle.stop() -> close stream & peer

import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  serverTimestamp,
} from "firebase/firestore";

// Build ICE servers from environment variables
const buildIceServers = () => {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  // Add TURN server if configured
  if (process.env.REACT_APP_TURN_URL) {
    servers.push({
      urls: process.env.REACT_APP_TURN_URL,
      username: process.env.REACT_APP_TURN_USERNAME || "",
      credential: process.env.REACT_APP_TURN_CREDENTIAL || "",
    });
  }

  return servers;
};

const DEFAULT_ICE_SERVERS = buildIceServers();

/**
 * Start broadcasting the local camera to a viewer session.
 * @param {Firestore} db            Firebase Firestore instance
 * @param {string} userId           Owner/user id (also your streams/{userId} doc id)
 * @param {string} sessionId        Session document id
 * @param {object} options
 * @param {RTCIceServer[]} options.iceServers  Custom ICE servers (optional)
 * @param {MediaStreamConstraints} options.media    getUserMedia constraints (optional)
 * @returns {Promise<{ pc: RTCPeerConnection, local: MediaStream, stop: Function }>}
 */
export async function startBroadcast(db, userId, sessionId, options = {}) {
  const iceServers = options.iceServers || DEFAULT_ICE_SERVERS;
  const mediaConstraints = options.media || { video: true, audio: false };

  // Pause Python detection to release camera
  if (window.electronAPI && window.electronAPI.stopDetection) {
    console.log("🎥 [1/4] Pausing AI detection to release camera...");
    window.electronAPI.stopDetection();
    // Wait a moment for Python to release the camera
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log("🎥 [2/4] Initializing WebRTC peer connection...");
  const pc = new RTCPeerConnection({ iceServers });

  // 1) Capture camera
  console.log("🎥 [3/4] Requesting camera access...");
  let local;
  try {
    local = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    console.log("✅ Camera acquired successfully");
    local.getTracks().forEach((t) => pc.addTrack(t, local));
  } catch (error) {
    console.error("❌ Failed to get camera:", error);
    // Resume detection if camera access fails
    if (window.electronAPI && window.electronAPI.startDetection) {
      console.log("🔄 Resuming detection after camera error...");
      window.electronAPI.startDetection();
    }
    throw error;
  }

  // 2) Publish host ICE candidates to Firestore
  pc.onicecandidate = async (e) => {
    if (!e.candidate) return;
    try {
      await updateDoc(doc(db, "streams", userId, "sessions", sessionId), {
        candidatesHost: arrayUnion(e.candidate.toJSON()),
      });
    } catch (err) {
      // First updates can race before the session doc exists; it's fine to ignore once-off failures.
      console.warn("onicecandidate update failed (ignorable if at start):", err?.message || err);
    }
  };

  // Monitor ICE connection state for immediate disconnect detection
  pc.oniceconnectionstatechange = () => {
    console.log('ICE Connection State:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'disconnected' ||
        pc.iceConnectionState === 'failed' ||
        pc.iceConnectionState === 'closed') {
      console.log('⚠️ Viewer disconnected (ICE state), closing session...');
      // Close session in Firestore immediately
      const sessionRef = doc(db, "streams", userId, "sessions", sessionId);
      setDoc(sessionRef, { status: 'closed' }, { merge: true })
        .then(() => console.log('✅ Session closed due to ICE connection loss'))
        .catch(err => console.error('Failed to close session:', err));
    }
  };

  // Monitor overall connection state for immediate disconnect detection
  pc.onconnectionstatechange = () => {
    console.log('Connection State:', pc.connectionState);
    if (pc.connectionState === 'disconnected' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed') {
      console.log('⚠️ Viewer disconnected (connection state), closing session...');
      // Close session in Firestore immediately
      const sessionRef = doc(db, "streams", userId, "sessions", sessionId);
      setDoc(sessionRef, { status: 'closed' }, { merge: true })
        .then(() => console.log('✅ Session closed due to connection loss'))
        .catch(err => console.error('Failed to close session:', err));
    }
  };

  // 3) Create initial offer
  console.log("🎥 [4/4] Setting up WebRTC connection...");
  const sessionRef = doc(db, "streams", userId, "sessions", sessionId);
  const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
  await pc.setLocalDescription(offer);

  console.log("📤 Publishing stream offer to Firestore...");
  // (Nice to have) clean slate fields for this session + mark open
  await setDoc(
    sessionRef,
    {
      status: "open",
      createdAt: serverTimestamp(),
      offer: { type: offer.type, sdp: offer.sdp },
      candidatesHost: [],
      candidatesViewer: [],
    },
    { merge: true }
  );

  console.log("🎉 Broadcast setup complete! Waiting for viewers...");

  // 4) Listen for viewer answer and viewer ICE candidates
  let lastAnswerSdp = null;
  const unsub = onSnapshot(sessionRef, async (snap) => {
    const data = snap.data();
    if (!data) return;

    // Current remote description getter (cross-browser safe)
    const hasRemoteDesc = !!(pc.currentRemoteDescription || pc.remoteDescription);

    // ---- First-time answer path ----
    if (data.answer && !hasRemoteDesc) {
      if (!lastAnswerSdp || lastAnswerSdp !== data.answer.sdp) {
        lastAnswerSdp = data.answer.sdp;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log("👀 Viewer connected! Establishing connection...");
        } catch (e) {
          console.warn("setRemoteDescription (initial) failed", e);
        }
      }
    }

    // ---- Viewer refresh path (re-answer while we are stable) → ICE restart ----
    if (data.answer && hasRemoteDesc && pc.signalingState === "stable") {
      if (!lastAnswerSdp || lastAnswerSdp !== data.answer.sdp) {
        lastAnswerSdp = data.answer.sdp;
        try {
          const restartOffer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(restartOffer);
          await setDoc(
            sessionRef,
            {
              offer: { type: restartOffer.type, sdp: restartOffer.sdp },
              // clear old candidates to keep arrays small & unambiguous
              candidatesHost: [],
              candidatesViewer: [],
            },
            { merge: true }
          );
        } catch (e) {
          console.warn("ICE restart offer failed:", e);
        }
      }
    }

    // ---- Apply any viewer ICE candidates ----
    if (Array.isArray(data.candidatesViewer)) {
      for (const c of data.candidatesViewer) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
          // benign when duplicates/race
        }
      }
    }
  });

  return {
    pc,
    local,
    stop: () => {
      console.log("🛑 Stopping broadcast...");

      try {
        unsub && unsub();
        console.log("✓ Firestore listener unsubscribed");
      } catch (e) {
        console.warn("Error unsubscribing:", e);
      }

      try {
        pc && pc.close();
        console.log("✓ WebRTC connection closed");
      } catch (e) {
        console.warn("Error closing peer connection:", e);
      }

      try {
        local && local.getTracks().forEach((t) => t.stop());
        console.log("✓ Camera released");
      } catch (e) {
        console.warn("Error stopping tracks:", e);
      }

      // Resume Python detection after streaming ends
      if (window.electronAPI && window.electronAPI.startDetection) {
        console.log("🔄 Resuming AI detection...");
        setTimeout(() => {
          window.electronAPI.startDetection();
          console.log("✅ Detection resumed");
        }, 500); // Small delay to ensure camera is fully released
      }
    },
  };
}
