import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "@/components/shared/markdown-editor";
import { MarkdownView } from "@/components/shared/markdown-view";
import { ArtifactBody } from "@/components/studio/artifact-body";
import { CitationChip } from "@/components/studio/citation-chip";
import { CustomizeDialog } from "@/components/studio/customize-dialog";
import { DataTableView } from "@/components/studio/data-table-view";
import { FlashcardsView } from "@/components/studio/flashcards-view";
import { QuizView } from "@/components/studio/quiz-view";
import { ShareDialog } from "@/components/studio/share-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ArtifactEvidence, DataTableContent, FlashcardsContent, QuizContent } from "@/lib/artifacts/content";

const evidence: ArtifactEvidence[] = [
  { id: "c1", provider: "local", sourceId: "s1", sourceTitle: "Giáo trình sinh học", locator: { page: 12 }, text: "Ty thể tạo ra ATP trong hô hấp tế bào.", score: 1 },
  { id: "c2", provider: "local", sourceId: "s2", sourceTitle: "Bài giảng", locator: { slide: 3 }, text: "Ribosome tổng hợp protein.", score: 0.5 },
];

function wrap(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const apiMock = vi.hoisted(() => ({ api: vi.fn(), errorMessage: (e: unknown, f = "") => (e instanceof Error ? e.message : f) }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...mod, api: apiMock.api };
});

beforeEach(() => {
  apiMock.api.mockReset();
  localStorage.clear();
});

describe("MarkdownView", () => {
  it("render tiêu đề, danh sách, bảng, chip trích dẫn; không bao giờ chèn HTML thô hoặc liên kết javascript:", () => {
    const md = "# Tiêu đề\n\nĐoạn có trích dẫn [1][2] và **đậm**.\n\n- mục A\n- mục B\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[xấu](javascript:alert(1)) và [tốt](https://example.com)";
    const { container } = wrap(
      <MarkdownView markdown={md} renderCitation={(n) => <CitationChip n={n} evidence={evidence} notebookId="nb1" />} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Tiêu đề" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("đậm").tagName).toBe("STRONG");
    // chip [1] là liên kết tới Source viewer đúng đoạn, [2] dùng slide
    const chip1 = screen.getByTestId("citation-1");
    expect(chip1.getAttribute("href")).toContain("/n/nb1/sources/s1?chunk=c1&page=12");
    expect(screen.getByTestId("citation-2").getAttribute("href")).toContain("page=3");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull(); // chỉ còn là văn bản thường, không phải liên kết
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(screen.getByRole("link", { name: "tốt" }).getAttribute("rel")).toContain("noopener");
  });

  it("chip không có bằng chứng tương ứng hiển thị mờ, không phải liên kết; không có notebookId thì không liên kết", () => {
    wrap(
      <>
        <CitationChip n={9} evidence={evidence} notebookId="nb1" />
        <CitationChip n={1} evidence={evidence} />
      </>,
    );
    expect(screen.getByText("9").tagName).toBe("SPAN");
    expect(screen.getByText("9").closest("a")).toBeNull();
    expect(screen.getByTestId("citation-1").tagName).toBe("SPAN");
  });
});

describe("MarkdownEditor (Tiptap)", () => {
  it("nạp Markdown thành tiêu đề/danh sách thật; readOnly ẩn thanh công cụ", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<MarkdownEditor value={"# Xin chào\n\n- một\n- hai"} onChange={onChange} ariaLabel="Soạn" />);
    const content = await screen.findByTestId("markdown-editor-content");
    await waitFor(() => expect(within(content).getByRole("heading", { level: 1, name: "Xin chào" })).toBeInTheDocument());
    expect(within(content).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In đậm" })).toBeInTheDocument();
    rerender(<MarkdownEditor value={"# Xin chào\n\n- một\n- hai"} onChange={onChange} readOnly />);
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
    expect(onChange).not.toHaveBeenCalled(); // nạp giá trị không phát onChange
  });

  it("giá trị bên ngoài đổi (khôi phục phiên bản) được nạp lại vào editor", async () => {
    const { rerender } = render(<MarkdownEditor value="Bản một" onChange={() => undefined} />);
    const content = await screen.findByTestId("markdown-editor-content");
    await waitFor(() => expect(content).toHaveTextContent("Bản một"));
    rerender(<MarkdownEditor value="Bản hai khôi phục" onChange={() => undefined} />);
    await waitFor(() => expect(content).toHaveTextContent("Bản hai khôi phục"));
  });
});

