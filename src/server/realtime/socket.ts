import "server-only";
import type { Server as HttpServer } from "node:http";
import { and, eq, isNull } from "drizzle-orm";
import { Server, type Socket } from "socket.io";
import { isOriginAllowed, trustedOriginsFromEnv } from "@/lib/request-origin";
import { getSession } from "@/server/auth/session";
import { getNotebookRole } from "@/server/auth/permissions";
import { RT_NAMESPACE, rooms, setIo } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { channelMembers, channels, notebooks } from "@/server/db/schema";
import { ApiError, isUuid } from "@/server/api/errors";
import { requireChannelAccess } from "@/server/team-chat/access";
import { markChannelRead } from "@/server/team-chat/actions";

type Ack = (res: { ok: boolean; error?: string }) => void;

function reply(ack: unknown, res: { ok: boolean; error?: string }) {
  if (typeof ack === "function") (ack as Ack)(res);
}

/** Gắn Socket.IO vào http server; namespace `/rt` xác thực bằng cookie session better-auth. */
export function attachSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    // Next dev dùng upgrade cho HMR; không được huỷ các upgrade không thuộc Socket.IO.
    destroyUpgrade: false,
    serveClient: false,
    // Chống CSWSH (L-1): trình duyệt luôn gửi Origin; chỉ nhận cùng host hoặc origin tin cậy. Client không phải trình duyệt (không Origin) vẫn phải qua xác thực cookie.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, !origin || isOriginAllowed(origin, req.headers["x-forwarded-host"]?.toString() ?? req.headers.host ?? null, trustedOriginsFromEnv()));
    },
  });
  setIo(io);

  const rt = io.of(RT_NAMESPACE);

  rt.use(async (socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie;
      if (!cookie) return next(new Error("unauthorized"));
      const session = await getSession(new Headers({ cookie }));
      if (!session) return next(new Error("unauthorized"));
      socket.data.userId = session.user.id;
      socket.data.userName = session.user.name;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  rt.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string;
    const userName = (socket.data.userName as string | undefined) ?? "";
    void socket.join(rooms.user(userId));

    // Vào sẵn mọi phòng kênh của user (để nhận tin mới/badge chưa đọc dù chưa mở trang chat).
    // Đồng bộ phòng khi tạo/xoá kênh được xử lý ở server/chat/realtime (joinUserToChannel, removeUserFromRooms).
    void (async () => {
      try {
        const rows = await db
          .select({ id: channels.id })
          .from(channelMembers)
          .innerJoin(channels, eq(channels.id, channelMembers.channelId))
          .innerJoin(notebooks, eq(notebooks.id, channels.notebookId))
          .where(and(eq(channelMembers.userId, userId), isNull(notebooks.deletedAt)));
        await socket.join(rows.map((r) => rooms.channel(r.id)));
      } catch (err) {
        console.error("[rt] auto-join channels failed", err);
      }
    })();

    // typing: chỉ phát cho kênh mà socket đã vào phòng (đã kiểm tra thành viên), giới hạn 1 lần/1.5s mỗi kênh.
    const lastTyping = new Map<string, number>();
    socket.on("typing", (payload: { channelId?: string }) => {
      const id = payload?.channelId;
      if (!id || !isUuid(id) || !socket.rooms.has(rooms.channel(id))) return;
      const now = Date.now();
      if (now - (lastTyping.get(id) ?? 0) < 1500) return;
      lastTyping.set(id, now);
      socket.to(rooms.channel(id)).emit("typing", { channelId: id, userId, name: userName });
    });

    // read: cập nhật mốc đã đọc rồi phát `read` tới kênh (markChannelRead tự phát).
    socket.on("read", async (payload: { channelId?: string; messageId?: string }, ack?: Ack) => {
      const id = payload?.channelId;
      if (!id || !isUuid(id)) return reply(ack, { ok: false, error: "invalid_channel" });
      try {
        const access = await requireChannelAccess(userId, id);
        await markChannelRead(access, userId, payload.messageId && isUuid(payload.messageId) ? payload.messageId : null);
        reply(ack, { ok: true });
      } catch (err) {
        reply(ack, { ok: false, error: err instanceof ApiError && err.status === 404 ? "forbidden" : "error" });
      }
    });

    socket.on("join:notebook", async (payload: { notebookId?: string }, ack?: Ack) => {
      const id = payload?.notebookId;
      if (!id || !isUuid(id)) return reply(ack, { ok: false, error: "invalid_notebook" });
      const role = await getNotebookRole(userId, id);
      if (!role) return reply(ack, { ok: false, error: "forbidden" });
      await socket.join(rooms.notebook(id));
      reply(ack, { ok: true });
    });

    socket.on("leave:notebook", async (payload: { notebookId?: string }, ack?: Ack) => {
      if (payload?.notebookId) await socket.leave(rooms.notebook(payload.notebookId));
      reply(ack, { ok: true });
    });

    socket.on("join:channel", async (payload: { channelId?: string }, ack?: Ack) => {
      const id = payload?.channelId;
      if (!id || !isUuid(id)) return reply(ack, { ok: false, error: "invalid_channel" });
      const rows = await db
        .select({ one: channels.id })
        .from(channelMembers)
        .innerJoin(channels, eq(channels.id, channelMembers.channelId))
        .where(and(eq(channelMembers.channelId, id), eq(channelMembers.userId, userId)))
        .limit(1);
      if (rows.length === 0) return reply(ack, { ok: false, error: "forbidden" });
      await socket.join(rooms.channel(id));
      reply(ack, { ok: true });
    });

    socket.on("leave:channel", async (payload: { channelId?: string }, ack?: Ack) => {
      if (payload?.channelId) await socket.leave(rooms.channel(payload.channelId));
      reply(ack, { ok: true });
    });
  });

  return io;
}
