import { History } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { formatRelativeTime } from "@/lib/dates";

export type ActivityView = {
  id: string;
  summary: string;
  createdAt: string;
  actor: { id: string; name: string | null; image: string | null } | null;
};

export function ActivityFeed({ items }: { items: ActivityView[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title="No activity yet"
        description="Changes the group makes show up here."
      />
    );
  }
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex gap-2.5 text-sm">
          <UserAvatar
            name={item.actor?.name ?? "?"}
            image={item.actor?.image}
            className="size-6"
          />
          <div className="min-w-0">
            <p className="break-words">
              <span className="font-medium">
                {item.actor?.name ?? "Someone"}
              </span>{" "}
              {item.summary}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(item.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
