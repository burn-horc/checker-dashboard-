import React, { useState } from "react";
import CheckerPage from "./CheckerPage";
import BulkCheckerPage from "./BulkCheckerPage";

function App() {

  const [page, setPage] = useState("single");

  return (

    <div>

      <div style={{ padding: "10px" }}>

        <button onClick={() => setPage("single")}>
          Single Checker
        </button>

        <button onClick={() => setPage("bulk")}>
          Bulk Checker
        </button>

      </div>

      {page === "single" && <CheckerPage />}
      {page === "bulk" && <BulkCheckerPage />}

    </div>

  );
}

export default App;
