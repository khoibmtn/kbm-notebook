import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GroupView } from "@/components/community/group-view";
import { AppHeader } from "@/components/shared/app-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { requirePageSession } from "@/server/auth/page-session";
import { getGroupBySlug, getGroupRole, listGroupMembers, listGroupNotebooks, summarizeGroup } from "@/server/community/groups";
import { db } from "@/server/db";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** `/g/[slug]` — nhóm học tập. Nhóm riêng tư chỉ thành viên thấy (người ngoài nhận trang "không tìm thấy"). */
export default async function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user } = await requirePageSession(`/g/${slug}`);
  const t = await getT();
  const group = await getGroupBySlug(slug);
  const role = group ? await getGroupRole(user.id, group.id) : null;
  const visible = group && (group.visibility === "public" || role);

  if (!group || !visible) {
    return (
      <div className="flex min-h-screen flex-col">
        <AppHeader user={user} />
        <main className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={UsersRound}
            title={t("community.group.notFound")}
            description={t("community.group.notFoundDescription")}
            action={
              <Button asChild variant="outline">
                <Link href="/explore?tab=groups">{t("community.group.back")}</Link>
              </Button>
            }
          />
        </main>
      </div>
    );
  }

  const [summary, members, notebooks, owner] = await Promise.all([
    summarizeGroup(group, user.id),
    role ? listGroupMembers(group.id, role) : Promise.resolve([]),
    listGroupNotebooks(group, user.id, role),
    db.select({ name: users.name }).from(users).where(eq(users.id, group.ownerId)).limit(1),
  ]);
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <GroupView group={summary} ownerName={owner[0]?.name ?? ""} members={members} notebooks={notebooks} meId={user.id} />
      </main>
    </div>
  );
}
