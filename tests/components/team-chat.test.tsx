import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookProvider } from "@/components/notebook/notebook-context";
import { Composer, type SendPayload } from "@/components/team-chat/composer";
import { MessageItem, type MessageActions } from "@/components/team-chat/message-item";
import { RichText } from "@/components/team-chat/rich-text";
import { ShareToChatDialog } from "@/components/team-chat/share-to-chat-dialog";
import { I18nProvider } from "@/lib/i18n-client";
import type { Role } from "@/lib/roles";
import type { ChannelDTO, MessageDTO, PersonDTO } from "@/lib/team-chat/types";

const ME = "00000000-0000-4000-8000-0000000000aa";
const ANH = "00000000-0000-4000-8000-0000000000bb";
const BINH = "00000000-0000-4000-8000-0000000000cc";

const people: PersonDTO[] = [
  { id: ANH, name: "Nguyễn Anh", image: null },
  { id: BINH, name: "Trần Bình", image: null },
];

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="vi">
      <NotebookProvider
        value={{
          role: "editor",
          user: { id: ME, name: "Tôi", email: "toi@example.com" },
          notebook: {
            id: "nb-1",
            title: "Sổ tay",
            description: null,
            emoji: null,
            coverColor: null,
            systemInstruction: null,
            allowWeb: false,
            defaultArtifactVisibility: "notebook",
            ownerId: ME,
          },
        }}
      >
        {ui}
      </NotebookProvider>
    </I18nProvider>
  );
}

function ComposerHarness({ onSend, onEditLast = () => {} }: { onSend: (p: SendPayload) => Promise<void>; onEditLast?: () => void }) {
  return (
    <Composer
      channelId="ch-1"
      members={people}
      replyTo={null}
      onCancelReply={() => {}}
      editing={null}
      onCancelEdit={() => {}}
      onSend={onSend}
      onEditSubmit={async () => {}}
      onTyping={() => {}}
      onEditLast={onEditLast}
      onPickRef={() => {}}
      placeholder="Nhắn tới General…"
    />
  );
}

