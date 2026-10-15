/** Kiểu dữ liệu dùng chung giữa server và client cho chat nhóm (JSON-serializable). */

export type ChannelType = "general" | "topic" | "dm";
export type MessageKind = "text" | "file" | "artifact_ref" | "source_ref" | "note_ref" | "system";
export type RefType = "artifact" | "source" | "note";

export type PersonDTO = { id: string; name: string; image: string | null };

export type ChannelLastMessageDTO = {
  id: string;
  senderId: string;
  senderName: string;
  kind: MessageKind;
  /** Bản xem trước dạng văn bản thuần (đã bỏ markup mention). Rỗng nếu đã thu hồi. */
  preview: string;
  recalled: boolean;
  createdAt: string;
};

export type ChannelDTO = {
  id: string;
  notebookId: string;
  type: ChannelType;
  name: string | null;
  createdBy: string | null;
  createdAt: string;
  unread: number;
  muted: boolean;
  lastReadAt: string | null;
  lastMessage: ChannelLastMessageDTO | null;
  /** Mốc sắp xếp: thời điểm tin nhắn cuối hoặc lúc tạo kênh. */
  lastActivityAt: string;
  /** Thành viên (chỉ DM): gồm cả người dùng hiện tại. */
  members: PersonDTO[];
};

export type ReactionDTO = { emoji: string; count: number; userIds: string[] };

export type AttachmentDTO = {
  id: string;
  fileId: string;
  name: string;
  mime: string;
  size: number;
};

export type RefDTO = {
  type: RefType;
  id: string;
  title: string;
  /** Loại con: artifact.type / source.kind / "note". */
  subtype: string | null;
  /** Không còn truy cập được (đã xoá / chuyển riêng tư). */
  available: boolean;
};

export type ReplySnippetDTO = {
  id: string;
  senderId: string | null;
  senderName: string | null;
  snippet: string;
  /** Tin gốc đã xoá/thu hồi. */
  unavailable: boolean;
};

export type MessageDTO = {
  id: string;
  channelId: string;
  kind: MessageKind;
  /** Rỗng khi `recalledAt` đã đặt. Có thể chứa token `@[Tên](userId)`. */
  content: string;
  sender: PersonDTO;
  replyTo: ReplySnippetDTO | null;
  createdAt: string;
  editedAt: string | null;
  recalledAt: string | null;
  pinned: boolean;
  mentions: string[];
  reactions: ReactionDTO[];
  attachments: AttachmentDTO[];
  refs: RefDTO[];
};

export type ReadReceiptDTO = { userId: string; name: string; image: string | null; lastReadAt: string };

export type MessagesPageDTO = {
  /** Mới nhất trước. */
  messages: MessageDTO[];
  /** Còn tin cũ hơn trang này. */
  hasMore: boolean;
  /** Còn tin mới hơn trang này (khi dùng after/around). */
  hasNewer: boolean;
  /** Chỉ có ở trang đầu (không before/after/around). */
  pinned?: MessageDTO[];
  reads?: ReadReceiptDTO[];
};

export type NotificationDTO = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

/** Payload sự kiện realtime. */
export type MessageNewEvent = { notebookId: string; channelId: string; message: MessageDTO };
export type MessageUpdateEvent = { notebookId: string; channelId: string; message: MessageDTO };
export type MessageDeleteEvent = { notebookId: string; channelId: string; messageId: string };
export type MessageReactionEvent = {
  notebookId: string;
  channelId: string;
  messageId: string;
  reactions: ReactionDTO[];
};
export type MessagePinEvent = {
  notebookId: string;
  channelId: string;
  messageId: string;
  pinned: boolean;
  message: MessageDTO;
};
export type TypingEvent = { channelId: string; userId: string; name: string };
export type ReadEvent = {
  notebookId: string;
  channelId: string;
  userId: string;
  messageId: string | null;
  lastReadAt: string;
};
export type ChannelEvent = {
  notebookId: string;
  channel: Omit<ChannelDTO, "unread" | "muted" | "lastReadAt" | "lastMessage">;
};
export type NotificationEvent = { notification: NotificationDTO };
