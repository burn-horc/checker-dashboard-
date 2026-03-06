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
      return {
        status: "INVALID"
      };
    }

    return {
      status: "VALID"
    };

  } catch (err) {
    return {
      status: "ERROR"
    };
  }
}
