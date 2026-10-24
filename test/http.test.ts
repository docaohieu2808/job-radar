// The response size cap: a huge page is refused instead of being read into memory.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { fetchText, MAX_BODY_BYTES, ResponseTooLargeError } = await import("../src/http.js");

describe("response size cap", () => {
  const serve = (bytes: number, declareLength: boolean) =>
    new Promise<{ url: string; close: () => void }>((resolve) => {
      const server = http.createServer((_req, res) => {
        if (declareLength) res.setHeader("content-length", String(bytes));
        const chunk = Buffer.alloc(64 * 1024, "a");
        let left = bytes;
        const push = () => {
          while (left > 0) {
            const n = Math.min(left, chunk.length);
            left -= n;
            if (!res.write(chunk.subarray(0, n))) return void res.once("drain", push);
          }
          res.end();
        };
        push();
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
      });
    });

  it("reads a normal page", async () => {
    const s = await serve(100_000, true);
    try {
      expect((await fetchText(s.url)).length).toBe(100_000);
    } finally {
      s.close();
    }
  });

  it("refuses a page that declares more than the cap", async () => {
    const s = await serve(MAX_BODY_BYTES + 1, true);
    try {
      await expect(fetchText(s.url)).rejects.toBeInstanceOf(ResponseTooLargeError);
    } finally {
      s.close();
    }
  });

  it("stops reading a streamed page once it passes the cap", async () => {
    const s = await serve(22 * 1024 * 1024, false);
    try {
      await expect(fetchText(s.url)).rejects.toBeInstanceOf(ResponseTooLargeError);
    } finally {
      s.close();
    }
  });
});
