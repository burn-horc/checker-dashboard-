import React, { useState } from "react";

function CheckerPage() {

  const [cookie, setCookie] = useState("");
  const [result, setResult] = useState("");

  const checkCookie = async () => {

    const res = await fetch("/api/check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ cookie })
    });

    const data = await res.json();
    setResult(data.status + " - " + data.plan);
  };

  return (
    <div style={{ padding: "20px" }}>

      <h2>Cookie Checker</h2>

      <textarea
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        placeholder="Paste cookie here"
        rows="6"
        style={{ width: "100%" }}
      />

      <br /><br />

      <button onClick={checkCookie}>
        Check Cookie
      </button>

      <p>{result}</p>

    </div>
  );
}

export default CheckerPage;
