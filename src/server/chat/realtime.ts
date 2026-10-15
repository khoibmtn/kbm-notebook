import "server-only";
import type { Namespace, Server } from "socket.io";

/**
 * Singleton Socket.IO gắn trên globalThis: server.ts (tsx/esbuild) tạo, còn route handler của Next
 * (bundle riêng trong cùng tiến trình) dùng lại qua cùng một globalThis.
 */
type G = typeof globalThis & { __kbmIo?: Server };
const g = globalThis as G;

export const RT_NAMESPACE = "/rt";

export function setIo(io: Server): void {
  g.__kbmIo = io;
}

export function getIo(): Server | null {
  return g.__kbmIo ?? null;
}

function ns(): Namespace | null {
  return getIo()?.of(RT_NAMESPACE) ?? null;
}

/** Sự kiện realtime (docs/02 §3.5). */
export type RealtimeEvent =
  | "message:new"
  | "message:edit"
  | "message:delete"
  | "message:recall"
  | "message:reaction"
  | "message:pin"
  | "channel:new"
  | "channel:update"
  | "typing"
  | "read"
  | "notification"
  | "source:status"
  | "artifact:status"
  | "artifact:export"
  | "job:progress"
  | "member:changed";

export const rooms = {
  notebook: (id: string) => `notebook:${id}`,
  channel: (id: string) => `channel:${id}`,
  user: (id: string) => `user:${id}`,
};

// Khi chưa có server Socket.IO (vd: chạy test / next dev thuần), các hàm emit là no-op.
export function emitToNotebook(notebookId: string, event: RealtimeEvent, payload: unknown): void {
  ns()?.to(rooms.notebook(notebookId)).emit(event, payload);
}

export function emitToUser(userId: string, event: RealtimeEvent, payload: unknown): void {
  ns()?.to(rooms.user(userId)).emit(event, payload);
}

export function emitToChannel(channelId: string, event: RealtimeEvent, payload: unknown): void {
  ns()?.to(rooms.channel(channelId)).emit(event, payload);
}

/** Cho mọi socket của user vào phòng kênh (vd. DM mới tạo, hoặc vừa được thêm vào kênh). */
export function joinUserToChannel(userId: string, channelId: string): void {
  ns()?.in(rooms.user(userId)).socketsJoin(rooms.channel(channelId));
}

/** Cho mọi socket đang ở phòng notebook vào phòng kênh (kênh chủ đề mới: mọi thành viên). */
export function joinNotebookToChannel(notebookId: string, channelId: string): void {
  ns()?.in(rooms.notebook(notebookId)).socketsJoin(rooms.channel(channelId));
}

/** Rút mọi socket của user khỏi các phòng (vd. bị xoá khỏi notebook). */
export function removeUserFromRooms(userId: string, roomNames: string[]): void {
  if (roomNames.length === 0) return;
  ns()?.in(rooms.user(userId)).socketsLeave(roomNames);
}

export type JobProgressPayload = {
  jobId: string;
  type: string;
  status: "running" | "done" | "failed";
  progress: number;
  error?: string;
};

/**
 * Phát tiến độ job tới notebook/user nếu payload job có `notebookId`/`userId`.
 * Job của nội dung RIÊNG TƯ (`payload.private === true`) chỉ báo cho `userId`, không báo cả sổ tay (thông báo lỗi có thể lộ tên nguồn).
 */
export function emitJobProgress(jobPayload: unknown, data: JobProgressPayload): void {
  if (!jobPayload || typeof jobPayload !== "object") return;
  const p = jobPayload as { notebookId?: unknown; userId?: unknown; private?: unknown };
  if (typeof p.notebookId === "string" && p.private !== true) emitToNotebook(p.notebookId, "job:progress", data);
  if (typeof p.userId === "string") emitToUser(p.userId, "job:progress", data);
}
