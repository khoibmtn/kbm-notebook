import { handleRoute } from "@/server/api/errors";
import { getSession } from "@/server/auth/session";
import { getInviteByToken, isInviteExpired } from "@/server/notebooks/service";

/** Thông tin tối thiểu về lời mời để trang /invite/[token] hiển thị (không lộ dữ liệu sổ tay). */
export const GET = handleRoute<{ token: string }>(async (_req, { params }) => {
  const { token } = await params;
  const row = await getInviteByToken(token);
  const session = await getSession();
  const expired = isInviteExpired(row.invite);
  return {
    invite: {
      notebookTitle: row.notebookTitle,
      notebookEmoji: row.notebookEmoji,
      role: row.invite.role,
      inviterName: row.inviterName,
      email: row.invite.email,
      expired,
      used: row.invite.acceptedAt != null,
      emailMatches: session ? session.user.email.toLowerCase() === row.invite.email.toLowerCase() : null,
    },
  };
});
