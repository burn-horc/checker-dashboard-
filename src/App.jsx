import { useState } from "react";

function App() {

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

    setResult(`${data.status} - ${data.plan}`);

  };

  return (
    <div style={{ padding: "40px" }}>
      <h1>Cookie Checker</h1>

      <textarea
        placeholder="Paste cookie here"
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
      />

      <br /><br />

      <button onClick={checkCookie}>
        Check Cookie
      </button>

      <h2>{result}</h2>

    </div>
  );
}

export default App;