const quiz: QuizContent = {
  questions: [
    { id: "q1", type: "mcq", stem: "Bào quan nào tạo ATP?", options: [{ key: "A", text: "Ty thể" }, { key: "B", text: "Nhân" }], answer: "A", explanation: "Hô hấp tế bào [1]", citations: [1], difficulty: "easy" },
    { id: "q2", type: "tf", stem: "Quang hợp ở ty thể.", answer: "false", explanation: "Ở lục lạp", difficulty: "medium" },
    { id: "q3", type: "short", stem: "Ribosome làm gì?", answer: "Tổng hợp protein", explanation: "", difficulty: "hard" },
  ],
  evidence,
};

describe("QuizView", () => {
  it("chơi: chọn đáp án → kiểm tra → giải thích + chip → tính điểm cuối, câu trả lời ngắn tự chấm", async () => {
    const user = userEvent.setup();
    wrap(<QuizView content={quiz} readOnly notebookId="nb1" />);
    expect(screen.getByTestId("quiz-progress")).toHaveTextContent("Câu 1/3");
    expect(screen.getByTestId("quiz-check")).toBeDisabled(); // chưa chọn đáp án
    await user.click(screen.getByTestId("quiz-option-A"));
    await user.click(screen.getByTestId("quiz-check"));
    const exp = screen.getByTestId("quiz-explanation");
    expect(exp).toHaveTextContent("Chính xác");
    expect(within(exp).getByTestId("citation-1")).toBeInTheDocument();
    await user.click(screen.getByTestId("quiz-next"));

    // câu đúng/sai: chọn sai ("Đúng") → báo chưa đúng
    await user.click(screen.getByTestId("quiz-option-true"));
    await user.click(screen.getByTestId("quiz-check"));
    expect(screen.getByTestId("quiz-explanation")).toHaveTextContent("Chưa đúng");
    await user.click(screen.getByTestId("quiz-next"));

    // câu trả lời ngắn: gõ, hiện đáp án mẫu, tự chấm đúng
    await user.type(screen.getByRole("textbox"), "tổng hợp đạm");
    await user.click(screen.getByTestId("quiz-check"));
    expect(screen.getByTestId("quiz-explanation")).toHaveTextContent("Tổng hợp protein");
    await user.click(screen.getByRole("button", { name: "Tôi làm đúng" }));
    await user.click(screen.getByTestId("quiz-finish"));

    expect(screen.getByTestId("quiz-score")).toHaveTextContent("2/3");
    expect(screen.getByText("Các câu cần ôn lại")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Làm lại" }));
    expect(screen.getByTestId("quiz-player")).toBeInTheDocument();
    expect(screen.getByTestId("quiz-progress")).toHaveTextContent("Câu 1/3");
  });

  it("người xem (readOnly) không có tab chỉnh sửa", () => {
    wrap(<QuizView content={quiz} readOnly />);
    expect(screen.queryByTestId("quiz-mode-edit")).toBeNull();
  });

  it("chỉnh sửa: sửa câu hỏi, đổi đáp án đúng, thêm/xoá lựa chọn và câu hỏi → onChange nhận nội dung đúng schema", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    wrap(<QuizView content={quiz} onChange={onChange} />);
    await user.click(screen.getByTestId("quiz-mode-edit"));
    const editors = screen.getAllByTestId("quiz-question-editor");
    expect(editors).toHaveLength(3);

    await user.type(within(editors[0]).getByTestId("quiz-stem-input"), "!");
    expect((onChange.mock.calls.at(-1)![0] as QuizContent).questions[0].stem).toBe("Bào quan nào tạo ATP?!");

    await user.click(within(editors[0]).getByLabelText("Đặt lựa chọn B là đáp án đúng"));
    expect((onChange.mock.calls.at(-1)![0] as QuizContent).questions[0].answer).toBe("B");

    await user.click(within(editors[0]).getByRole("button", { name: "Thêm lựa chọn" }));
    const withThree = onChange.mock.calls.at(-1)![0] as QuizContent;
    expect(withThree.questions[0].options?.map((o) => o.key)).toEqual(["A", "B", "C"]);

    await user.click(screen.getByTestId("quiz-add-question"));
    const added = onChange.mock.calls.at(-1)![0] as QuizContent;
    expect(added.questions).toHaveLength(4);
    expect(added.questions[3].type).toBe("mcq");

    await user.click(within(editors[1]).getByRole("button", { name: "Xoá câu hỏi" }));
    expect((onChange.mock.calls.at(-1)![0] as QuizContent).questions.map((q) => q.id)).toEqual(["q1", "q3"]);
  });
});

