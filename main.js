import fetch from "node-fetch";

export async function checkCookie(cookie) {
  try {
    const res = await fetch("https://www.netflix.com/browse", {
      headers: {
        cookie: cookie,
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"
      }
    });

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
