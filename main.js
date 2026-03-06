import fetch from "node-fetch";

export async function checkCookie(cookie) {
  try {
    const response = await fetch("https://www.netflix.com/browse", {
      headers: {
        "user-agent": "Mozilla/5.0",
        "cookie": cookie
      },
      redirect: "follow"
    });

    const text = await response.text();

    // If redirected to login page → cookie invalid
    if (response.url.includes("login") || text.includes("Sign In")) {
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
