import { Suspense } from "react";
import { TeamChat } from "@/components/team-chat/team-chat";

export default function TeamPage() {
  return (
    <Suspense fallback={null}>
      <TeamChat />
    </Suspense>
  );
}