const cards: FlashcardsContent = {
  cards: [
    { id: "c1", front: "Ty thể?", back: "Tạo ATP", citations: [1] },
    { id: "c2", front: "Ribosome?", back: "Tổng hợp protein", hint: "protein" },
    { id: "c3", front: "Nhân?", back: "Chứa DNA" },
  ],
  evidence,
};

describe("FlashcardsView", () => {
  it("lật thẻ, trước/sau, đánh dấu đã thuộc và lưu vào localStorage (còn sau khi dựng lại)", async () => {
    const user = userEvent.setup();
    const { unmount } = wrap(<FlashcardsView artifactId="art-1" content={cards} readOnly />);
    const card = screen.getByTestId("flashcard");
    expect(card).toHaveAttribute("data-side", "front");
    expect(screen.getByTestId("flashcard-text")).toHaveTextContent("Ty thể?");
    await user.click(card);
    expect(card).toHaveAttribute("data-side", "back");
    expect(screen.getByTestId("flashcard-text")).toHaveTextContent("Tạo ATP");

    await user.click(screen.getByTestId("flashcard-known"));
    expect(screen.getByTestId("flashcards-known")).toHaveTextContent("Đã thuộc 1/3");
    expect(JSON.parse(localStorage.getItem("kbm:flashcards:known:art-1")!)).toEqual(["c1"]);

    await user.click(screen.getByTestId("flashcard-next"));
    expect(screen.getByTestId("flashcards-position")).toHaveTextContent("Thẻ 2/3");
    expect(screen.getByTestId("flashcard")).toHaveAttribute("data-side", "front"); // sang thẻ mới luôn bắt đầu mặt trước

    unmount();
    wrap(<FlashcardsView artifactId="art-1" content={cards} readOnly />);
    expect(screen.getByTestId("flashcards-known")).toHaveTextContent("Đã thuộc 1/3");
    // bộ thẻ khác không dùng chung tiến độ
    unmount();
  });

  it("xáo trộn giữ nguyên số thẻ; 'chỉ thẻ chưa thuộc' lọc đúng; bàn phím ← → Space", async () => {
    const user = userEvent.setup();
    localStorage.setItem("kbm:flashcards:known:art-2", JSON.stringify(["c1", "c3"]));
    wrap(<FlashcardsView artifactId="art-2" content={cards} readOnly />);
    await user.click(screen.getByTestId("flashcards-shuffle"));
    expect(screen.getByTestId("flashcards-position")).toHaveTextContent("/3");
    await user.click(screen.getByRole("button", { name: "Chỉ thẻ chưa thuộc" }));
    expect(screen.getByTestId("flashcards-position")).toHaveTextContent("Thẻ 1/1");
    expect(screen.getByTestId("flashcard-text")).toHaveTextContent("Ribosome?");
    (document.activeElement as HTMLElement).blur(); // Space trên nút đang focus sẽ kích hoạt nút đó (đúng chuẩn truy cập)
    await user.keyboard(" ");
    expect(screen.getByTestId("flashcard")).toHaveAttribute("data-side", "back");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("flashcard")).toHaveAttribute("data-side", "front");
  });

  it("chỉnh sửa: thêm/xoá thẻ và sửa nội dung → onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    wrap(<FlashcardsView artifactId="art-3" content={cards} onChange={onChange} />);
    await user.click(screen.getByTestId("flashcards-mode-edit"));
    expect(screen.getAllByTestId("flashcard-editor-row")).toHaveLength(3);
    await user.click(screen.getByTestId("flashcards-add"));
    expect((onChange.mock.calls.at(-1)![0] as FlashcardsContent).cards).toHaveLength(4);
    await user.click(within(screen.getAllByTestId("flashcard-editor-row")[0]).getByRole("button", { name: "Xoá thẻ" }));
    expect((onChange.mock.calls.at(-1)![0] as FlashcardsContent).cards.map((c) => c.id)).toEqual(["c2", "c3"]);
  });
});

