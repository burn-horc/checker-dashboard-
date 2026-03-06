import { useState } from "react";

function App() {

  const [cookies, setCookies] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const startCheck = async () => {

    if (!cookies) {
      alert("Paste cookies first");
      return;
    }

    const cookieList = cookies
      .split("\n")
      .map(c => c.trim())
      .filter(Boolean);

    setResults([]);
    setLoading(true);

    for (let cookie of cookieList) {

      try {

        const res = await fetch("/api/check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ cookie })
        });

        const data = await res.json();

        if (data.status === "LIVE") {

          setResults(prev => [
            ...prev,
            `LIVE | ${data.plan} | ${data.country} | PROFILES:${data.profiles}`
          ]);

        } else {

          setResults(prev => [...prev, "BAD"]);

        }

      } catch (err) {

        setResults(prev => [...prev, "ERROR"]);

      }

    }

    setLoading(false);

  };

  return (
    <div style={{ padding: "40px", fontFamily: "Arial" }}>

      <h1>Netflix Bulk Cookie Checker</h1>

      <textarea
        placeholder="Paste cookies (one per line)"
        value={cookies}
        onChange={(e) => setCookies(e.target.value)}
        style={{
          width: "100%",
          height: "200px",
          padding: "10px"
        }}
      />

      <br /><br />

      <button onClick={startCheck} disabled={loading}>
        {loading ? "Checking..." : "Start Check"}
      </button>

      <pre style={{
        marginTop: "20px",
        background: "#111",
        color: "#0f0",
        padding: "20px"
      }}>
        {results.join("\n")}
      </pre>

    </div>
  );

}

export default App;
