import { describe, expect, it } from "vitest";
import { detectCertSupport, detectEnglish, detectLevel, detectStack, detectWorkMode, isRelevantTitle, isWantedLocation, parseSalary } from "../src/extract.js";
import { scorePosting } from "../src/score.js";
import { extractFacts } from "../src/extract.js";

describe("parseSalary", () => {
  it.each([
    ["23-27 triệu/tháng", { min: 23e6, max: 27e6, currency: "VND" }],
    ["lên đến 23-27 triệu", { min: 23e6, max: 27e6, currency: "VND" }],
    ["Thu nhập 15-40 Triệu", { min: 15e6, max: 40e6, currency: "VND" }],
    ["Up to 30M", { min: null, max: 30e6, currency: "VND" }],
    ["$1,500 - $2,000", { min: 1500, max: 2000, currency: "USD" }],
    ["1000 - 2000 USD", { min: 1000, max: 2000, currency: "USD" }],
  ])("%s", (text, expected) => expect(parseSalary(text)).toEqual(expected));

  it("ignores text without pay", () => {
    expect(parseSalary("3-5 years of experience")).toBeNull();
    expect(parseSalary("Thương lượng")).toBeNull();
  });
});

describe("facts", () => {
  it("finds the stack on word boundaries", () => {
    expect(detectStack("Docker, Kubernetes (K8s), GitHub Actions, Azure")).toEqual(["Docker", "Kubernetes", "GitHub Actions", "Azure"]);
    expect(detectStack("We are a goal-driven team")).toEqual([]);
  });

  it("reads level and years", () => {
    expect(detectLevel("Senior DevOps Engineer", "")).toMatchObject({ level: "senior" });
    expect(detectLevel("Devops Engineer (từ 3 năm KN)", "")).toMatchObject({ level: "middle", years: 3 });
    expect(detectLevel("DevOps Lead", "")).toMatchObject({ level: "lead" });
  });

  it("reads work mode, English and certification support", () => {
    expect(detectWorkMode("9-11 Dong Da\nHybrid\nPosted 7 days ago").mode).toBe("hybrid");
    expect(detectEnglish("Fluent English communication").english).toBe("fluent");
    expect(detectEnglish("Tiếng Anh giao tiếp").english).toBe("good");
    expect(detectCertSupport("Được hỗ trợ 50% chi phí các khóa học bên ngoài, hỗ trợ 100% chi phí thi các chứng chỉ liên quan đến IT").cert).toBe(true);
  });

  it("keeps DevOps-family titles in HCMC or remote", () => {
    expect(isRelevantTitle("Cloud Native DevOps Engineer")).toBe(true);
    expect(isRelevantTitle("Kỹ Sư Phát Triển Và Vận Hành DevOps")).toBe(true);
    expect(isRelevantTitle("Transportation Operation Executive")).toBe(false);
    expect(isRelevantTitle("DATA ENGINEER / DATA PLATFORM ENGINEER")).toBe(false);
    expect(isWantedLocation("Quận 7, Ho Chi Minh City, Vietnam", "onsite")).toBe(true);
    expect(isWantedLocation("Cầu Giấy, Hà Nội", "onsite")).toBe(false);
    expect(isWantedLocation("Hà Nội", "remote")).toBe(true);
  });
});

describe("scorePosting", () => {
  it("scores the Tinh Van posting with its reasons", () => {
    const facts = extractFacts({
      title: "Devops Engineer (từ 3 năm KN)",
      text: "Quản lý và tối ưu hạ tầng trên cloud (ưu tiên Azure). Docker, Kubernetes (K8s). GitHub Actions. Linux. Bash, Python.\nMức lương lên đến 23-27 triệu/tháng\nĐược hỗ trợ 100% chi phí thi các chứng chỉ liên quan đến IT\nCơ hội làm việc và đào tạo tại Nhật Bản, Singapore",
    });
    const { score, reasons } = scorePosting(facts);
    const labels = reasons.map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["Cert sponsorship", "Kubernetes", "Azure gap", "Middle level", "Onsite abroad", "Salary up to 27M"]));
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(100);
  });
});