describe("DataTableView", () => {
  const table: DataTableContent = {
    columns: [{ key: "ten", label: "Tên" }, { key: "chuc_nang", label: "Chức năng" }],
    rows: [{ cells: { ten: "Ty thể", chuc_nang: "ATP" }, citations: [1] }],
    evidence,
  };

  it("thêm dòng/cột (khoá cột duy nhất), sửa ô, xoá cột kéo theo xoá ô; người xem chỉ đọc", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = wrap(<DataTableView content={table} onChange={onChange} />);
    await user.click(screen.getByTestId("table-add-row"));
    expect((onChange.mock.calls.at(-1)![0] as DataTableContent).rows).toHaveLength(2);
    expect((onChange.mock.calls.at(-1)![0] as DataTableContent).rows[1].cells).toEqual({ ten: "", chuc_nang: "" });

    await user.click(screen.getByTestId("table-add-column"));
    const withCol = onChange.mock.calls.at(-1)![0] as DataTableContent;
    expect(withCol.columns.map((c) => c.key)).toEqual(["ten", "chuc_nang", "cot_3"]);
    expect(withCol.rows[0].cells.cot_3).toBe("");

    await user.type(screen.getByLabelText("Tên 1"), "!");
    expect((onChange.mock.calls.at(-1)![0] as DataTableContent).rows[0].cells.ten).toBe("Ty thể!");

    await user.click(screen.getByRole("button", { name: "Xoá cột Chức năng" }));
    const removed = onChange.mock.calls.at(-1)![0] as DataTableContent;
    expect(removed.columns.map((c) => c.key)).toEqual(["ten"]);
    expect(removed.rows[0].cells).toEqual({ ten: "Ty thể" });
    unmount();

    wrap(<DataTableView content={table} readOnly />);
    expect(screen.queryByTestId("table-add-row")).toBeNull();
    expect(screen.getByText("Ty thể")).toBeInTheDocument();
  });
});

describe("ArtifactBody: slide_deck/infographic", () => {
  it("chưa có engine → thông báo rõ ràng, không dựng nội dung giả", () => {
    wrap(<ArtifactBody artifactId="a" type="slide_deck" content={{ theme: { palette: "x", font: "y" }, slides: [{ id: "s1" }], evidence: [] }} />);
    expect(screen.getByText("Chưa có engine")).toBeInTheDocument();
    expect(screen.getByText(/chưa được tích hợp/)).toBeInTheDocument();
  });
});

