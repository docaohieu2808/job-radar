import { describe, expect, it } from "vitest";
process.env.DATABASE_URL ??= "postgres://unused";
const { feedTokenOk } = await import("../src/api/feed.js");

describe("feedTokenOk", () => {
  const token = "a".repeat(32);
  it("accepts only the exact configured token", () => {
    expect(feedTokenOk(token, token)).toBe(true);
    expect(feedTokenOk(token.slice(1), token)).toBe(false);
    expect(feedTokenOk("b".repeat(32), token)).toBe(false);
    expect(feedTokenOk(undefined, token)).toBe(false);
  });
  it("keeps the feed off when no token, or a short one, is configured", () => {
    expect(feedTokenOk("", "")).toBe(false);
    expect(feedTokenOk("short", "short")).toBe(false);
  });
});
