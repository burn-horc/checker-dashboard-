import { useState } from "react";

export default function Login({ onLogin }) {
  const [code, setCode] = useState("");

  const handleLogin = () => {
    if (code === "1234") {
      onLogin();
    } else {
      alert("Invalid code");
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-black text-white">

      <div className="bg-zinc-900 p-6 rounded-xl w-80">

        <h1 className="text-xl mb-4 text-center">
          Access Checker
        </h1>

        <input
          className="w-full p-2 rounded bg-zinc-800"
          placeholder="Enter access code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />

        <button
          className="w-full mt-4 bg-orange-500 p-2 rounded"
          onClick={handleLogin}
        >
          Enter
        </button>

      </div>
    </div>
  );
}