describe("ShareDialog", () => {
  it("public bị khoá với người không phải chủ sổ tay; link hiển thị URL /s/token; đổi chế độ gọi API", async () => {
    const user = userEvent.setup();
    apiMock.api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
      if (path.endsWith("/shares")) return { shares: [{ id: "sh1", artifactId: "a1", userId: "u2", email: "nguoi@x.com", name: "Người Hai", role: "view", createdAt: "2026-01-01" }] };
      if (path.endsWith("/share")) return { artifact: { id: "a1", title: "T", visibility: (init!.json as { visibility: string }).visibility, shareToken: "tok-tok-tok-tok-tok-tok", canManage: true } };
      return {};
    });
    const onChanged = vi.fn();
    wrap(
      <ShareDialog
        open
        onOpenChange={() => undefined}
        artifact={{ id: "a1", title: "T", visibility: "link", shareToken: "tok-tok-tok-tok-tok-tok", canManage: true }}
        isNotebookOwner={false}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByTestId("visibility-public")).toBeDisabled();
    expect(screen.getByText("Chỉ chủ sở hữu sổ tay được chia sẻ công khai.")).toBeInTheDocument();
    expect((screen.getByTestId("share-link") as HTMLInputElement).value).toMatch(/\/s\/tok-tok-tok-tok-tok-tok$/);
    await waitFor(() => expect(screen.getByTestId("share-people")).toHaveTextContent("nguoi@x.com"));

    await user.click(screen.getByTestId("visibility-private"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(apiMock.api).toHaveBeenCalledWith("/api/artifacts/a1/share", expect.objectContaining({ method: "PATCH", json: { visibility: "private", rotateToken: false } }));
  });

  it("người chỉ xem không đổi được chia sẻ", () => {
    wrap(
      <ShareDialog open onOpenChange={() => undefined} artifact={{ id: "a1", title: "T", visibility: "notebook", shareToken: null, canManage: false }} isNotebookOwner={false} onChanged={() => undefined} />,
    );
    expect(screen.getByText(/chỉ có quyền xem/)).toBeInTheDocument();
    expect(screen.queryByText("Chia sẻ riêng cho từng người")).toBeNull();
    expect(screen.getByTestId("visibility-private").closest("fieldset")).toBeDisabled();
  });
});

describe("CustomizeDialog", () => {
  beforeEach(() => {
    apiMock.api.mockImplementation(async (path: string) => {
      if (path === "/api/settings/prompts") {
        return { effective: { quiz: { system: "SYSTEM QUIZ MẶC ĐỊNH", user: "Tạo bộ câu hỏi.\n{{instructions}}", options: { count: 12, difficulty: "trung bình" } }, slide_deck: { system: "SYS SLIDE", user: "Tạo slide", options: { slides: 12 } } } };
      }
      return { settings: { defaultArtifactModel: "model-a", fallbackModels: { chat: "model-c", artifact: "model-b" } } };
    });
  });

  it("hiển thị prompt hiệu lực (mở rộng được), tuỳ chọn theo loại, phạm vi và gửi đúng dữ liệu", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    wrap(<CustomizeDialog type="quiz" open onOpenChange={() => undefined} scopeCount={3} onSubmit={onSubmit} />);
    await user.click(screen.getByTestId("effective-prompt-toggle"));
    await waitFor(() => expect(screen.getByTestId("effective-prompt")).toHaveTextContent("SYSTEM QUIZ MẶC ĐỊNH"));
    expect(screen.getByTestId("customize-scope")).toHaveTextContent("3 nguồn");
    // số câu lấy từ prompt hiệu lực (12), độ khó enum mặc định
    await waitFor(() => expect((screen.getByLabelText("Số câu hỏi") as HTMLInputElement).value).toBe("12"));

    await user.type(screen.getByTestId("custom-prompt"), "Tập trung ty thể");
    await user.clear(screen.getByLabelText("Số câu hỏi"));
    await user.type(screen.getByLabelText("Số câu hỏi"), "7");
    await user.selectOptions(screen.getByLabelText("Độ khó"), "hard");
    await user.click(screen.getByRole("checkbox", { name: "Đúng/Sai" }));
    await user.type(screen.getByLabelText("Model"), "model-x");
    await user.click(screen.getByTestId("customize-create"));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual({
      customPrompt: "Tập trung ty thể",
      options: { language: "Tiếng Việt", count: 7, difficulty: "hard", questionTypes: ["mcq", "tf"] },
      model: "model-x",
    });
  });

  it("slide_deck có số slide/phong cách/đối tượng/ảnh; nút Tạo bị khoá khi không có nguồn", async () => {
    wrap(<CustomizeDialog type="slide_deck" open onOpenChange={() => undefined} scopeCount={0} onSubmit={() => undefined} />);
    expect(screen.getByLabelText("Số slide")).toBeInTheDocument();
    expect(screen.getByLabelText("Phong cách")).toBeInTheDocument();
    expect(screen.getByLabelText("Đối tượng")).toBeInTheDocument();
    expect(screen.getByLabelText("Kèm hình minh hoạ")).toBeInTheDocument();
    expect(screen.getByTestId("customize-create")).toBeDisabled();
  });
});
