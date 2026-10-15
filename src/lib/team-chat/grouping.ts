/** Gộp tin nhắn liên tiếp của cùng người gửi (trong 5 phút) và chèn dải phân cách ngày. */

export const GROUP_GAP_MS = 5 * 60 * 1000;

export type GroupableMessage = { id: string; kind?: string; sender: { id: string }; createdAt: string };

export type ChatItem<M extends GroupableMessage> =
  | { type: "day"; key: string; date: string }
  | { type: "divider"; key: string }
  | { type: "group"; key: string; senderId: string; messages: M[] };

/** Khoá ngày theo múi giờ cục bộ (yyyy-mm-dd). */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * `messages` phải theo thứ tự thời gian tăng dần.
 * - Đổi ngày → chèn `day`.
 * - `dividerBeforeId` → chèn `divider` ("Tin nhắn mới") và ngắt nhóm tại đó.
 * - Tin hệ thống luôn nằm nhóm riêng.
 */
export function groupMessages<M extends GroupableMessage>(
  messages: M[],
  opts: { gapMs?: number; dividerBeforeId?: string | null } = {},
): ChatItem<M>[] {
  const gap = opts.gapMs ?? GROUP_GAP_MS;
  const items: ChatItem<M>[] = [];
  let current: Extract<ChatItem<M>, { type: "group" }> | null = null;
  let prev: M | null = null;
  let lastDay: string | null = null;

  for (const m of messages) {
    const dk = dayKey(m.createdAt);
    let broke = false;
    if (dk !== lastDay) {
      items.push({ type: "day", key: `day-${dk}`, date: m.createdAt });
      lastDay = dk;
      broke = true;
    }
    if (opts.dividerBeforeId && m.id === opts.dividerBeforeId) {
      items.push({ type: "divider", key: `divider-${m.id}` });
      broke = true;
    }
    const sameSender = prev !== null && prev.sender.id === m.sender.id;
    const withinGap = prev !== null && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <= gap;
    const isSystem = m.kind === "system" || prev?.kind === "system";
    if (current && !broke && sameSender && withinGap && !isSystem) {
      current.messages.push(m);
    } else {
      current = { type: "group", key: `group-${m.id}`, senderId: m.sender.id, messages: [m] };
      items.push(current);
    }
    prev = m;
  }
  return items;
}

/** Thêm/thay tin nhắn vào danh sách (tăng dần theo thời gian), khử trùng theo id. */
export function upsertMessage<M extends GroupableMessage>(list: M[], msg: M): M[] {
  const idx = list.findIndex((x) => x.id === msg.id);
  if (idx !== -1) {
    const next = list.slice();
    next[idx] = msg;
    return next;
  }
  const t = new Date(msg.createdAt).getTime();
  let at = list.length;
  while (at > 0 && new Date(list[at - 1].createdAt).getTime() > t) at--;
  return [...list.slice(0, at), msg, ...list.slice(at)];
}
