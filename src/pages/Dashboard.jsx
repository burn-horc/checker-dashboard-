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

      <button
        className="mt-4 bg-orange-500 px-4 py-2 rounded"
      >
        Start Checking
      </button>

    </div>
  );
}
