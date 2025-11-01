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

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // Strongly recommended in prod:
  // { urls: "turn:your-turn.example.com:3478", username: "user", credential: "pass" },
];

/**
 * Capture processed video stream from Python detection server
 * @param {string} streamUrl URL of the MJPEG stream (default: http://localhost:5000/stream)
 * @returns {Promise<MediaStream>}
 */
async function captureProcessedStream(streamUrl = "http://localhost:5000/stream") {
  return new Promise((resolve, reject) => {
    // Create image element to load MJPEG stream
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = streamUrl;

    // Create canvas to capture frames
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    img.onload = () => {
      canvas.width = img.width || 640;
      canvas.height = img.height || 480;

      // Draw frames continuously
      const drawFrame = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        requestAnimationFrame(drawFrame);
      };
      drawFrame();

      // Capture canvas as MediaStream
      const stream = canvas.captureStream(30); // 30 FPS
      resolve(stream);
    };

    img.onerror = (err) => {
      reject(new Error("Failed to load processed video stream. Is Python detection server running?"));
    };
  });
}

/**
 * Start broadcasting the processed video stream (from Python detection) to a viewer session.
 * @param {Firestore} db            Firebase Firestore instance
 * @param {string} userId           Owner/user id (also your streams/{userId} doc id)
 * @param {string} sessionId        Session document id
 * @param {object} options
 * @param {RTCIceServer[]} options.iceServers  Custom ICE servers (optional)
 * @param {string} options.streamUrl    URL of processed video stream (optional)
 * @returns {Promise<{ pc: RTCPeerConnection, local: MediaStream, stop: Function }>}
 */
export async function startBroadcast(db, userId, sessionId, options = {}) {
  const iceServers = options.iceServers || DEFAULT_ICE_SERVERS;
  const streamUrl = options.streamUrl || "http://localhost:5000/stream";

  const pc = new RTCPeerConnection({ iceServers });

  // 1) Capture processed video stream from Python server
  const local = await captureProcessedStream(streamUrl);
  local.getTracks().forEach((t) => pc.addTrack(t, local));

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

  // 3) Create initial offer
  const sessionRef = doc(db, "streams", userId, "sessions", sessionId);
  const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
  await pc.setLocalDescription(offer);

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
      try { unsub && unsub(); } catch {}
      try { pc && pc.close(); } catch {}
      try { local && local.getTracks().forEach((t) => t.stop()); } catch {}
      console.log("🛑 Broadcaster stopped");
    },
  };
}
