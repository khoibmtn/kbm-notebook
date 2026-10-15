import { describe, expect, it } from "vitest";
import { isValidReactionEmoji, COMMON_EMOJI } from "@/lib/team-chat/emoji";
import { formatBytes, isInlineImage, dayLabel } from "@/lib/team-chat/format";
import { dayKey, groupMessages, upsertMessage, GROUP_GAP_MS } from "@/lib/team-chat/grouping";
import { parseInline, parseMarkdownLite } from "@/lib/team-chat/markdown";
import {
  decodeMentions,
  detectMentionQuery,
  encodeMentions,
  filterMentionCandidates,
  parseMentionIds,
  plainText,
  splitMentions,
} from "@/lib/team-chat/mentions";
import { formatTranscript } from "@/server/team-chat/notes";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("mentions", () => {
  it("parseMentionIds: lấy id duy nhất theo thứ tự, chuẩn hoá chữ thường, bỏ token sai", () => {
    const text = `Chào @[An](${A}) và @[Bình](${B.toUpperCase()}) và lại @[An](${A}) @[Lỗi](not-a-uuid) @[](${A})`;
    expect(parseMentionIds(text)).toEqual([A, B]);
    expect(parseMentionIds("không có mention @An")).toEqual([]);
  });

  it("plainText thay token bằng @Tên", () => {
    expect(plainText(`Xem giúp @[Nguyễn An](${A}) nhé`)).toBe("Xem giúp @Nguyễn An nhé");
  });

  it("splitMentions tách đoạn text/mention", () => {
    expect(splitMentions(`a @[An](${A}) b`)).toEqual([
      { type: "text", text: "a " },
      { type: "mention", id: A, name: "An" },
      { type: "text", text: " b" },
    ]);
    expect(splitMentions("trơn")).toEqual([{ type: "text", text: "trơn" }]);
  });

  it("encodeMentions: chỉ thay @Tên đã chọn, đứng riêng, ưu tiên tên dài", () => {
    const picked = [
      { id: A, name: "Nguyễn Văn" },
      { id: B, name: "Nguyễn Văn An" },
    ];
    expect(encodeMentions("@Nguyễn Văn An ơi, @Nguyễn Văn nữa", picked)).toBe(`@[Nguyễn Văn An](${B}) ơi, @[Nguyễn Văn](${A}) nữa`);
    // không thay khi dính chữ phía sau hoặc phía trước
    expect(encodeMentions("@Nguyễn Vănx và email@Nguyễn Văn", [{ id: A, name: "Nguyễn Văn" }])).toBe("@Nguyễn Vănx và email@Nguyễn Văn");
    expect(encodeMentions("không chọn ai", [])).toBe("không chọn ai");
  });

  it("decodeMentions là nghịch đảo của encodeMentions", () => {
    const picked = [{ id: A, name: "An Nguyễn" }];
    const encoded = encodeMentions("hỏi @An Nguyễn giúp", picked);
    const decoded = decodeMentions(encoded);
    expect(decoded.text).toBe("hỏi @An Nguyễn giúp");
    expect(decoded.picked).toEqual(picked);
  });

  it("detectMentionQuery: nhận ở đầu/sau khoảng trắng; không nhận trong email hoặc khi đã kết thúc", () => {
    expect(detectMentionQuery("@an", 3)).toEqual({ start: 0, query: "an" });
    expect(detectMentionQuery("chào @bi", 8)).toEqual({ start: 5, query: "bi" });
    expect(detectMentionQuery("chào @", 6)).toEqual({ start: 5, query: "" });
    expect(detectMentionQuery("a@b.com", 7)).toBeNull();
    expect(detectMentionQuery("chào @bi\nxuống dòng", 19)).toBeNull();
    expect(detectMentionQuery("không có", 3)).toBeNull();
    // con trỏ nằm trước @ thì không có truy vấn
    expect(detectMentionQuery("@an", 0)).toBeNull();
  });

  it("filterMentionCandidates: không phân biệt dấu/hoa thường, ưu tiên khớp đầu", () => {
    const members = [{ name: "Trần Bình" }, { name: "Nguyễn Đức An" }, { name: "Lê Anh" }, { name: "Hoàng Ánh" }];
    expect(filterMentionCandidates(members, "binh").map((m) => m.name)).toEqual(["Trần Bình"]);
    expect(filterMentionCandidates(members, "duc").map((m) => m.name)).toEqual(["Nguyễn Đức An"]);
    // "an": khớp đầu từ (Ánh, Anh, An) xếp trước, khớp giữa chữ (Trần) xếp sau; cùng điểm thì theo tên
    expect(filterMentionCandidates(members, "an").map((m) => m.name)).toEqual(["Hoàng Ánh", "Lê Anh", "Nguyễn Đức An", "Trần Bình"]);
    expect(filterMentionCandidates(members, "").length).toBe(4);
    expect(filterMentionCandidates(members, "zzz")).toEqual([]);
    expect(filterMentionCandidates(members, "", 2)).toHaveLength(2);
  });
});

