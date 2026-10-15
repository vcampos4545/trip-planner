import { requireUser } from "@/server/auth/session";

export default async function NewTripPage() {
  await requireUser("/trips/new");
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">New trip</h1>
    </main>
  );
}
