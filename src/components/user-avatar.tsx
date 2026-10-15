import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function initials(
  name: string | null | undefined,
  email?: string | null,
) {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`
      : source.slice(0, 2);
  return letters.toUpperCase();
}

export function UserAvatar({
  name,
  email,
  image,
  className,
}: {
  name: string | null | undefined;
  email?: string | null;
  image?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8", className)}>
      {image ? (
        <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback className="bg-accent text-[11px] font-medium text-accent-foreground">
        {initials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = "size-7",
}: {
  people: {
    id: string;
    name: string | null;
    email?: string | null;
    image?: string | null;
  }[];
  max?: number;
  size?: string;
}) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((person) => (
        <UserAvatar
          key={person.id}
          name={person.name}
          email={person.email}
          image={person.image}
          className={cn(size, "ring-2 ring-card")}
        />
      ))}
      {extra > 0 ? (
        <span
          className={cn(
            size,
            "flex items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground ring-2 ring-card",
          )}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
