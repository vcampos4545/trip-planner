import { APP_NAME } from "@/config/brand";

export default function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
    </main>
  );
}
