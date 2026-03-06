import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   SERVE FRONTEND
========================= */

const __dirname = new URL('.', import.meta.url).pathname;

app.use(express.static("dist"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dist/index.html"));
});

/* =========================
   COOKIE CONVERTER
========================= */

function convertCookieFormat(raw) {
  const lines = raw.split("\n");
  const cookies = [];

  for (let line of lines) {
    if (line.includes("\t")) {
      const parts = line.split("\t");
      if (parts.length >= 7) {
        cookies.push(parts[5] + "=" + parts[6]);
      }
    }
  }

  if (cookies.length > 0) {
    return cookies.join("; ");
  }

  return raw;
}

/* =========================
   CHECK API
========================= */

app.post("/api/check", async (req, res) => {

  let { cookie } = req.body;

  if (!cookie) {
    return res.json({ status: "INVALID" });
  }

  try {

    cookie = convertCookieFormat(cookie);

    const response = await fetch(
      "https://www.netflix.com/account",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Cookie": cookie
        }
      }
    );

    const text = await response.text();

    if (!text.includes("account")) {
      return res.json({ status: "INVALID" });
    }

    let plan = "UNKNOWN";

    if (text.includes("Premium")) plan = "PREMIUM";
    else if (text.includes("Standard")) plan = "STANDARD";
    else if (text.includes("Basic")) plan = "BASIC";

    let country = "UNKNOWN";

    const match = text.match(/"currentCountry":"(.*?)"/);
    if (match) country = match[1];

    res.json({
      status: "VALID",
      plan,
      country
    });

  } catch {

    res.json({
      status: "ERROR"
    });

  }

});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Checker server running on port " + PORT);
});
