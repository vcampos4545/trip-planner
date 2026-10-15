import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();
  redirect(user ? "/trips" : "/signin");
}
