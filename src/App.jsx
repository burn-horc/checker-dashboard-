import { useState } from "react";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

export default function App() {
  const [access, setAccess] = useState(false);

  return access ? (
    <Dashboard />
  ) : (
    <Login onLogin={() => setAccess(true)} />
  );
}
