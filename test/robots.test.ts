import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { allowedBy, disallowed } = await import("../src/robots.js");

describe("robots.txt", () => {
  const robots = "User-agent: Googlebot\nDisallow: /\n\nUser-agent: Bingbot\nUser-agent: *\nDisallow: /private/\nDisallow: /admin\n# comment\nAllow: /\n";
  it("reads only the groups that include *", () => {
    expect(disallowed(robots)).toEqual(["/private/", "/admin"]);
  });
  it("allows career paths and blocks disallowed ones", () => {
    expect(allowedBy(robots, "/tuyen-dung")).toBe(true);
    expect(allowedBy(robots, "/admin/jobs")).toBe(false);
    expect(allowedBy("", "/anything")).toBe(true);
  });
});
