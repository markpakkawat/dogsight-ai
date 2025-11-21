import React, { useEffect, useRef, useState, useMemo } from "react";
import { Stage, Layer, Rect, Text, Line, Circle } from "react-konva";
import { isDetectionInSafeZone } from "../utils/geometry";

// Platform-specific timeout constants (in milliseconds)
const TIMEOUT_WINDOWS = {
  startup: 60000,        // 60s - Python startup + library imports (cv2, ultralytics)
  loading_model: 60000,  // 60s - YOLO model loading
  camera_opened: 5000,   // 5s - Camera initialization
  testing_camera: 5000,  // 5s - Camera test
  first_frame: 5000,     // 5s - First frame arrival
  total: 135000          // 135s total
};

const TIMEOUT_MAC = {
  startup: 60000,        // 60s - Mac/ARM can be slower
  loading_model: 60000,  // 60s - YOLO model loading on ARM
  camera_opened: 8000,   // 8s - Camera initialization
  testing_camera: 7000,  // 7s - Camera test
  first_frame: 5000,     // 5s - First frame arrival
  total: 145000          // 145s total
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
  safeZone = [], // Safe zone polygon for color coding (normalized 0-1)
  alertEnabled = false, // Alert monitoring state
  onSaveZone = null, // Callback to save edited safe zone
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
  const [elapsedTime, setElapsedTime] = useState(0);

  // Safe zone editing state
  const [editMode, setEditMode] = useState(false);
  const [points, setPoints] = useState([]); // Pixel coordinates for editing
  const [isClosed, setIsClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  // Convert normalized safe zone to pixel coordinates when entering edit mode
  useEffect(() => {
    if (editMode && safeZone && safeZone.length > 0) {
      const pixelPoints = safeZone.map(p => ({
        x: p.x * width,
        y: p.y * height
      }));
      setPoints(pixelPoints);
      setIsClosed(safeZone.length >= 3);
    }
  }, [editMode, safeZone, width, height]);

  // Convert pixel coordinates to normalized (0-1) for saving
  const normalizedPoints = useMemo(() => {
    return points.map(p => ({
      x: p.x / width,
      y: p.y / height
    }));
  }, [points, width, height]);

  // Polygon editing handlers
  const handleStageClick = (e) => {
    if (!editMode || isClosed) return;

    const stage = e.target.getStage();
    const pointerPos = stage.getPointerPosition();

    setPoints([...points, { x: pointerPos.x, y: pointerPos.y }]);
  };

  const handlePointDragMove = (index, e) => {
    const newPoints = [...points];
    newPoints[index] = {
      x: e.target.x(),
      y: e.target.y()
    };
    setPoints(newPoints);
  };

  const handleUndo = () => {
    if (points.length > 0) {
      setPoints(points.slice(0, -1));
      if (points.length <= 3) {
        setIsClosed(false);
      }
    }
  };

  const handleClear = () => {
    setPoints([]);
    setIsClosed(false);
  };

  const handleClose = () => {
    if (points.length >= 3) {
      setIsClosed(true);
    }
  };

  const handleSave = async () => {
    if (!onSaveZone || points.length < 3) return;

    setSaving(true);
    try {
      await onSaveZone(normalizedPoints);
      setEditMode(false);
    } catch (err) {
      console.error('Failed to save safe zone:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setPoints([]);
    setIsClosed(false);
  };

  const handleEnterEditMode = () => {
    setEditMode(true);
    // If no existing safe zone, start fresh
    if (!safeZone || safeZone.length === 0) {
      setPoints([]);
      setIsClosed(false);
    }
  };

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

  // Update elapsed time every second during initialization
  useEffect(() => {
    if (currentPhase !== 'streaming' && !error) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - phaseStartTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setElapsedTime(0);
    }
  }, [currentPhase, phaseStartTime, error]);

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

          // Phase-specific troubleshooting info
          const phaseInfo = {
            startup: "The Python detection script is starting up and loading libraries. This may take longer on first run.",
            loading_model: "The AI model is being loaded into memory. Large models may take time to initialize.",
            camera_opened: "Attempting to open and initialize the camera device.",
            testing_camera: "Testing camera connectivity and frame capture.",
            first_frame: "Waiting for the first camera frame to arrive."
          };

          const troubleshootingTips = currentPhase === 'startup'
            ? "• Check Python is installed and accessible\n" +
              "• Ensure all dependencies (cv2, ultralytics) are installed\n" +
              "• Check system logs for Python errors\n" +
              "• First run may take longer due to model downloads"
            : "• Camera is connected and working\n" +
              "• Camera permissions are granted\n" +
              "• No other application is using the camera\n" +
              "• Check system logs for detailed errors\n" +
              "• Try restarting the application";

          setError(
            `Initialization timeout during: ${PHASE_MESSAGES[currentPhase] || currentPhase}\n\n` +
            `${phaseInfo[currentPhase] || ''}\n\n` +
            `Timeout: ${phaseTimeout / 1000}s (${platformName})\n` +
            `Elapsed: ${Math.floor(elapsed / 1000)}s\n\n` +
            "Troubleshooting:\n" +
            troubleshootingTips + "\n\n" +
            "Tip: Check the developer console (F12) for Python error messages"
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
          "startup": "startup",
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
        setIsRunning(true);  // Ensure isRunning is true when frames arrive
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
          setIsRunning(true);  // Ensure isRunning is true when frame data arrives
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
        {currentFrame && isRunning && (
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

        {/* Konva canvas (overlay layer for detection boxes and safe zone) */}
        <Stage
          width={width}
          height={height}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: editMode ? 'all' : 'none', // Interactive in edit mode
            cursor: editMode && !isClosed ? 'crosshair' : 'default',
          }}
          onClick={handleStageClick}
        >
          <Layer>
            {/* Read-only safe zone outline (when not editing) */}
            {!editMode && safeZone && safeZone.length >= 3 && (() => {
              const pixelZone = safeZone.map(p => ({ x: p.x * width, y: p.y * height }));
              const flatPoints = pixelZone.flatMap(p => [p.x, p.y]);
              return (
                <Line
                  points={flatPoints}
                  stroke="#39ff14"
                  strokeWidth={2}
                  closed={true}
                  fill="rgba(57, 255, 20, 0.1)"
                  opacity={0.7}
                />
              );
            })()}

            {/* Editable safe zone polygon (when editing) */}
            {editMode && points.length > 0 && (
              <>
                {/* Polygon lines and fill */}
                <Line
                  points={points.flatMap(p => [p.x, p.y])}
                  stroke="#39ff14"
                  strokeWidth={3}
                  closed={isClosed}
                  fill={isClosed ? "rgba(57, 255, 20, 0.15)" : "transparent"}
                />

                {/* Point handles */}
                {points.map((point, index) => (
                  <Circle
                    key={index}
                    x={point.x}
                    y={point.y}
                    radius={8}
                    fill="#fff"
                    stroke="#000"
                    strokeWidth={2}
                    draggable={true}
                    onDragMove={(e) => handlePointDragMove(index, e)}
                    shadowColor="#000"
                    shadowBlur={4}
                    shadowOpacity={0.6}
                  />
                ))}
              </>
            )}
            {/* Edit mode instructions overlay */}
            {editMode && (
              <>
                <Rect
                  x={10}
                  y={10}
                  width={Math.min(width - 20, 400)}
                  height={60}
                  fill="rgba(0, 0, 0, 0.8)"
                  cornerRadius={8}
                />
                <Text
                  x={20}
                  y={20}
                  width={Math.min(width - 40, 380)}
                  text={isClosed ? "Polygon closed. Drag white circles to adjust points." : "Click to add points. Drag white circles to adjust. Need 3+ points to close."}
                  fontSize={13}
                  fill="#39ff14"
                  lineHeight={1.4}
                />
              </>
            )}

            {/* Status display - only when streaming and not editing */}
            {!editMode && currentPhase === 'streaming' && detectionData && !error && (() => {
              // Calculate overall status
              const calculateStatus = () => {
                // No detections - status depends on alert state
                if (!detectionData?.detections || detectionData.detections.length === 0) {
                  if (alertEnabled) {
                    // Alert ON: Urgent "Disappear" status
                    return { status: 'Disappear', color: '#ff4444' };
                  } else {
                    // Alert OFF: Neutral "Not detected" status
                    return { status: 'Not detected', color: '#888888' };
                  }
                }

                // Dog(s) detected - check safe zone (regardless of alert state)
                const anyOutside = detectionData.detections.some(det =>
                  !isDetectionInSafeZone(det, frameSize.width, frameSize.height, safeZone)
                );

                return anyOutside
                  ? { status: 'Outside', color: '#ff4444' }
                  : { status: 'Inside', color: '#39ff14' };
              };

              const { status, color } = calculateStatus();

              return (
                <>
                  {/* Background for status */}
                  <Rect
                    x={10}
                    y={10}
                    width={200}
                    height={40}
                    fill="rgba(0, 0, 0, 0.7)"
                    cornerRadius={8}
                  />
                  {/* Status text */}
                  <Text
                    x={20}
                    y={22}
                    text={`Status: ${status}`}
                    fontSize={18}
                    fill={color}
                    fontStyle="bold"
                    shadowColor="#000"
                    shadowBlur={8}
                    shadowOpacity={0.8}
                  />
                </>
              );
            })()}

            {/* Detection boxes - hide when editing safe zone */}
            {!editMode && detectionData?.detections?.map((det, idx) => {
              const [x1, y1, x2, y2] = det.bbox;
              const scaledX = x1 * scaleX;
              const scaledY = y1 * scaleY;
              const scaledW = (x2 - x1) * scaleX;
              const scaledH = (y2 - y1) * scaleY;

              // Check if detection is in safe zone
              const inSafeZone = isDetectionInSafeZone(
                det,
                frameSize.width,
                frameSize.height,
                safeZone
              );

              // Dynamic colors based on zone status
              const boxColor = inSafeZone ? "#39ff14" : "#ff4444";
              const fillColor = inSafeZone
                ? "rgba(57, 255, 20, 0.15)"
                : "rgba(255, 68, 68, 0.15)";
              const labelBg = inSafeZone ? "#39ff14" : "#ff4444";
              const labelText = inSafeZone ? "#000" : "#fff";

              return (
                <React.Fragment key={idx}>
                  {/* Bounding box */}
                  <Rect
                    x={scaledX}
                    y={scaledY}
                    width={scaledW}
                    height={scaledH}
                    stroke={boxColor}
                    strokeWidth={3}
                    fill={fillColor}
                  />

                  {/* Label background */}
                  <Rect
                    x={scaledX}
                    y={scaledY - 24}
                    width={110}
                    height={22}
                    fill={labelBg}
                    cornerRadius={4}
                  />

                  {/* Label text */}
                  <Text
                    x={scaledX + 6}
                    y={scaledY - 20}
                    text={`${det.class} ${(det.confidence * 100).toFixed(0)}%`}
                    fontSize={13}
                    fill={labelText}
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
                  text={`${PHASE_MESSAGES[currentPhase] || "Initializing..."} (${elapsedTime}s)`}
                  fontSize={14}
                  fill="#fff"
                  shadowColor="#000"
                  shadowBlur={10}
                  shadowOpacity={0.8}
                />
                <Text
                  x={16}
                  y={40}
                  text={`Platform: ${platform === 'darwin' ? 'Mac' : 'Windows'} • Timeout: ${((platform === 'darwin' ? TIMEOUT_MAC : TIMEOUT_WINDOWS)[currentPhase] || 30000) / 1000}s`}
                  fontSize={11}
                  fill="#aaa"
                  shadowColor="#000"
                  shadowBlur={8}
                  shadowOpacity={0.8}
                />
                <Text
                  x={16}
                  y={60}
                  text="Please wait, this may take up to a minute on first run..."
                  fontSize={11}
                  fill="#ffaa00"
                  shadowColor="#000"
                  shadowBlur={8}
                  shadowOpacity={0.8}
                />
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

        {/* Error overlay - HTML based for better interactivity */}
        {error && (
          <div style={{
            position: 'absolute',
            top: 20,
            left: 20,
            right: 20,
            maxHeight: height - 40,
            backgroundColor: 'rgba(40, 0, 0, 0.95)',
            border: '2px solid #ff4444',
            borderRadius: 8,
            padding: 20,
            color: '#fff',
            overflowY: 'auto',
            zIndex: 10
          }}>
            <div style={{ textAlign: 'center', fontSize: 32, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 18, color: '#ff4444', fontWeight: 'bold', marginBottom: 15 }}>
              Camera Error
            </div>
            <div style={{
              fontSize: 13,
              lineHeight: '1.6',
              whiteSpace: 'pre-line',
              marginBottom: 20
            }}>
              {error}
            </div>
            <button
              onClick={() => {
                setError(null);
                setCurrentPhase('startup');
                setPhaseStartTime(Date.now());
                if (window.electronAPI) {
                  window.electronAPI.stopDetection();
                  setTimeout(() => {
                    window.electronAPI.startDetection();
                  }, 500);
                }
              }}
              style={{
                backgroundColor: '#39ff14',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 'bold',
                cursor: 'pointer',
                width: '100%',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#2ee00f'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#39ff14'}
            >
              Retry Detection
            </button>
          </div>
        )}
      </div>

      {/* Edit Safe Zone Button / Controls */}
      {!editMode ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <button
            onClick={handleEnterEditMode}
            disabled={!onSaveZone}
            style={{
              backgroundColor: onSaveZone ? '#39ff14' : '#555',
              color: '#000',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 'bold',
              cursor: onSaveZone ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (onSaveZone) e.target.style.backgroundColor = '#2ee00f';
            }}
            onMouseLeave={(e) => {
              if (onSaveZone) e.target.style.backgroundColor = '#39ff14';
            }}
          >
            ✏️ Edit Safe Zone
          </button>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {!editMode && detectionData?.detections?.length > 0 &&
              `${detectionData.detections.length} dog(s) detected`}
          </div>
        </div>
      ) : (
        <div style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "center",
          padding: '12px 0',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: 8,
        }}>
          <button
            onClick={handleUndo}
            disabled={points.length === 0}
            style={{
              backgroundColor: points.length === 0 ? '#555' : '#ffaa00',
              color: '#000',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 'bold',
              cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (points.length > 0) e.target.style.backgroundColor = '#ff9500';
            }}
            onMouseLeave={(e) => {
              if (points.length > 0) e.target.style.backgroundColor = '#ffaa00';
            }}
          >
            ↶ Undo
          </button>
          <button
            onClick={handleClear}
            disabled={points.length === 0}
            style={{
              backgroundColor: points.length === 0 ? '#555' : '#ff4444',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 'bold',
              cursor: points.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (points.length > 0) e.target.style.backgroundColor = '#ff2222';
            }}
            onMouseLeave={(e) => {
              if (points.length > 0) e.target.style.backgroundColor = '#ff4444';
            }}
          >
            🗑️ Clear
          </button>
          <button
            onClick={handleClose}
            disabled={points.length < 3 || isClosed}
            style={{
              backgroundColor: (points.length < 3 || isClosed) ? '#555' : '#00aaff',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 'bold',
              cursor: (points.length < 3 || isClosed) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (points.length >= 3 && !isClosed) e.target.style.backgroundColor = '#0095dd';
            }}
            onMouseLeave={(e) => {
              if (points.length >= 3 && !isClosed) e.target.style.backgroundColor = '#00aaff';
            }}
          >
            ⬢ Close Polygon
          </button>
          <button
            onClick={handleSave}
            disabled={points.length < 3 || saving}
            style={{
              backgroundColor: (points.length < 3 || saving) ? '#555' : '#39ff14',
              color: '#000',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 'bold',
              cursor: (points.length < 3 || saving) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (points.length >= 3 && !saving) e.target.style.backgroundColor = '#2ee00f';
            }}
            onMouseLeave={(e) => {
              if (points.length >= 3 && !saving) e.target.style.backgroundColor = '#39ff14';
            }}
          >
            {saving ? '⏳ Saving...' : '💾 Save'}
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={saving}
            style={{
              backgroundColor: '#666',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 'bold',
              cursor: saving ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (!saving) e.target.style.backgroundColor = '#555';
            }}
            onMouseLeave={(e) => {
              if (!saving) e.target.style.backgroundColor = '#666';
            }}
          >
            ✖️ Cancel
          </button>
        </div>
      )}
    </div>
  );
}
