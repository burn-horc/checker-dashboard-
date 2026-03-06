import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const app = express();

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;



// REAL COOKIE CHECK
app.post("/api/check", async (req, res) => {

  const { cookie } = req.body;

  if (!cookie) {
    return res.json({ status: "INVALID" });
  }

  try {

    const response = await axios.get(
      "https://www.netflix.com/YourAccount",
      {
        headers: {
          Cookie: cookie,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        timeout: 10000
      }
    );

    if (response.data.includes("account")) {
      res.json({
        status: "VALID",
        plan: "Detected"
      });
    } else {
      res.json({
        status: "INVALID"
      });
    }

  } catch (error) {
    res.json({
      status: "INVALID"
    });
  }

});



// SERVE FRONTEND
app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
