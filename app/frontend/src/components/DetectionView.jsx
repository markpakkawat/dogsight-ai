import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Text } from "react-konva";

// Platform-specific timeout constants (in milliseconds)
const TIMEOUT_WINDOWS = {
  startup: 15000,        // 15s - Python startup + library imports (cv2, ultralytics)
  loading_model: 10000,  // 10s - YOLO model loading
  camera_opened: 5000,   // 5s - Camera initialization
  testing_camera: 5000,  // 5s - Camera test
  first_frame: 5000,     // 5s - First frame arrival
  total: 40000           // 40s total
};

const TIMEOUT_MAC = {
  startup: 20000,        // 20s - Mac/ARM can be slower
  loading_model: 20000,  // 20s - YOLO model loading on ARM
  camera_opened: 8000,   // 8s - Camera initialization
  testing_camera: 7000,  // 7s - Camera test
  first_frame: 5000,     // 5s - First frame arrival
  total: 60000           // 60s total
};

// Phase display messages
const PHASE_MESSAGES = {
  startup: "Starting detection...",
  loading_model: "Loading AI model...",
  model_loaded: "AI model loaded",
  camera_opened: "Opening camera...",
  testing_camera: "Testing camera...",
  camera_ready: "Camera ready",
  streaming: "Live detection active"
};

