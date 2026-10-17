import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UserAvatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-8", className)}>
      {image ? <AvatarImage src={image} alt={name} /> : null}
      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
