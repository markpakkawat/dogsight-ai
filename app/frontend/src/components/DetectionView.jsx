import React, { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Text } from "react-konva";

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

  // Auto-start camera preview when component mounts
  useEffect(() => {
    // Check if electronAPI is available
    if (!window.electronAPI) {
      setError("Electron API not available");
      return;
    }

    // Auto-start detection to show video feed immediately
    window.electronAPI.startDetection();

    // Cleanup: stop detection when component unmounts
    return () => {
      if (window.electronAPI) {
        window.electronAPI.stopDetection();
      }
    };
  }, []);

  // Listen for detection results from Python
  useEffect(() => {
    // Check if electronAPI is available
    if (!window.electronAPI) {
      setError("Electron API not available");
      return;
    }

    // Listen for detection results
    window.electronAPI.onDetectionResult((data) => {
      if (data.status === "model_loaded" || data.status === "camera_opened") {
        setIsRunning(true);
        setError(null);
      } else if (data.detections !== undefined) {
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
          <span style={{ color: "#39ff14" }}>● </span>
          Live Detection
        </div>
        {detectionData && (
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            FPS: {detectionData.fps || 0} | Frame: {detectionData.frame || 0}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: "#ff4444" }}>
            Error: {error}
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
            {!currentFrame && (
              <Text
                x={16}
                y={16}
                text="Starting camera..."
                fontSize={14}
                fill="#fff"
                shadowColor="#000"
                shadowBlur={10}
                shadowOpacity={0.8}
              />
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
