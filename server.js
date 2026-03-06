import express from "express";
import cors from "cors";
import { checkCookie } from "./main.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("Checker API running");
});

app.post("/check", async (req, res) => {
  try {
    const { cookie } = req.body;

    if (!cookie) {
      return res.status(400).json({ error: "No cookie provided" });
    }

    const result = await checkCookie(cookie);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Server is running");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
  
