import { requireUser } from "@/server/auth/session";

export default async function TripsPage() {
  await requireUser("/trips");
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
    </main>
  );
}
