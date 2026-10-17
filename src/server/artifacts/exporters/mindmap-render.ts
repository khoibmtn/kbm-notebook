import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MindmapNode } from "@/lib/artifacts/content";
import { withPage } from "./browser";
import { escapeHtml } from "./html";

/** Nút markmap (`INode`): `content` là HTML → luôn escape nhãn. */
type MarkmapNode = { content: string; children: MarkmapNode[]; payload?: Record<string, unknown> };

export function toMarkmapTree(node: MindmapNode): MarkmapNode {
  const note = node.note ? ` <span style="opacity:.6;font-size:.85em">— ${escapeHtml(node.note)}</span>` : "";
  return { content: `${escapeHtml(node.label)}${note}`, children: node.children.map(toMarkmapTree) };
}

let bundleCache: { d3: string; markmap: string } | null = null;

async function loadBundles() {
  if (bundleCache) return bundleCache;
  const root = /* turbopackIgnore: true */ process.cwd();
  const [d3, markmap] = await Promise.all([
    readFile(path.join(root, "node_modules/d3/dist/d3.min.js"), "utf8"),
    readFile(path.join(root, "node_modules/markmap-view/dist/browser/index.js"), "utf8"),
  ]);
  bundleCache = { d3, markmap };
  return bundleCache;
}

export type MindmapRender = { svg: string; png: Buffer; width: number; height: number };

const MAX_SIDE = 6000;

/**
 * Vẽ sơ đồ tư duy bằng markmap (`markmap-view`) trong Chromium rồi trích SVG độc lập (viewBox khớp nội dung)
 * và/hoặc ảnh PNG (nền trắng, độ phân giải x2).
 */
export async function renderMindmap(root: MindmapNode, want: { svg?: boolean; png?: boolean }): Promise<Partial<MindmapRender>> {
  const { d3, markmap } = await loadBundles();
  const data = toMarkmapTree(root);
  return withPage(
    async (page) => {
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block}</style></head><body><svg id="mm" xmlns="http://www.w3.org/2000/svg" style="width:1600px;height:1000px"></svg></body></html>`,
        { waitUntil: "load" },
      );
      await page.addScriptTag({ content: d3 });
      await page.addScriptTag({ content: markmap });
      const size = await page.evaluate(async (tree) => {
        const w = window as unknown as {
          markmap: { Markmap: { create(svg: string, opts: object, data: object): { state: { rect: { x1: number; y1: number; x2: number; y2: number } }; setData(d: object): Promise<void> } } };
        };
        const mm = w.markmap.Markmap.create("#mm", { duration: 0, autoFit: false, maxWidth: 280, paddingX: 12, initialExpandLevel: -1 }, tree);
        await mm.setData(tree);
        // d3-transition vẫn chạy bất đồng bộ dù duration = 0 → chờ vị trí/nét vẽ cuối cùng trước khi trích SVG/ảnh.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const r = mm.state.rect;
        const pad = 24;
        const width = Math.ceil(r.x2 - r.x1 + pad * 2);
        const height = Math.ceil(r.y2 - r.y1 + pad * 2);
        const svg = document.getElementById("mm")!;
        svg.setAttribute("viewBox", `${r.x1 - pad} ${r.y1 - pad} ${width} ${height}`);
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        (svg as unknown as HTMLElement).style.width = `${width}px`;
        (svg as unknown as HTMLElement).style.height = `${height}px`;
        svg.querySelector("g")?.setAttribute("transform", "");
        return { width, height };
      }, data);

      const out: Partial<MindmapRender> = { width: size.width, height: size.height };
      if (want.svg) {
        out.svg = await page.evaluate(() => {
          const svg = document.getElementById("mm")!.cloneNode(true) as SVGElement;
          svg.removeAttribute("id");
          svg.removeAttribute("style");
          svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          svg.setAttribute("xmlns:xhtml", "http://www.w3.org/1999/xhtml");
          // nền trắng để đọc được cả khi mở trên nền tối
          const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          const vb = svg.getAttribute("viewBox")!.split(" ").map(Number);
          bg.setAttribute("x", String(vb[0]));
          bg.setAttribute("y", String(vb[1]));
          bg.setAttribute("width", String(vb[2]));
          bg.setAttribute("height", String(vb[3]));
          bg.setAttribute("fill", "#ffffff");
          svg.insertBefore(bg, svg.firstChild);
          return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
        });
      }
      if (want.png) {
        await page.setViewportSize({ width: Math.min(size.width, MAX_SIDE), height: Math.min(size.height, MAX_SIDE) });
        out.png = Buffer.from(
          await page.locator("#mm").screenshot({ type: "png", animations: "disabled" }),
        );
      }
      return out;
    },
    { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 },
  );
}
