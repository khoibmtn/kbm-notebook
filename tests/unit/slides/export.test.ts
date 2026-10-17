import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { SlideView } from "../../../src/components/studio/slides/slide-view";
import { exportSlideDeckPptx } from "../../../src/server/artifacts/slides/export-pptx";
import { PX_PER_INCH, layoutSlide } from "../../../src/server/artifacts/slides/layouts";
import { renderSlideDeckHtml } from "../../../src/server/artifacts/slides/render-html";
import { buildSourceSlides } from "../../../src/server/artifacts/slides/sources";
import type { Slide } from "../../../src/server/artifacts/slides/types";
import { sampleDeck } from "./fixtures";

const hasSoffice = (() => {
  try {
    execFileSync("soffice", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const emu = (px: number) => Math.round((px / PX_PER_INCH) * 914400);

describe("PPTX", () => {
  it("round-trip: hộp chữ thật (<a:t>), bullet, bảng, biểu đồ native, notes, số trang, slide Nguồn", async () => {
    const deck = sampleDeck();
    const buf = await exportSlideDeckPptx(deck);
    const zip = await JSZip.loadAsync(buf);
    const sourceSlides = buildSourceSlides(deck).length;
    const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slideFiles).toHaveLength(deck.slides.length + sourceSlides);

    const xml1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml1).toContain("<a:t>Chuyển dịch năng lượng tái tạo</a:t>");

    // slide 2: title + bullet thật
    const xml2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(xml2).toContain("<a:t>Vì sao cần chuyển dịch?</a:t>");
    expect((xml2.match(/<a:buChar /g) ?? []).length).toBe(4);
    expect(xml2).toContain("<a:t>Nhu cầu điện tăng nhanh theo tăng trưởng</a:t>");
    expect(xml2).toContain('type="slidenum"'); // số trang là trường gốc

    // chart native (slide 4 = bar, 7 = line, 9 = pie)
    const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts).toHaveLength(3);
    const chartXml = await Promise.all(charts.map((c) => zip.file(c)!.async("string")));
    expect(chartXml.some((x) => x.includes("<c:barChart>"))).toBe(true);
    expect(chartXml.some((x) => x.includes("<c:lineChart>"))).toBe(true);
    expect(chartXml.some((x) => x.includes("<c:pieChart>"))).toBe(true);

    // bảng native (slide 8)
    const xml8 = await zip.file("ppt/slides/slide8.xml")!.async("string");
    expect(xml8).toContain("<a:tbl>");
    expect(xml8).toContain("<a:t>Gió ngoài khơi</a:t>");

    // ghi chú diễn giả
    const notes = Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    expect(notes.length).toBeGreaterThanOrEqual(5);
    const allNotes = (await Promise.all(notes.map((n) => zip.file(n)!.async("string")))).join("");
    expect(allNotes).toContain("Chào mở đầu");

    // slide Nguồn ở cuối
    const last = await zip.file(`ppt/slides/slide${deck.slides.length + 1}.xml`)!.async("string");
    expect(last).toContain("<a:t>Nguồn</a:t>");
    expect(last).toContain("Báo cáo năng lượng (fixture) — trang 4");

    // 16:9
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    expect(pres).toContain('<p:sldSz cx="12192000" cy="6858000"');
  });

  it("hình học PPTX khớp layouts.ts: mọi phần tử có toạ độ (EMU) trùng khung đã tính", async () => {
    const deck = sampleDeck();
    const zip = await JSZip.loadAsync(await exportSlideDeckPptx(deck));
    for (const i of [0, 1, 4, 7, 9]) {
      const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string");
      const r = layoutSlide(deck.slides[i], deck.theme, { index: i, total: deck.slides.length });
      for (const el of r.elements) {
        if (el.type === "slideNumber") continue;
        const re = new RegExp(`<a:off x="${emu(el.box.x)}" y="${emu(el.box.y)}"/>`);
        expect(xml, `slide ${i + 1} element ${el.key}`).toMatch(re);
      }
    }
  });

  it("ảnh: nhúng từ dataUrl và từ resolveImage (Buffer), cắt 'cover' vào khung", async () => {
    const deck = sampleDeck();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    const withUrl = { ...deck, slides: deck.slides.map((s) => (s.layout === "image_text" ? { ...s, image: { ...s.image!, dataUrl: `data:image/png;base64,${png.toString("base64")}` } } : s)) };
    const z1 = await JSZip.loadAsync(await exportSlideDeckPptx(withUrl));
    expect(Object.keys(z1.files).some((n) => n.startsWith("ppt/media/"))).toBe(true);
    const withFile = { ...deck, slides: deck.slides.map((s) => (s.layout === "image_text" ? { ...s, image: { ...s.image!, fileId: "f1" } } : s)) };
    const z2 = await JSZip.loadAsync(await exportSlideDeckPptx(withFile, { resolveImage: async (id) => (id === "f1" ? png : null) }));
    const xml = await z2.file("ppt/slides/slide6.xml")!.async("string");
    expect(xml).toContain("<p:pic>");
    expect(xml).toContain("<a:srcRect");
    // không có ảnh → hình chữ nhật giữ chỗ, không lỗi
    const z3 = await JSZip.loadAsync(await exportSlideDeckPptx(deck));
    expect(await z3.file("ppt/slides/slide6.xml")!.async("string")).not.toContain("<p:pic>");
  });

  it.skipIf(!hasSoffice)(
    "mở được trong LibreOffice: soffice → PDF có số trang = số slide (+ slide Nguồn)",
    async () => {
      const deck = sampleDeck();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kbm-pptx-"));
      const file = path.join(dir, "deck.pptx");
      fs.writeFileSync(file, await exportSlideDeckPptx(deck));
      execFileSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", dir, file], { stdio: "ignore", timeout: 120_000 });
      const pdf = fs.readFileSync(path.join(dir, "deck.pdf"));
      const doc = await getDocumentProxy(new Uint8Array(pdf));
      expect(doc.numPages).toBe(deck.slides.length + buildSourceSlides(deck).length);
      fs.rmSync(dir, { recursive: true, force: true });
    },
    180_000,
  );
});

describe("HTML in", () => {
  it("trang 1280×720, @page landscape, theme, đúng số trang (+ Nguồn), thoát ký tự HTML, resolveImageUrl", () => {
    const deck = sampleDeck();
    deck.slides[1].title = "<script>alert(1)</script> & “thử”";
    deck.slides[5].image = { ...deck.slides[5].image!, fileId: "abc" };
    const html = renderSlideDeckHtml(deck, { resolveImageUrl: (id) => `/api/files/${id}` });
    expect(html).toMatch(/@page\{size:1280px 720px;margin:0\}/);
    expect(html).toContain("<!doctype html>");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp;");
    expect(html).toContain('src="/api/files/abc"');
    const dom = new JSDOM(html);
    const pages = dom.window.document.querySelectorAll(".page");
    expect(pages).toHaveLength(deck.slides.length + buildSourceSlides(deck).length);
    expect((pages[0] as HTMLElement).style.background).toBeTruthy();
    expect(renderSlideDeckHtml(deck, { includeSources: false }).match(/class="page"/g)).toHaveLength(deck.slides.length);
    expect(renderSlideDeckHtml({ ...deck, theme: { palette: "rose", font: "Georgia" } })).toContain("#e11d48");
  });
});

describe("hình học dùng chung", () => {
  it("HTML in, SlideView (React) và layoutSlide cùng khoá phần tử & toạ độ", () => {
    const deck = sampleDeck();
    const html = new JSDOM(renderSlideDeckHtml(deck, { includeSources: false })).window.document;
    deck.slides.forEach((slide, i) => {
      const expected = layoutSlide(slide, deck.theme, { index: i, total: deck.slides.length }).elements;
      const page = html.querySelectorAll(".page")[i];
      const htmlKeys = [...page.querySelectorAll("[data-key]")].map((e) => e.getAttribute("data-key"));
      expect(htmlKeys).toEqual(expected.map((e) => e.key));

      const reactDom = new JSDOM(
        renderToStaticMarkup(createElement(SlideView, { slide, theme: deck.theme, index: i, total: deck.slides.length })),
      ).window.document;
      const reactKeys = [...reactDom.querySelectorAll("[data-key]")].map((e) => e.getAttribute("data-key"));
      expect(reactKeys).toEqual(expected.map((e) => e.key));

      // toạ độ left/top/width/height khớp giữa HTML in và React
      for (const el of expected) {
        const a = page.querySelector(`[data-key="${el.key}"]`) as HTMLElement;
        const b = reactDom.querySelector(`[data-key="${el.key}"]`) as HTMLElement;
        for (const prop of ["left", "top", "width", "height"] as const) {
          expect(parseFloat(a.style[prop]), `${slide.layout}/${el.key}/${prop}`).toBe(el.box[prop === "left" ? "x" : prop === "top" ? "y" : prop === "width" ? "w" : "h"]);
          expect(parseFloat(b.style[prop])).toBe(parseFloat(a.style[prop]));
        }
      }
    });
  });

  it("cỡ chữ tự co theo nội dung nhưng không dưới mức tối thiểu; không phần tử chữ rỗng khi xuất", () => {
    const deck = sampleDeck();
    const long = { ...deck.slides[1], bullets: Array.from({ length: 6 }, () => "Một ý khá dài ".repeat(8)) };
    const short = deck.slides[1];
    const sizeOf = (s: Slide) => (layoutSlide(s, deck.theme).elements.find((e) => e.type === "bullets") as { style: { size: number } }).style.size;
    expect(sizeOf(long)).toBeLessThan(sizeOf(short));
    expect(sizeOf(long)).toBeGreaterThanOrEqual(16);
    const empty = layoutSlide({ ...short, subtitle: "", bullets: ["", " "] }, deck.theme).elements;
    expect(empty.some((e) => e.type === "bullets" || (e.type === "text" && e.key === "subtitle"))).toBe(false);
    const edit = layoutSlide({ ...short, subtitle: "", bullets: [] }, deck.theme, { edit: true }).elements;
    expect(edit.some((e) => e.key === "subtitle")).toBe(true);
  });
});
