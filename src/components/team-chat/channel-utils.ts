import type { TFunction } from "@/lib/i18n";
import type { ChannelDTO, PersonDTO } from "@/lib/team-chat/types";

/** Người còn lại trong DM (null nếu không phải DM hoặc thiếu dữ liệu). */
export function dmPeer(channel: ChannelDTO, meId: string): PersonDTO | null {
  if (channel.type !== "dm") return null;
  return channel.members.find((m) => m.id !== meId) ?? null;
}

/** Tên hiển thị của kênh. */
export function channelTitle(channel: ChannelDTO, meId: string, t: TFunction): string {
  if (channel.type === "general") return t("team.channel.general");
  if (channel.type === "dm") return dmPeer(channel, meId)?.name ?? t("team.channel.dm");
  return channel.name ?? "";
}

/** Sắp xếp: general, chủ đề (A–Z), DM theo hoạt động gần nhất. */
export function sortChannels(channels: ChannelDTO[]): ChannelDTO[] {
  const rank = (c: ChannelDTO) => (c.type === "general" ? 0 : c.type === "topic" ? 1 : 2);
  return [...channels].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.type === "dm") return b.lastActivityAt.localeCompare(a.lastActivityAt);
    return (a.name ?? "").localeCompare(b.name ?? "", "vi");
  });
}
