// Optimized MJPEG Stream Component for Electron
import React, { useEffect, useRef, useState } from 'react';

export default function MJPEGStream({ streamUrl = "http://localhost:5000/stream" }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const frameIdRef = useRef(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;

    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    let isActive = true;

    // Set canvas size
    canvas.width = 640;
    canvas.height = 480;

    // Load image
    img.onload = () => {
      setLoading(false);
      setError(false);

      const render = () => {
        if (!isActive) return;

        try {
          // Draw current frame to canvas
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch (e) {
          console.warn('Draw error:', e);
        }

        // Request next frame
        frameIdRef.current = requestAnimationFrame(render);
      };

      render();
    };

    img.onerror = () => {
      setError(true);
      setLoading(false);
    };

    // Start streaming
    img.src = streamUrl + '?t=' + Date.now(); // Cache bust

    // Cleanup
    return () => {
      isActive = false;
      if (frameIdRef.current) {
        cancelAnimationFrame(frameIdRef.current);
      }
    };
  }, [streamUrl]);

  return (
    <div style={{
      marginTop: 20,
      marginBottom: 20,
      border: '2px solid #333',
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: '#0f0f10'
    }}>
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#1a1a1a',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px' }}>📹 Live Detection Feed</h3>
        {!error && !loading && (
          <span style={{
            fontSize: '12px',
            color: '#39ff14',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#39ff14',
              animation: 'pulse 2s infinite'
            }} />
            LIVE
          </span>
        )}
      </div>

      <div style={{
        position: 'relative',
        width: '100%',
        backgroundColor: '#000',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '360px'
      }}>
        {/* Hidden img for MJPEG loading */}
        <img
          ref={imgRef}
          alt=""
          style={{ display: 'none' }}
        />

        {/* Canvas for efficient rendering */}
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: 'auto',
            display: error || loading ? 'none' : 'block',
            imageRendering: 'auto'
          }}
        />

        {/* Loading state */}
        {loading && !error && (
          <div style={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#888',
            gap: '12px'
          }}>
            <div style={{ fontSize: '48px' }}>⏳</div>
            <div style={{ fontSize: '14px' }}>Connecting to detection server...</div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{
            position: 'absolute',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            color: '#888',
            gap: '12px'
          }}>
            <div style={{ fontSize: '48px' }}>📹</div>
            <div style={{ fontSize: '14px' }}>Detection server not running</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>Start the Python detection module</div>
          </div>
        )}
      </div>
    </div>
  );
}
