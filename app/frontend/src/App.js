import React, { useState } from "react";
import PairPage from "./PairPage";
import HomePage from "./HomePage";

function App() {
  const [paired, setPaired] = useState(false);
  const [lineUserId, setLineUserId] = useState(null);

  const handlePaired = (lineId) => {
    setPaired(true);
    setLineUserId(lineId);
    if (window.electronAPI) {
      window.electronAPI.sendPaired(); // Start backend + detection
    }
  };

  return paired ? <HomePage lineUserId={lineUserId}/> : <PairPage onPaired={handlePaired} />;
}

export default App;
