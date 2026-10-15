import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/server/auth/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AppHeader user={user} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
