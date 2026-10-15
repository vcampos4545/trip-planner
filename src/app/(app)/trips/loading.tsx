import { Skeleton } from "@/components/ui/skeleton";

export default function TripsLoading() {
  return (
    <main
      className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6"
      aria-busy="true"
      aria-label="Loading trips"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-44 rounded-xl" />
        ))}
      </div>
    </main>
  );
}