export default function DetectionView({
  width = 800,
  height = 450, // 16:9 aspect ratio
}) {
  const imgRef = useRef(null);
  const [detectionData, setDetectionData] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);
  const [frameSize, setFrameSize] = useState({ width: 640, height: 480 });
  const [currentFrame, setCurrentFrame] = useState(null);
  const [initializationStarted, setInitializationStarted] = useState(false);
  const timeoutRef = useRef(null);

  // Phase tracking for multi-phase timeout
  const [currentPhase, setCurrentPhase] = useState('startup');
  const [phaseStartTime, setPhaseStartTime] = useState(Date.now());
  const [platform, setPlatform] = useState('win32');

  // Auto-start camera preview when component mounts
  useEffect(() => {
    // Check if electronAPI is available
    if (!window.electronAPI) {
      setError("Electron API not available");
      return;
    }

    // Detect platform
    const detectedPlatform = window.electronAPI.getPlatform();
    setPlatform(detectedPlatform);

    // Auto-start detection to show video feed immediately
    window.electronAPI.startDetection();

    // Cleanup: stop detection when component unmounts
    return () => {
      if (window.electronAPI) {
        window.electronAPI.stopDetection();
      }
    };
  }, []);

  // Phase-based timeout to detect stuck initialization
  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Only set timeout if not streaming and no error
    if (currentPhase !== 'streaming' && !error) {
      // Get platform-specific timeout
      const timeouts = platform === 'darwin' ? TIMEOUT_MAC : TIMEOUT_WINDOWS;
      const phaseTimeout = timeouts[currentPhase] || timeouts.total;

      timeoutRef.current = setTimeout(() => {
        // Check if still in same phase
        const elapsed = Date.now() - phaseStartTime;
        if (elapsed >= phaseTimeout) {
          const platformName = platform === 'darwin' ? 'Mac' : 'Windows';
          setError(
            `Initialization timeout during: ${PHASE_MESSAGES[currentPhase] || currentPhase}\n\n` +
            `Expected: ${phaseTimeout / 1000}s (${platformName})\n` +
            `Elapsed: ${Math.floor(elapsed / 1000)}s\n\n` +
            "Please check:\n" +
            "• Camera is connected and working\n" +
            "• Camera permissions are granted\n" +
            "• No other application is using the camera\n" +
            "• Try restarting the application"
          );
          setIsRunning(false);
        }
      }, phaseTimeout);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [currentPhase, phaseStartTime, platform, error]);

  // Listen for detection results from Python
  useEffect(() => {
    // Check if electronAPI is available
    if (!window.electronAPI) {
      setError("Electron API not available");
      return;
    }

    // Listen for detection results
    window.electronAPI.onDetectionResult((data) => {
      // Check for error objects from Python
      if (data.error) {
        // Clear timeout since we got a response (even if error)
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        setError(data.message || "Detection error occurred");
        setIsRunning(false);
        return;
      }

      // Handle status updates and phase transitions
      if (data.status) {
        setInitializationStarted(true);
        setIsRunning(true);
        setError(null);

        // Update phase based on status
        const statusToPhase = {
          "loading_model": "loading_model",
          "model_loaded": "model_loaded",
          "camera_opened": "camera_opened",
          "testing_camera": "testing_camera",
          "camera_ready": "camera_ready"
        };

        const newPhase = statusToPhase[data.status];
        if (newPhase && newPhase !== currentPhase) {
          setCurrentPhase(newPhase);
          setPhaseStartTime(Date.now());
        }
      } else if (data.detections !== undefined) {
        // First frame received - now streaming
        setInitializationStarted(true);
        if (currentPhase !== 'streaming') {
          setCurrentPhase('streaming');
          setPhaseStartTime(Date.now());
        }
        setDetectionData(data);
        if (data.frame_width && data.frame_height) {
          setFrameSize({ width: data.frame_width, height: data.frame_height });
        }
        // Update current frame if frame data is included
        if (data.frame_data) {
          setCurrentFrame(`data:image/jpeg;base64,${data.frame_data}`);
        }
      }
    });

    // Listen for detection errors
    window.electronAPI.onDetectionError((data) => {
      setError(data.message || "Detection error occurred");
      setIsRunning(false);
    });

    // Listen for detection stopped
    window.electronAPI.onDetectionStopped((data) => {
      setIsRunning(false);
      // Note: currentFrame is NOT cleared here, so last frame stays visible
    });

    // Cleanup listeners on unmount
    return () => {
      if (window.electronAPI.removeDetectionListeners) {
        window.electronAPI.removeDetectionListeners();
      }
    };
  }, []);

  // Calculate scaling factors to fit detection coordinates to canvas
  const scaleX = width / frameSize.width;
  const scaleY = height / frameSize.height;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {/* Status bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          <span style={{ color: error ? "#ff4444" : "#39ff14" }}>● </span>
          {error ? "Error" : "Live Detection"}
        </div>
        {detectionData && !error && (
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            FPS: {detectionData.fps || 0} | Frame: {detectionData.frame || 0}
          </div>
        )}
      </div>

      {/* Video container with overlay canvas */}
      <div style={{
        position: 'relative',
        width,
        height,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid #2d2d2d',
        backgroundColor: '#0f0f10'
      }}>
        {/* Image element (background layer - displays frames from Python) */}
        {currentFrame && (
          <img
            ref={imgRef}
            src={currentFrame}
            alt="Camera feed"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        )}

        {/* Konva canvas (overlay layer for detection boxes) */}
        <Stage
          width={width}
          height={height}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none', // Allow clicks to pass through to video
          }}
        >
          <Layer>
            {/* Detection boxes */}
            {detectionData?.detections?.map((det, idx) => {
              const [x1, y1, x2, y2] = det.bbox;
              const scaledX = x1 * scaleX;
              const scaledY = y1 * scaleY;
              const scaledW = (x2 - x1) * scaleX;
              const scaledH = (y2 - y1) * scaleY;

              return (
                <React.Fragment key={idx}>
                  {/* Bounding box */}
                  <Rect
                    x={scaledX}
                    y={scaledY}
                    width={scaledW}
                    height={scaledH}
                    stroke="#39ff14"
                    strokeWidth={3}
                    fill="rgba(57, 255, 20, 0.15)"
                  />

                  {/* Label background */}
                  <Rect
                    x={scaledX}
                    y={scaledY - 24}
                    width={110}
                    height={22}
                    fill="#39ff14"
                    cornerRadius={4}
                  />

                  {/* Label text */}
                  <Text
                    x={scaledX + 6}
                    y={scaledY - 20}
                    text={`${det.class} ${(det.confidence * 100).toFixed(0)}%`}
                    fontSize={13}
                    fill="#000"
                    fontStyle="bold"
                  />
                </React.Fragment>
              );
            })}

            {/* Helper text when camera is starting */}
            {!currentFrame && !error && (
              <>
                <Text
                  x={16}
                  y={16}
                  text={PHASE_MESSAGES[currentPhase] || "Initializing..."}
                  fontSize={14}
                  fill="#fff"
                  shadowColor="#000"
                  shadowBlur={10}
                  shadowOpacity={0.8}
                />
                <Text
                  x={16}
                  y={40}
                  text={`Platform: ${platform === 'darwin' ? 'Mac' : 'Windows'} • Phase timeout: ${((platform === 'darwin' ? TIMEOUT_MAC : TIMEOUT_WINDOWS)[currentPhase] || 30000) / 1000}s`}
                  fontSize={11}
                  fill="#aaa"
                  shadowColor="#000"
                  shadowBlur={8}
                  shadowOpacity={0.8}
                />
              </>
            )}

            {/* Error message overlay */}
            {error && (
              <>
                {/* Semi-transparent background for error message */}
                <Rect
                  x={20}
                  y={20}
                  width={width - 40}
                  height={Math.min(200, height - 40)}
                  fill="rgba(40, 0, 0, 0.9)"
                  cornerRadius={8}
                  stroke="#ff4444"
                  strokeWidth={2}
                />
                {/* Error icon */}
                <Text
                  x={width / 2 - 20}
                  y={40}
                  text="⚠️"
                  fontSize={32}
                />
                {/* Error title */}
                <Text
                  x={40}
                  y={85}
                  text="Camera Error"
                  fontSize={18}
                  fill="#ff4444"
                  fontStyle="bold"
                />
                {/* Error message - split by newlines */}
                {error.split('\n').map((line, idx) => (
                  <Text
                    key={idx}
                    x={40}
                    y={115 + idx * 20}
                    text={line}
                    fontSize={13}
                    fill="#fff"
                    width={width - 80}
                  />
                ))}
              </>
            )}

            {/* Detection count overlay */}
            {isRunning && detectionData && (
              <>
                {/* Background for text visibility */}
                <Rect
                  x={width - 140}
                  y={10}
                  width={130}
                  height={30}
                  fill="rgba(0, 0, 0, 0.6)"
                  cornerRadius={6}
                />
                <Text
                  x={width - 130}
                  y={18}
                  text={`Dogs: ${detectionData.detections?.length || 0}`}
                  fontSize={16}
                  fill="#39ff14"
                  fontStyle="bold"
                />
              </>
            )}
          </Layer>
        </Stage>
      </div>

      {/* Detection info */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          {detectionData?.detections?.length > 0 &&
            `${detectionData.detections.length} dog(s) detected`}
        </div>
      </div>
    </div>
  );
}
