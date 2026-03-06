import { useState } from "react";

function App() {

  const [cookie, setCookie] = useState("");
  const [result, setResult] = useState("READY");
  const [loading, setLoading] = useState(false);

  const checkCookie = async () => {

    if (!cookie) {
      setResult("Please paste a cookie first.");
      return;
    }

    setLoading(true);
    setResult("Checking...");

    try {

      const res = await fetch("/api/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ cookie })
      });

      const data = await res.json();

      if (data.status !== "VALID") {
        setResult("INVALID COOKIE");
        setLoading(false);
        return;
      }

      setResult(`
PLAN: ${data.plan}
COUNTRY: ${data.country}
PROFILES: ${data.profiles}
KIDS PROFILES: ${data.kidsProfiles}
EXTRA MEMBER SLOTS: ${data.extraMembers}
EMAIL: ${data.email}
PAYMENT STATUS: ${data.paymentStatus}
`);

    } catch (err) {

      setResult("SERVER ERROR");

    }

    setLoading(false);
  };

  return (
    <div style={{ padding: "40px", fontFamily: "Arial" }}>

      <h1>Netflix Cookie Checker</h1>

      <textarea
        placeholder="Paste cookie here"
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        style={{
          width: "100%",
          height: "120px",
          padding: "10px",
          fontSize: "14px"
        }}
      />

      <br /><br />

      <button
        onClick={checkCookie}
        disabled={loading}
        style={{
          padding: "10px 20px",
          fontSize: "16px",
          cursor: "pointer"
        }}
      >
        {loading ? "Checking..." : "Check Cookie"}
      </button>

      <pre style={{
        whiteSpace: "pre-wrap",
        fontSize: "16px",
        marginTop: "20px",
        background: "#111",
        color: "#0f0",
        padding: "15px"
      }}>
        {result}
      </pre>

    </div>
  );
}

export default App;