describe("Composer", () => {
  it("Enter gửi, Shift+Enter xuống dòng, ô nhập được xoá sau khi gửi", async () => {
    const onSend = vi.fn<(p: SendPayload) => Promise<void>>(async () => {});
    const user = userEvent.setup();
    render(wrap(<ComposerHarness onSend={onSend} />));
    const input = screen.getByTestId("composer-input");
    await user.type(input, "dòng một{Shift>}{Enter}{/Shift}dòng hai");
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue("dòng một\ndòng hai");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toMatchObject({ content: "dòng một\ndòng hai", mentions: [], attachmentFileIds: [] });
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("không gửi tin trống; nút gửi bị khoá", async () => {
    const onSend = vi.fn<(p: SendPayload) => Promise<void>>(async () => {});
    const user = userEvent.setup();
    render(wrap(<ComposerHarness onSend={onSend} />));
    expect(screen.getByTestId("composer-send")).toBeDisabled();
    await user.type(screen.getByTestId("composer-input"), "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Enter khi đang gõ bằng IME (isComposing) không gửi", async () => {
    const onSend = vi.fn<(p: SendPayload) => Promise<void>>(async () => {});
    const user = userEvent.setup();
    render(wrap(<ComposerHarness onSend={onSend} />));
    const input = screen.getByTestId("composer-input");
    await user.type(input, "xin chao");
    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    Object.defineProperty(evt, "isComposing", { value: true });
    input.dispatchEvent(evt);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("gõ @ hiện gợi ý, ↓ + Enter chọn, nội dung gửi đi chứa token mention và mentions[]", async () => {
    const onSend = vi.fn<(p: SendPayload) => Promise<void>>(async () => {});
    const user = userEvent.setup();
    render(wrap(<ComposerHarness onSend={onSend} />));
    const input = screen.getByTestId("composer-input");
    await user.type(input, "Chào @b");
    const popover = await screen.findByTestId("mention-popover");
    expect(popover).toHaveTextContent("Trần Bình");
    expect(popover).not.toHaveTextContent("Nguyễn Anh");
    await user.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled(); // Enter chọn gợi ý, chưa gửi
    expect(input).toHaveValue("Chào @Trần Bình ");
    await user.type(input, "xem giúp");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toMatchObject({
      content: `Chào @[Trần Bình](${BINH}) xem giúp`,
      mentions: [BINH],
    });
  });

  it("điều hướng gợi ý bằng ↑/↓ và Esc đóng popover", async () => {
    const user = userEvent.setup();
    render(wrap(<ComposerHarness onSend={async () => {}} />));
    const input = screen.getByTestId("composer-input");
    await user.type(input, "@");
    const opts = await screen.findAllByRole("option");
    expect(opts).toHaveLength(2);
    expect(opts[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("mention-popover")).toBeNull();
  });

  it("↑ khi ô nhập trống gọi onEditLast; khi đã có chữ thì không", async () => {
    const onEditLast = vi.fn();
    const user = userEvent.setup();
    render(wrap(<ComposerHarness onSend={async () => {}} onEditLast={onEditLast} />));
    const input = screen.getByTestId("composer-input");
    await user.click(input);
    await user.keyboard("{ArrowUp}");
    expect(onEditLast).toHaveBeenCalledTimes(1);
    await user.type(input, "abc");
    await user.keyboard("{ArrowUp}");
    expect(onEditLast).toHaveBeenCalledTimes(1);
  });

  it("gửi thất bại thì giữ nguyên nội dung để thử lại", async () => {
    const onSend = vi.fn<(p: SendPayload) => Promise<void>>(async () => {
      throw new Error("mạng lỗi");
    });
    const user = userEvent.setup();
    render(wrap(<ComposerHarness onSend={onSend} />));
    const input = screen.getByTestId("composer-input");
    await user.type(input, "giữ lại{Enter}");
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(input).toHaveValue("giữ lại");
  });
});

function msg(over: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id: "m-1",
    channelId: "ch-1",
    kind: "text",
    content: "Nội dung",
    sender: { id: ANH, name: "Nguyễn Anh", image: null },
    replyTo: null,
    createdAt: new Date(2026, 5, 10, 9, 5).toISOString(),
    editedAt: null,
    recalledAt: null,
    pinned: false,
    mentions: [],
    reactions: [],
    attachments: [],
    refs: [],
    ...over,
  };
}

const noop = () => {};
const actions: MessageActions = {
  reply: noop,
  react: noop,
  edit: noop,
  recall: noop,
  remove: noop,
  pin: noop,
  toSource: noop,
  startSelect: noop,
  toggleSelect: noop,
  copy: noop,
  jumpTo: noop,
};

function renderMessage(m: MessageDTO, role: Role, handlers: Partial<MessageActions> = {}) {
  return render(
    wrap(
      <MessageItem
        message={m}
        notebookId="nb-1"
        meId={ME}
        myRole={role}
        showSender
        firstInGroup
        selectMode={false}
        selected={false}
        highlighted={false}
        readers={[]}
        nameOf={(id) => people.find((p) => p.id === id)?.name ?? "?"}
        actions={{ ...actions, ...handlers }}
      />,
    ),
  );
}

describe("MessageItem", () => {
  it("tin đã thu hồi: chỉ còn dấu thu hồi, không có nội dung/thanh công cụ", () => {
    renderMessage(msg({ content: "", recalledAt: new Date().toISOString() }), "editor");
    expect(screen.getByTestId("message-recalled")).toHaveTextContent("Tin nhắn đã được thu hồi");
    expect(screen.queryByTestId("message-toolbar")).toBeNull();
    expect(screen.queryByText("Nội dung")).toBeNull();
  });

  it("hiển thị 'đã sửa', giờ, tên người gửi và nút phản hồi gọi hành động", async () => {
    const reply = vi.fn();
    const m = msg({ editedAt: new Date().toISOString() });
    renderMessage(m, "viewer", { reply });
    expect(screen.getByText("đã sửa")).toBeInTheDocument();
    expect(screen.getByText("Nguyễn Anh", { selector: "span.truncate" })).toBeInTheDocument();
    expect(screen.getByText("09:05")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Trả lời" }));
    expect(reply).toHaveBeenCalledWith(m);
  });

  it("phân quyền hành động: viewer không thấy Ghim/Chuyển vào Nguồn/Tạo note; chủ tin thấy Sửa & Thu hồi", async () => {
    const user = userEvent.setup();
    const withFile = msg({ attachments: [{ id: "a1", fileId: "f1", name: "tài liệu.pdf", mime: "application/pdf", size: 2048 }] });
    const { unmount } = renderMessage(withFile, "viewer");
    await user.click(screen.getByRole("button", { name: "Thêm hành động" }));
    expect(await screen.findByRole("menuitem", { name: /Sao chép/ })).toBeInTheDocument();
    for (const hidden of [/Ghim tin nhắn/, /Chuyển vào Nguồn/, /Tạo note/, /Sửa/, /Thu hồi/, /Xoá/]) {
      expect(screen.queryByRole("menuitem", { name: hidden })).toBeNull();
    }
    // thẻ tệp không có nút "Chuyển vào Nguồn" cho viewer
    expect(screen.queryByRole("button", { name: "Chuyển vào Nguồn" })).toBeNull();
    unmount();

    renderMessage(msg({ sender: { id: ME, name: "Tôi", image: null }, attachments: withFile.attachments }), "editor");
    await user.click(screen.getByRole("button", { name: "Thêm hành động" }));
    for (const shown of [/Sửa/, /Ghim tin nhắn/, /Chuyển vào Nguồn/, /Tạo note/, /Thu hồi/, /Xoá/]) {
      expect(await screen.findByRole("menuitem", { name: shown })).toBeInTheDocument();
    }
  });

  it("admin xoá được tin người khác nhưng không thu hồi/sửa", async () => {
    const user = userEvent.setup();
    renderMessage(msg(), "admin");
    await user.click(screen.getByRole("button", { name: "Thêm hành động" }));
    expect(await screen.findByRole("menuitem", { name: /Xoá/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Thu hồi/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Sửa/ })).toBeNull();
  });

  it("thẻ tham chiếu liên kết đúng; reaction của mình được đánh dấu và bấm để bật/tắt", async () => {
    const react = vi.fn();
    const m = msg({
      kind: "artifact_ref",
      content: "",
      refs: [{ type: "artifact", id: "art-1", title: "Slide chương 1", subtype: "slide_deck", available: true }],
      reactions: [
        { emoji: "👍", count: 2, userIds: [ME, ANH] },
        { emoji: "🔥", count: 1, userIds: [ANH] },
      ],
    });
    renderMessage(m, "editor", { react });
    const card = screen.getByTestId("ref-card");
    expect(card).toHaveTextContent("Slide chương 1");
    expect(card).toHaveTextContent("Bài thuyết trình");
    expect(screen.getByRole("link", { name: /Slide chương 1/ })).toHaveAttribute("href", "/n/nb-1/artifacts/art-1");
    const mine = screen.getByRole("button", { name: /👍/ });
    expect(mine).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /🔥/ })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(mine);
    expect(react).toHaveBeenCalledWith(m, "👍");
  });

  it("thẻ tham chiếu không còn truy cập: không có liên kết", () => {
    renderMessage(
      msg({ kind: "source_ref", content: "", refs: [{ type: "source", id: "s1", title: "Nguồn cũ", subtype: "file", available: false }] }),
      "editor",
    );
    expect(screen.getByTestId("ref-card")).toHaveTextContent("không còn truy cập được");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("trích dẫn trả lời bấm được để nhảy tới tin gốc; tin gốc đã mất thì không bấm được", async () => {
    const jumpTo = vi.fn();
    const { unmount } = renderMessage(
      msg({ replyTo: { id: "orig", senderId: BINH, senderName: "Trần Bình", snippet: "Câu hỏi gốc", unavailable: false } }),
      "editor",
      { jumpTo },
    );
    await userEvent.click(screen.getByTestId("reply-quote"));
    expect(jumpTo).toHaveBeenCalledWith("orig");
    unmount();
    renderMessage(msg({ replyTo: { id: "orig", senderId: null, senderName: null, snippet: "", unavailable: true } }), "editor", { jumpTo });
    await userEvent.click(screen.getByTestId("reply-quote"));
    expect(jumpTo).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Tin nhắn gốc không còn")).toBeInTheDocument();
  });
});

describe("RichText", () => {
  it("render định dạng, mention nổi bật và KHÔNG chèn HTML thô", () => {
    const { container } = render(
      <RichText content={`**đậm** @[Tôi](${ME}) @[Anh](${ANH}) <img src=x onerror=alert(1)> https://example.com`} meId={ME} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("đậm");
    const mentions = container.querySelectorAll("[data-mention]");
    expect(mentions).toHaveLength(2);
    expect(mentions[0].className).toContain("amber"); // nhắc đến chính mình nổi bật hơn
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });
});

describe("ShareToChatDialog", () => {
  const channels: ChannelDTO[] = [
    { id: "dm-1", notebookId: "nb-1", type: "dm", name: null, createdBy: ME, createdAt: "2026-06-10T00:00:00Z", unread: 0, muted: false, lastReadAt: null, lastMessage: null, lastActivityAt: "2026-06-10T00:00:00Z", members: [{ id: ME, name: "Tôi", image: null }, { id: ANH, name: "Nguyễn Anh", image: null }] },
    { id: "topic-1", notebookId: "nb-1", type: "topic", name: "Chương 3", createdBy: ME, createdAt: "2026-06-10T00:00:00Z", unread: 0, muted: false, lastReadAt: null, lastMessage: null, lastActivityAt: "2026-06-10T00:00:00Z", members: [] },
    { id: "gen-1", notebookId: "nb-1", type: "general", name: "general", createdBy: ME, createdAt: "2026-06-10T00:00:00Z", unread: 0, muted: false, lastReadAt: null, lastMessage: null, lastActivityAt: "2026-06-10T00:00:00Z", members: [] },
  ];
  const calls: { url: string; init?: RequestInit }[] = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "POST") return new Response(JSON.stringify({ message: { id: "new" } }), { status: 201 });
        return new Response(JSON.stringify({ channels }), { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function Host({ onShared }: { onShared?: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <ShareToChatDialog
        open={open}
        onOpenChange={setOpen}
        notebookId="nb-1"
        item={{ type: "source", id: "src-1", title: "Giáo trình" }}
        onShared={onShared}
      />
    );
  }

  it("liệt kê kênh (general chọn sẵn), gửi thẻ nguồn vào kênh được chọn kèm lời nhắn", async () => {
    const onShared = vi.fn();
    const user = userEvent.setup();
    render(wrap(<Host onShared={onShared} />));
    const radios = await screen.findAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveTextContent("General");
    expect(radios[1]).toHaveTextContent("Chương 3");
    expect(radios[2]).toHaveTextContent("Nguyễn Anh"); // DM hiển thị tên người còn lại
    expect(radios[0]).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: "Chương 3" }));
    await user.type(screen.getByPlaceholderText("Lời nhắn kèm theo (tuỳ chọn)"), "xem giúp mình");
    await user.click(screen.getByRole("button", { name: "Chia sẻ" }));

    await waitFor(() => expect(onShared).toHaveBeenCalled());
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.url).toBe("/api/channels/topic-1/messages");
    expect(JSON.parse(String(post.init!.body))).toEqual({
      kind: "source_ref",
      content: "xem giúp mình",
      refs: { sourceId: "src-1" },
    });
  });

  it("lỗi tải kênh hiển thị thông báo thay vì danh sách", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "forbidden", message: "Không có quyền" } }), { status: 403 })));
    render(wrap(<Host />));
    expect(await screen.findByText("Không có quyền")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chia sẻ" })).toBeDisabled();
  });
});
