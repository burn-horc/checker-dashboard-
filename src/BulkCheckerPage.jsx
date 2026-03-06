import React, { useState } from "react";
import CheckerPage from "./CheckerPage";

function BulkCheckerPage() {

  const [cookies, setCookies] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const startCheck = async () => {

    const cookieList = cookies
      .split("\n")
      .map(c => c.trim())
      .filter(Boolean);

    setResults([]);
    setLoading(true);

    for (const cookie of cookieList) {

      try {

        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cookie })
        });

        const data = await res.json();

        if (data.status === "LIVE") {

          setResults(prev => [
            ...prev,
            `LIVE | ${data.plan} | ${data.country} | PROFILES:${data.profiles}`
          ]);

        } else {

          setResults(prev => [...prev, "DEAD"]);

        }

      } catch {

        setResults(prev => [...prev, "ERROR"]);

      }

    }

    setLoading(false);

  };

  return (
    <div style={{ padding: "20px" }}>

      <h2>Bulk Cookie Checker</h2>

      <textarea
        value={cookies}
        onChange={(e) => setCookies(e.target.value)}
        placeholder="Paste cookies (one per line)"
        rows="8"
        style={{ width: "100%" }}
      />

      <br /><br />

      <button onClick={startCheck} disabled={loading}>
        {loading ? "Checking..." : "Start Bulk Check"}
      </button>

      <pre style={{ whiteSpace: "pre-wrap", marginTop: "20px" }}>
        {results.join("\n")}
      </pre>

    </div>
  );

}

export default BulkCheckerPage;
