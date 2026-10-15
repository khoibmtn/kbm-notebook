import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestError } from "@/server/knowledge/ingest/errors";
import { assertPublicUrl, isPrivateIp, safeFetch } from "@/server/knowledge/ingest/ssrf";

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // metadata cloud
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.1.2.3",
    "64:ff9b::7f00:1",
  ])("chặn %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "cho phép %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );

  it("không phải IP hợp lệ → chặn", () => {
    expect(isPrivateIp("abc")).toBe(true);
  });
});

describe("assertPublicUrl", () => {
  it.each([
    "http://127.0.0.1/",
    "http://localhost:3000/x",
    "http://foo.localhost/",
    "http://10.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://printer.local/",
    "http://svc.internal/",
    "http://user:pass@example.com/",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "không phải url",
  ])("từ chối %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(IngestError);
  });

  it("chấp nhận IP công khai dạng literal (không cần DNS)", async () => {
    const u = await assertPublicUrl("https://8.8.8.8/dns");
    expect(u.hostname).toBe("8.8.8.8");
  });
});

describe("safeFetch", () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1/secret" });
        return res.end();
      }
      res.end("<html><body>nội bộ</body></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("không bao giờ kết nối tới server loopback", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/nội bộ/);
    await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow(/nội bộ/);
  });

  it("chặn cả khi chuyển hướng vào địa chỉ nội bộ", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect`)).rejects.toBeInstanceOf(IngestError);
  });
});
