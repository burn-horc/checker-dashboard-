export default function Dashboard() {

  return (
    <div className="min-h-screen bg-black text-white p-4">

      <h1 className="text-2xl mb-4">
        Cookie Checker
      </h1>

      <textarea
        placeholder="Paste cookie..."
        className="w-full h-40 p-3 bg-zinc-900 rounded"
      />

      const checkCookie = async () => {

  const cookie = document.querySelector("textarea").value;

  const res = await fetch("https://your-api-url/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ cookie })
  });

  const data = await res.json();

  alert(data.status);
};

    </div>
  );
}
