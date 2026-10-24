import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { needsSummary } = await import("../src/translate.js");

describe("Vietnamese summaries", () => {
  it("summarises English postings and skips Vietnamese ones and stubs", () => {
    expect(needsSummary("We are looking for a DevOps Engineer to run our Kubernetes platform. ".repeat(5))).toBe(true);
    expect(needsSummary("Chúng tôi tuyển kỹ sư DevOps vận hành hệ thống Kubernetes, yêu cầu kinh nghiệm thực tế. ".repeat(5))).toBe(false);
    expect(needsSummary("DevOps Engineer")).toBe(false);
  });
});