describe("groupMessages", () => {
  const msg = (id: string, sender: string, iso: string, kind = "text") => ({ id, sender: { id: sender }, createdAt: iso, kind });
  const t0 = new Date(2026, 5, 10, 9, 0, 0).getTime();
  const at = (minutes: number) => new Date(t0 + minutes * 60_000).toISOString();

  it("gộp tin liên tiếp cùng người gửi trong 5 phút; tách khi quá 5 phút hoặc đổi người", () => {
    const items = groupMessages([
      msg("1", "a", at(0)),
      msg("2", "a", at(4)),
      msg("3", "a", new Date(t0 + 4 * 60_000 + GROUP_GAP_MS + 1000).toISOString()),
      msg("4", "b", at(11)),
      msg("5", "a", at(12)),
    ]);
    const groups = items.filter((i) => i.type === "group");
    expect(groups.map((g) => (g.type === "group" ? g.messages.map((m) => m.id) : []))).toEqual([["1", "2"], ["3"], ["4"], ["5"]]);
  });

  it("đúng 5 phút vẫn gộp (ranh giới)", () => {
    const items = groupMessages([msg("1", "a", at(0)), msg("2", "a", at(5))]);
    expect(items.filter((i) => i.type === "group")).toHaveLength(1);
  });

  it("chèn dải ngày khi đổi ngày và ngắt nhóm", () => {
    const next = new Date(2026, 5, 11, 9, 1, 0).toISOString();
    const items = groupMessages([msg("1", "a", at(0)), msg("2", "a", next)]);
    expect(items.map((i) => i.type)).toEqual(["day", "group", "day", "group"]);
    expect(dayKey(next)).toBe("2026-06-11");
  });

  it("chèn dải 'tin nhắn mới' trước đúng tin và ngắt nhóm tại đó", () => {
    const items = groupMessages([msg("1", "a", at(0)), msg("2", "a", at(1)), msg("3", "a", at(2))], { dividerBeforeId: "2" });
    expect(items.map((i) => i.type)).toEqual(["day", "group", "divider", "group"]);
    const g = items.filter((i) => i.type === "group");
    expect(g.map((x) => (x.type === "group" ? x.messages.length : 0))).toEqual([1, 2]);
  });

  it("tin hệ thống luôn tách nhóm; danh sách rỗng → []", () => {
    const items = groupMessages([msg("1", "a", at(0)), msg("2", "a", at(1), "system"), msg("3", "a", at(2))]);
    expect(items.filter((i) => i.type === "group")).toHaveLength(3);
    expect(groupMessages([])).toEqual([]);
  });

  it("upsertMessage: thêm đúng vị trí theo thời gian, thay thế theo id", () => {
    const base = [msg("1", "a", at(0)), msg("3", "a", at(10))];
    const inserted = upsertMessage(base, msg("2", "b", at(5)));
    expect(inserted.map((m) => m.id)).toEqual(["1", "2", "3"]);
    const replaced = upsertMessage(inserted, { ...msg("2", "b", at(5)), kind: "file" });
    expect(replaced).toHaveLength(3);
    expect(replaced[1].kind).toBe("file");
    expect(upsertMessage(base, msg("4", "a", at(20))).map((m) => m.id)).toEqual(["1", "3", "4"]);
  });
});

