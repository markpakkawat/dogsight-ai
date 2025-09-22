import React from "react";

function HomePage({ lineUserId }) {
  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h2>🏠 Home Dashboard</h2>
      <p>Paired with LINE User: {lineUserId}</p>

      <div style={{ marginTop: "30px" }}>
        <h3>🎥 Video Streaming</h3>
        <div style={{ width: "640px", height: "360px", border: "1px solid #ccc", margin: "auto" }}>
          <p>Video will go here</p>
        </div>

        <h3 style={{ marginTop: "30px" }}>🔘 Alert Controls</h3>
        <button>Enable Alerts</button>
        <button style={{ marginLeft: "10px" }}>Disable Alerts</button>

        <h3 style={{ marginTop: "30px" }}>✏️ Define Safe Zone</h3>
        <p>[Polygon drawing tool placeholder]</p>
      </div>
    </div>
  );
}

export default HomePage;
