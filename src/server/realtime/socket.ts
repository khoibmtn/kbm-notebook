import "server-only";
import type { Server as HttpServer } from "node:http";
import { and, eq } from "drizzle-orm";
import { Server, type Socket } from "socket.io";
import { getSession } from "@/server/auth/session";
import { getNotebookRole } from "@/server/auth/permissions";
import { RT_NAMESPACE, rooms, setIo } from "@/server/chat/realtime";
import { db } from "@/server/db";
import { channelMembers, channels } from "@/server/db/schema";
import { isUuid } from "@/server/api/errors";

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
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  rt.on("connection", (socket: Socket) => {
    const userId = socket.data.userId as string;
    void socket.join(rooms.user(userId));

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
