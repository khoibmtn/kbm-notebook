"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let refCount = 0;
const joinedNotebooks = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function acquire(): Socket {
  if (!socket) {
    const s = io("/rt", { withCredentials: true, transports: ["websocket", "polling"], autoConnect: true });
    // Tham gia lại các phòng notebook sau khi (kết nối lại).
    s.on("connect", () => {
      joinedNotebooks.forEach((id) => s.emit("join:notebook", { notebookId: id }));
      notify();
    });
    s.on("disconnect", notify);
    socket = s;
  }
  refCount++;
  return socket;
}

function release() {
  refCount--;
  if (refCount > 0) return;
  refCount = 0;
  // Trì hoãn ngắt kết nối để tránh đóng/mở lại liên tục (React StrictMode, chuyển trang).
  setTimeout(() => {
    if (refCount === 0 && socket) {
      socket.disconnect();
      socket = null;
    }
  }, 300);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  acquire();
  cb(); // socket vừa được tạo → render lại để lấy snapshot mới
  return () => {
    listeners.delete(cb);
    release();
  };
}

const getSocket = () => socket;
const getConnected = () => socket?.connected ?? false;
const serverNull = () => null;
const serverFalse = () => false;

/**
 * Kết nối Socket.IO namespace `/rt` (xác thực bằng cookie session, dùng chung một kết nối).
 * `joinNotebook(id)` yêu cầu server kiểm tra thành viên rồi vào phòng `notebook:{id}`.
 */
export function useRealtime() {
  const sock = useSyncExternalStore(subscribe, getSocket, serverNull);
  const connected = useSyncExternalStore(subscribe, getConnected, serverFalse);

  const joinNotebook = useCallback(
    (notebookId: string) => {
      joinedNotebooks.add(notebookId);
      if (sock?.connected) sock.emit("join:notebook", { notebookId });
      return () => {
        joinedNotebooks.delete(notebookId);
        sock?.emit("leave:notebook", { notebookId });
      };
    },
    [sock],
  );

  const joinChannel = useCallback(
    (channelId: string) => {
      sock?.emit("join:channel", { channelId });
      return () => {
        sock?.emit("leave:channel", { channelId });
      };
    },
    [sock],
  );

  const on = useCallback(
    <T = unknown>(event: string, handler: (payload: T) => void) => {
      sock?.on(event, handler);
      return () => {
        sock?.off(event, handler);
      };
    },
    [sock],
  );

  return { socket: sock, connected, joinNotebook, joinChannel, on };
}

/** Lắng nghe một sự kiện realtime trong vòng đời component. */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const { on } = useRealtime();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => on<T>(event, (p) => handlerRef.current(p)), [on, event]);
}
