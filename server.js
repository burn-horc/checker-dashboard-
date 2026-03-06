import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;


// API ROUTE
app.post("/api/check", (req, res) => {

  const { cookie } = req.body;

  if (!cookie) {
    return res.status(400).json({
      status: "NO COOKIE"
    });
  }

  res.json({
    status: "VALID",
    plan: "Premium"
  });

});


// SERVE FRONTEND
app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

fetch("/api/check", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ cookie })
});
