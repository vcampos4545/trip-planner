import type { Route } from "next";
import { redirect } from "next/navigation";

/**
 * Atlas used to have its own tab here. It now opens as a panel from every tab, so old links land
 * on the overview with the panel open and any suggested prompt filled in.
 */
export default async function PlanRedirect({
  params,
  searchParams,
}: PageProps<"/trips/[tripId]/plan">) {
  const { tripId } = await params;
  const query = await searchParams;
  const prompt =
    typeof query.prompt === "string" ? query.prompt.slice(0, 500) : null;
  redirect(
    `/trips/${encodeURIComponent(tripId)}?atlas=open${
      prompt ? `&prompt=${encodeURIComponent(prompt)}` : ""
    }` as Route,
  );
}
