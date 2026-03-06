import fetch from "node-fetch";

export async function checkCookie(cookie) {
  try {
    const response = await fetch("https://www.netflix.com/browse", {
  headers: {
    "user-agent": "Mozilla/5.0",
    "cookie": cookie
  }
});

const text = await response.text();

if (!text.includes("Netflix")) {
  return res.json({ status: "INVALID" });
}

return res.json({ status: "VALID" });

    if (res.status === 200) {
      return {
        status: "HIT"
      };
    }

    return {
      status: "BAD"
    };

  } catch (err) {
    return {
      status: "ERROR"
    };
  }
}
