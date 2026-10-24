import { describe, expect, it } from "vitest";
import { detectCertSupport, detectForeignLanguage, detectEnglish, detectLevel, detectStack, detectWorkMode, isRelevantTitle, isWantedLocation, parseSalary } from "../src/extract.js";
import { scorePosting } from "../src/score.js";
import { extractFacts } from "../src/extract.js";
import { DEFAULT_PREFS } from "../src/prefs.js";
const KW = DEFAULT_PREFS.keywords;

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
    expect(detectLevel("DevOps Engineer", "1-3 years of experience with DevOps tools")).toMatchObject({ level: "middle", years: 1 });
    expect(detectLevel("DevOps Engineer (Mid/Senior)", "")).toMatchObject({ level: "middle" });
    expect(detectLevel("DevOps Engineer", "At least 1 year of experience")).toMatchObject({ level: "junior" });
    expect(detectLevel("DevOps Engineer", "6+ years of experience")).toMatchObject({ level: "senior" });
    expect(detectLevel("DevOps Engineer", "Experience: 1 year, 3 years")).toMatchObject({ level: "middle", years: 1 });
    expect(detectLevel("DevOps Engineer", "2–5+ years of experience in DevOps")).toMatchObject({ level: "middle", years: 2 });
    expect(detectLevel("DevOps Engineer", "A start-up with 5 years of growth.\nExperience: 1-3 years with Docker")).toMatchObject({ level: "middle", years: 1 });
  });

  it("reads work mode, English and certification support", () => {
    expect(detectWorkMode("9-11 Dong Da\nHybrid\nPosted 7 days ago").mode).toBe("hybrid");
    expect(detectWorkMode("Ho Chi Minh\nAt office\nWe also support remote teams in Europe").mode).toBe("onsite");
    expect(detectWorkMode("Collaborate with remote teams", "Senior DevOps Engineer").mode).toBe("unknown");
    expect(detectWorkMode("", "DevOps Engineer (Remote Japan)").mode).toBe("remote");
    expect(detectEnglish("Fluent English communication").english).toBe("fluent");
    expect(detectEnglish("Tiếng Anh giao tiếp").english).toBe("good");
    expect(detectCertSupport("Được hỗ trợ 50% chi phí các khóa học bên ngoài, hỗ trợ 100% chi phí thi các chứng chỉ liên quan đến IT").cert).toBe(true);
  });

  it("keeps DevOps-family titles in HCMC or remote", () => {
    expect(isRelevantTitle("Cloud Native DevOps Engineer", KW)).toBe(true);
    expect(isRelevantTitle("Kỹ Sư Phát Triển Và Vận Hành DevOps", KW)).toBe(true);
    expect(isRelevantTitle("Transportation Operation Executive", KW)).toBe(false);
    expect(isRelevantTitle("DATA ENGINEER / DATA PLATFORM ENGINEER", KW)).toBe(false);
    expect(isRelevantTitle("Senior SRE", KW)).toBe(true);
    expect(isRelevantTitle("Presales Engineer", KW)).toBe(false);
    expect(isWantedLocation("Quận 7, Ho Chi Minh City, Vietnam", "onsite")).toBe(true);
    expect(isWantedLocation("Cầu Giấy, Hà Nội", "onsite")).toBe(false);
    expect(isWantedLocation("Hà Nội", "remote")).toBe(true);
    expect(isWantedLocation("Tòa nhà Bưu Điện, Cầu Giấy, HN, Hà Nội, Việt Nam", "unknown")).toBe(false);
    expect(isWantedLocation("Ha Noi – Ho Chi Minh", "onsite")).toBe(true);
    expect(isWantedLocation("Vietnam", "unknown")).toBe(true);
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

describe("scoring traps from real postings", () => {
  it("does not count language-exam fees as certification sponsorship", () => {
    expect(detectCertSupport("Tham gia lớp tiếng Nhật chuyên môn với giáo viên Nhật. Hỗ trợ lệ phí thi tuyển các chứng chỉ như: BJT, JLPT…").cert).toBe(false);
    expect(detectCertSupport("Company sponsors AWS and CKA certification exams").cert).toBe(true);
  });

  it("finds a required Japanese level but not a class, allowance or plus", () => {
    expect(detectForeignLanguage("- Tiếng Nhật N2 trở lên, giao tiếp tốt.").language).toBe("Japanese N2");
    expect(detectForeignLanguage("- Phụ cấp hấp dẫn: Ăn trưa, đi lại, tiếng Nhật, thâm niên").language).toBeNull();
    expect(detectForeignLanguage("- Biết tiếng Nhật là một lợi thế").language).toBeNull();
    expect(detectForeignLanguage("Experience with GCP n2-standard machines is required").language).toBeNull();
  });

  it("keeps remote work abroad but drops offices abroad named in a title or address", () => {
    expect(isWantedLocation("", "hybrid", "Senior AWS DevOps Engineer https://netcompany.com/job/REF5842J-Leeds")).toBe(false);
    expect(isWantedLocation("", "unknown", "Cloud Platform Engineer - Thailand, Bangkok")).toBe(false);
    expect(isWantedLocation("Singapore", "remote")).toBe(false);
    expect(isWantedLocation("Remote (Australia, Singapore, Vietnam)", "remote")).toBe(true);
    expect(isWantedLocation("Remote (San Francisco)", "remote")).toBe(false);
    expect(isWantedLocation("Ho Chi Minh City", "onsite", "DevOps Engineer (Remote Japan)")).toBe(true);
  });

  it("keeps remote work open to Vietnam and drops remote limited to elsewhere", () => {
    expect(isWantedLocation("Remote (worldwide)", "remote")).toBe(true);
    expect(isWantedLocation("Europe, LATAM, APAC, the U.S., Canada", "remote")).toBe(true);
    expect(isWantedLocation("Remote (Milan)", "remote")).toBe(false);
    expect(isWantedLocation("Panama - Remote", "remote")).toBe(false);
    expect(isWantedLocation("Remote - United States", "remote")).toBe(false);
    expect(isWantedLocation("Time zone: CET (+/- 3 hours)", "remote")).toBe(false);
    expect(isWantedLocation("Vietnam", "remote")).toBe(true);
  });

  it("does not read company age as required experience", () => {
    expect(detectLevel("Middle - Senior DevOps Engineer", "23+ years of expertise - Gradion builds digital platforms").years).toBeNull();
  });

  it("drops postings for an office in Japan", () => {
    expect(isWantedLocation("Japan Office", "onsite")).toBe(false);
  });

  it("keeps infra and network roles titled developer", () => {
    expect(isRelevantTitle("Lập trình viên Infra-system-Network", ["Infra"])).toBe(true);
    expect(isRelevantTitle("Lập trình viên Java", ["Infra", "Java"])).toBe(false);
  });

  it("keeps bridge engineers and testers out", () => {
    expect(isRelevantTitle("BRIDGE SYSTEM ENGINEER (BRSE)", ["system engineer", "devops"])).toBe(false);
    expect(isRelevantTitle("QA Engineer", ["engineer"])).toBe(false);
    expect(isRelevantTitle("DevOps Engineer (QA automation)", ["devops"])).toBe(true);
  });

  it("scores the Cube System BrSE posting low", async () => {
    const { scorePosting } = await import("../src/score.js");
    const text = "Mức lương\nLên tới $2,000/tháng\n- Tiếng Nhật N2 trở lên, giao tiếp tốt.\n- Có kiến thức vận hành các dịch vụ đám mây (cloud).\n- Hỗ trợ lệ phí thi tuyển các chứng chỉ như: BJT, JLPT…\n- Cơ hội được làm việc và công tác tại Nhật Bản.";
    const facts = extractFacts({ title: "BRIDGE SYSTEM ENGINEER (BRSE)", text, salaryText: "Lên tới $2,000/tháng" });
    expect(facts.certSupport).toBe(false);
    expect(scorePosting(facts).score).toBeLessThan(50);
  });
});
