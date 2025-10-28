import React, { useState } from "react";
import PairPage from "./PairPage";
import HomePage from "./HomePage";

function App() {
  const [lineUserId, setLineUserId] = useState(null);

  const handleUnpair = () => {
    setLineUserId(null);
    // Add any other cleanup needed
  };

  return (
    <div>
      {lineUserId ? (
        <HomePage lineUserId={lineUserId} onUnpair={handleUnpair} />
      ) : (
        <PairPage onPaired={setLineUserId} />
      )}
    </div>
  );
}

export default App;
