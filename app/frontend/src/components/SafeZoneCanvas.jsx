// /app/frontend/src/components/SafeZoneCanvas.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Line, Circle, Rect, Text } from "react-konva";

const HANDLE_R = 7;

export default function SafeZoneCanvas({
  width = 800,
  height = 450,          // 16:9 by default; change if your camera aspect differs
  initialNormalized = [],// [{x:0..1,y:0..1}]
  onSave,                // (normalized[]) => Promise|void
}) {
  const [points, setPoints] = useState([]); // in pixels
  const [closed, setClosed] = useState(false);
  const stageRef = useRef();

  // load initial normalized -> pixels
  useEffect(() => {
    if (!initialNormalized || !initialNormalized.length) { setPoints([]); setClosed(false); return; }
    const px = initialNormalized.map(p => ({ x: p.x * width, y: p.y * height }));
    setPoints(px);
    setClosed(true);
  }, [initialNormalized, width, height]);

  const normalized = useMemo(
    () => points.map(p => ({
      x: Math.max(0, Math.min(1, p.x / width)),
      y: Math.max(0, Math.min(1, p.y / height)),
    })),
    [points, width, height]
  );

  const addPoint = (pos) => {
    if (closed) return;
    setPoints(prev => [...prev, pos]);
  };

  const onStageClick = (e) => {
    const stage = e.target.getStage();
    const { x, y } = stage.getPointerPosition();
    addPoint({ x, y });
  };

  const dragHandle = (idx, pos) => {
    setPoints(prev => {
      const next = prev.slice();
      next[idx] = {
        x: Math.max(0, Math.min(width, pos.x)),
        y: Math.max(0, Math.min(height, pos.y))
      };
      return next;
    });
  };

  const handleClose = () => {
    if (points.length >= 3) setClosed(true);
  };

  const handleUndo = () => {
    if (closed) { setClosed(false); return; }
    setPoints(prev => prev.slice(0, -1));
  };

  const handleClear = () => { setPoints([]); setClosed(false); };

  const handleSave = async () => {
    if (!onSave) return;
    if (!closed || points.length < 3) return;
    await onSave(normalized);
  };

  const hint = !points.length
    ? "Click to add points. Need 3+ points. Close when done."
    : !closed
      ? "Click to add more points. Drag circles to adjust. Click 'Close' to finish."
      : "Drag points to adjust. Save when satisfied.";

  return (
    <div style={{ display:"grid", gap:8 }}>
      <div style={{ fontSize:13, opacity:.8 }}>{hint}</div>
      <Stage width={width} height={height} ref={stageRef} onClick={onStageClick} style={{ borderRadius:12, overflow:"hidden", border:"1px solid #2d2d2d" }}>
        <Layer>
          {/* background (optional grid) */}
          <Rect x={0} y={0} width={width} height={height} fill="#0f0f10" />
          {[...Array(7)].map((_,i)=>(
            <Line key={"h"+i} points={[0,(i+1)*(height/8), width,(i+1)*(height/8)]} stroke="#1e1e22" strokeWidth={1}/>
          ))}
          {[...Array(11)].map((_,i)=>(
            <Line key={"v"+i} points={[(i+1)*(width/12),0, (i+1)*(width/12),height]} stroke="#1e1e22" strokeWidth={1}/>
          ))}

          {/* polygon */}
          {points.length >= 2 && (
            <Line
              points={points.flatMap(p => [p.x, p.y])}
              closed={closed}
              stroke="#39ff14"
              strokeWidth={2}
              opacity={0.9}
              fill={closed ? "rgba(57,255,20,0.12)" : undefined}
            />
          )}

          {/* handles */}
          {points.map((p, i) => (
            <Circle
              key={i}
              x={p.x}
              y={p.y}
              radius={HANDLE_R}
              fill="#ffffff"
              stroke="#111"
              strokeWidth={1}
              draggable
              onDragMove={(e)=>dragHandle(i, e.target.position())}
            />
          ))}

          {/* helper text */}
          {!points.length && (
            <Text x={16} y={16} text="Click to start placing points" fontSize={14} fill="#888" />
          )}
        </Layer>
      </Stage>

      {/* controls */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <button
          onClick={handleUndo}
          disabled={!points.length}
          style={btn(!points.length)}
          onMouseEnter={(e) => {
            if (points.length) e.target.style.backgroundColor = '#555';
          }}
          onMouseLeave={(e) => {
            if (points.length) e.target.style.backgroundColor = '#666';
          }}
        >
          ↶ Undo
        </button>
        <button
          onClick={handleClear}
          disabled={!points.length}
          style={btnSecondary(!points.length)}
          onMouseEnter={(e) => {
            if (points.length) e.target.style.backgroundColor = '#ff2222';
          }}
          onMouseLeave={(e) => {
            if (points.length) e.target.style.backgroundColor = '#ff4444';
          }}
        >
          🗑️ Clear
        </button>
        <button
          onClick={handleClose}
          disabled={closed || points.length < 3}
          style={btnPrimary(!closed && points.length>=3)}
          onMouseEnter={(e) => {
            if (!closed && points.length >= 3) e.target.style.backgroundColor = '#0095dd';
          }}
          onMouseLeave={(e) => {
            if (!closed && points.length >= 3) e.target.style.backgroundColor = '#00aaff';
          }}
        >
          ⬢ Close
        </button>
        <button
          onClick={handleSave}
          disabled={!closed || points.length < 3}
          style={btnSave(closed && points.length>=3)}
          onMouseEnter={(e) => {
            if (closed && points.length >= 3) e.target.style.backgroundColor = '#2ee00f';
          }}
          onMouseLeave={(e) => {
            if (closed && points.length >= 3) e.target.style.backgroundColor = '#39ff14';
          }}
        >
          💾 Save
        </button>
        <div style={{ marginLeft:"auto", fontSize:12, opacity:.8 }}>
          {closed && `Saved shape: ${normalized.length} points`}
        </div>
      </div>
    </div>
  );
}

const btn = (disabled) => ({
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: disabled ? "#555" : "#666",
  color: "#fff",
  fontSize: 13,
  fontWeight: "bold",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 0.2s ease",
});

const btnSecondary = (disabled) => ({
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: disabled ? "#555" : "#ff4444",
  color: "#fff",
  fontSize: 13,
  fontWeight: "bold",
  cursor: disabled ? "not-allowed" : "pointer",
  transition: "all 0.2s ease",
});

const btnPrimary = (active) => ({
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: active ? "#00aaff" : "#555",
  color: "#fff",
  fontSize: 13,
  fontWeight: "bold",
  cursor: active ? "pointer" : "not-allowed",
  transition: "all 0.2s ease",
});

const btnSave = (active) => ({
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: active ? "#39ff14" : "#555",
  color: "#000",
  fontSize: 13,
  fontWeight: "bold",
  cursor: active ? "pointer" : "not-allowed",
  transition: "all 0.2s ease",
});
