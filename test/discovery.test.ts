import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
const { candidateDomain, scoreCandidate, siteName } = await import("../src/sources/discovery.js");

const page = (body: string, title = "Acme Software") =>
  `<html><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
const filler = " Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.".repeat(4);

describe("link discovery", () => {
  it("keeps other companies' sites and drops platforms, boards and public sector", () => {
    expect(candidateDomain("https://tso.vn/vi/talent-acquisition", "https://tinhvan.com/vi/tuyen-dung")).toBe("tso.vn");
    expect(candidateDomain("https://www.facebook.com/acme", "https://acme.vn")).toBeNull();
    expect(candidateDomain("https://itviec.com/companies/acme", "https://acme.vn")).toBeNull();
    expect(candidateDomain("https://hcmus.edu.vn", "https://acme.vn")).toBeNull();
    expect(candidateDomain("https://blog.acme.vn/post", "https://acme.vn")).toBeNull();
    expect(candidateDomain("mailto:hr@acme.vn", "https://acme.vn")).toBeNull();
  });

  it("accepts an IT company in Ho Chi Minh City with a careers link", () => {
    const html = page(
      `<p>Công ty TNHH Acme cung cấp giải pháp phần mềm, dịch vụ outsourcing và chuyển đổi số cho doanh nghiệp. Văn phòng tại Quận 1, TP.HCM.</p>
       <p>Our engineers build web and mobile apps.${filler}</p><a href="/careers">Careers</a>`,
    );
    const s = scoreCandidate(html, "acme.vn");
    expect(s.score).toBeGreaterThanOrEqual(60);
    expect(s.careerLink).toBe(true);
  });

  it("rejects a non-IT company even with a careers link and an HCMC address", () => {
    const html = page(`<p>Công ty CP Xây dựng Hoàng Nam thi công nhà xưởng tại TP.HCM. Đội ngũ kỹ sư giàu kinh nghiệm.${filler}</p><a href="/tuyen-dung">Tuyển dụng</a>`, "Xây dựng Hoàng Nam");
    const s = scoreCandidate(html, "xaydung.vn");
    expect(s.core).toBe(0);
    expect(s.score).toBeLessThanOrEqual(25);
  });

  it("rejects an online shop and a parked domain", () => {
    expect(scoreCandidate(page(`<p>Giỏ hàng · Mua ngay · Thêm vào giỏ · Áo thun nam.${filler}</p>`), "shop.vn").score).toBeLessThan(25);
    expect(scoreCandidate(page("<p>This domain is for sale.</p>"), "parked.com").score).toBe(0);
  });

  it("names the site from og:site_name or the title", () => {
    expect(siteName('<meta property="og:site_name" content="Tinhvan Software">', "tso.vn")).toBe("Tinhvan Software");
    expect(siteName("<title>Acme | Software outsourcing</title>", "acme.vn")).toBe("Acme");
    expect(siteName("<title>Home</title>", "acme.vn")).toBe("Acme");
  });
});