describe("markdown-lite", () => {
  it("định dạng cơ bản: đậm, nghiêng, gạch, mã, liên kết", () => {
    const nodes = parseInline("**đậm** *nghiêng* ~~gạch~~ `mã` https://example.com/a?b=1.");
    expect(nodes).toEqual([
      { type: "bold", children: [{ type: "text", text: "đậm" }] },
      { type: "text", text: " " },
      { type: "italic", children: [{ type: "text", text: "nghiêng" }] },
      { type: "text", text: " " },
      { type: "strike", children: [{ type: "text", text: "gạch" }] },
      { type: "text", text: " " },
      { type: "code", text: "mã" },
      { type: "text", text: " " },
      { type: "link", href: "https://example.com/a?b=1", text: "https://example.com/a?b=1" },
      { type: "text", text: "." },
    ]);
  });

  it("không biến snake_case hay dấu * lẻ thành định dạng; chỉ nhận http(s)", () => {
    expect(parseInline("file_name_here 2 * 3")).toEqual([{ type: "text", text: "file_name_here 2 * 3" }]);
    const js = parseInline("javascript:alert(1) <script>x</script>");
    expect(js.every((n) => n.type === "text")).toBe(true);
  });

  it("mention nằm trong nội dung được nhận diện", () => {
    expect(parseInline(`chào @[An](${A})!`)).toEqual([
      { type: "text", text: "chào " },
      { type: "mention", id: A, name: "An" },
      { type: "text", text: "!" },
    ]);
  });

  it("khối mã, trích dẫn và xuống dòng", () => {
    const blocks = parseMarkdownLite("dòng 1\ndòng 2\n> trích dẫn\n```\ncode **không đậm**\n```\nkết");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "quote", "codeblock", "paragraph"]);
    expect(blocks[0]).toMatchObject({ children: [{ type: "text", text: "dòng 1" }, { type: "br" }, { type: "text", text: "dòng 2" }] });
    expect(blocks[2]).toEqual({ type: "codeblock", text: "code **không đậm**" });
  });
});

describe("emoji & định dạng", () => {
  it("bộ picker có 24 emoji hợp lệ", () => {
    expect(COMMON_EMOJI).toHaveLength(24);
    for (const e of COMMON_EMOJI) expect(isValidReactionEmoji(e)).toBe(true);
  });

  it("isValidReactionEmoji từ chối chữ, số, chuỗi rỗng/dài", () => {
    for (const bad of ["", "abc", "1", "👍a", "x".repeat(40), "hello 👍"]) expect(isValidReactionEmoji(bad)).toBe(false);
    for (const ok of ["👍", "❤️", "👨‍👩‍👧", "🇻🇳", "1️⃣"]) expect(isValidReactionEmoji(ok)).toBe(true);
  });

  it("formatBytes / isInlineImage / dayLabel", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(isInlineImage("image/png")).toBe(true);
    expect(isInlineImage("image/svg+xml")).toBe(false);
    expect(isInlineImage("application/pdf")).toBe(false);
    const labels = { today: "Hôm nay", yesterday: "Hôm qua" };
    const now = new Date(2026, 5, 10, 12, 0, 0);
    expect(dayLabel(new Date(2026, 5, 10, 1).toISOString(), labels, "vi-VN", now)).toBe("Hôm nay");
    expect(dayLabel(new Date(2026, 5, 9, 23).toISOString(), labels, "vi-VN", now)).toBe("Hôm qua");
    expect(dayLabel(new Date(2026, 5, 1, 9).toISOString(), labels, "vi-VN", now)).toContain("2026");
  });
});

describe("formatTranscript", () => {
  it("**Tên** (hh:mm): nội dung theo giờ Việt Nam; gộp tệp/thẻ; bỏ tin rỗng; mention thành @Tên", () => {
    const text = formatTranscript(
      [
        { senderName: "An", createdAt: new Date("2026-06-10T02:05:00Z"), content: `Chào @[Bình](${B})`, attachmentNames: [], refTitles: [] },
        { senderName: "Bình", createdAt: new Date("2026-06-10T02:06:00Z"), content: "", attachmentNames: ["bảng.xlsx"], refTitles: ["Slide 1"] },
        { senderName: "Lặng", createdAt: new Date("2026-06-10T02:07:00Z"), content: "   ", attachmentNames: [], refTitles: [] },
      ],
      "Asia/Ho_Chi_Minh",
    );
    expect(text).toBe("**An** (09:05): Chào @Bình\n\n**Bình** (09:06): 📎 bảng.xlsx\n🔗 Slide 1");
  });
});
