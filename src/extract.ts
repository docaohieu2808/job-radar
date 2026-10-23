// Rule-based extraction of the facts the score needs, from a posting's title, tags and description.
// Every value keeps the sentence it came from (excerpts) so a wrong extraction can be checked against the source.

export type WorkMode = "onsite" | "hybrid" | "remote" | "unknown";
export type Level = "intern" | "junior" | "middle" | "senior" | "lead" | "manager" | "unknown";
export type English = "none" | "basic" | "good" | "fluent" | "unknown";

export type Salary = { min: number | null; max: number | null; currency: "VND" | "USD" };

export type Facts = {
  salary: Salary | null;
  workMode: WorkMode;
  level: Level;
  years: number | null;
  stack: string[];
  english: English;
  certSupport: boolean;
  abroad: boolean;
  // A language other than English or Vietnamese the role requires, e.g. "Japanese N2"; null when none is required.
  foreignLanguage: string | null;
  vietnameseText: boolean;
  excerpts: Record<string, string>;
};

// Canonical skill name -> pattern. Order does not matter; matching is on word boundaries.
const SKILLS: Record<string, RegExp> = {
  Docker: /\bdocker\b/i,
  "Docker Compose": /\bdocker[- ]compose\b/i,
  Kubernetes: /\b(kubernetes|k8s)\b/i,
  Helm: /\bhelm\b/i,
  ArgoCD: /\bargo ?cd\b/i,
  "GitLab CI": /\bgitlab\b/i,
  "GitHub Actions": /\bgithub actions\b/i,
  Jenkins: /\bjenkins\b/i,
  Harbor: /\bharbor\b/i,
  Ansible: /\bansible\b/i,
  Terraform: /\bterraform\b/i,
  Prometheus: /\bprometheus\b/i,
  Grafana: /\bgrafana\b/i,
  Loki: /\bloki\b/i,
  ELK: /\b(elk|elasticsearch|kibana|logstash|opensearch)\b/i,
  Linux: /\b(linux|ubuntu|centos|rhel|debian)\b/i,
  Nginx: /\bnginx\b/i,
  Vault: /\bhashicorp vault\b|\bvault\b/i,
  AWS: /\b(aws|amazon web services|eks|ec2)\b/i,
  Azure: /\b(azure|aks)\b/i,
  GCP: /\b(gcp|google cloud|gke)\b/i,
  Cloudflare: /\bcloudflare\b/i,
  Bash: /\b(bash|shell script(ing)?)\b/i,
  Python: /\bpython\b/i,
  Go: /\bgolang\b|\bgo lang\b/i,
  Kafka: /\bkafka\b/i,
  PostgreSQL: /\b(postgres(ql)?)\b/i,
  MySQL: /\b(mysql|mariadb)\b/i,
  MongoDB: /\bmongo(db)?\b/i,
  Redis: /\bredis\b/i,
  OpenStack: /\bopenstack\b/i,
};

// The owner's stack: what counts as "You have".
export const OWNER_STACK = new Set([
  "Docker", "Docker Compose", "Kubernetes", "Helm", "GitLab CI", "GitHub Actions", "Jenkins", "Harbor", "Ansible",
  "Terraform", "Prometheus", "Grafana", "Loki", "Linux", "Nginx", "Vault", "Cloudflare", "GCP", "Bash", "Python",
  "PostgreSQL", "MySQL", "Redis",
]);

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// The sentence (or line) around a match, for excerpts.
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf("\n", index), text.lastIndexOf(". ", index), 0);
  const endNl = text.indexOf("\n", index);
  const end = endNl === -1 ? Math.min(text.length, index + 200) : Math.min(endNl, index + 200);
  return text.slice(start, end).replace(/^[\n. ]+/, "").replace(/^[-•*]\s*/, "").trim().slice(0, 240);
}

function firstMatch(text: string, pattern: RegExp): { match: RegExpExecArray; excerpt: string } | null {
  const match = pattern.exec(text);
  return match ? { match, excerpt: sentenceAround(text, match.index) } : null;
}

const MILLION = 1_000_000;

// Parses "15 - 25 triệu", "Up to 30M", "$1,500 - 2,000", "1000-2000 USD", "Thu nhập 15-40 Triệu".
export function parseSalary(input: string): Salary | null {
  const s = input.replace(/\s+/g, " ");
  const num = (v: string) => Number(v.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));

  const vnd = /(?:(?:từ|from)\s*)?(\d{1,3}(?:[.,]\d)?)\s*(?:-|–|~|to|đến)\s*(\d{1,3}(?:[.,]\d)?)\s*(?:triệu|tr\b|m\b|million)/i.exec(s);
  if (vnd) return { min: num(vnd[1]) * MILLION, max: num(vnd[2]) * MILLION, currency: "VND" };
  const vndUpTo = /(?:up to|lên (?:đến|tới)|tới|đến|max)\s*(\d{1,3}(?:[.,]\d)?)\s*(?:triệu|tr\b|m\b|million)/i.exec(s);
  if (vndUpTo) return { min: null, max: num(vndUpTo[1]) * MILLION, currency: "VND" };
  const vndFrom = /(?:từ|from|trên|over)\s*(\d{1,3}(?:[.,]\d)?)\s*(?:triệu|tr\b|m\b|million)/i.exec(s);
  if (vndFrom) return { min: num(vndFrom[1]) * MILLION, max: null, currency: "VND" };

  const usd = /\$?\s*(\d{1,2}[.,]?\d{3})\s*(?:-|–|~|to)\s*\$?\s*(\d{1,2}[.,]?\d{3})\s*(?:usd|\$)?/i.exec(s);
  if (usd && (/usd|\$/i.test(usd[0]))) return { min: num(usd[1]), max: num(usd[2]), currency: "USD" };
  const usdUpTo = /(?:up to|lên (?:đến|tới)|tới|max)\s*\$?\s*(\d{1,2}[.,]?\d{3})\s*(usd|\$)?/i.exec(s);
  if (usdUpTo && (usdUpTo[2] || /\$/.test(usdUpTo[0]))) return { min: null, max: num(usdUpTo[1]), currency: "USD" };
  return null;
}

export function detectStack(text: string): string[] {
  return Object.entries(SKILLS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

export function detectLevel(title: string, text: string): { level: Level; years: number | null; excerpt?: string } {
  const t = title.toLowerCase();
  let level: Level = "unknown";
  if (/\b(intern|thực tập)/i.test(t)) level = "intern";
  else if (/\bfresher|junior\b/i.test(t)) level = "junior";
  else if (/\b(manager|head of|trưởng phòng)\b/i.test(t)) level = "manager";
  else if (/\b(lead|principal|architect|trưởng nhóm)\b/i.test(t)) level = "lead";
  // "Mid/Senior", "Middle to Senior": the posting is open to middle.
  else if (/\b(middle|mid|intermediate)\b/i.test(t)) level = "middle";
  else if (/\b(senior|sr\.?)\b/i.test(t)) level = "senior";

  // "3+ years", "1-3 years", "2–5+ years", "từ 3 năm": the lower bound is the requirement, the upper bound tells
  // whether middle fits. Lines about experience come first, so a company's age ("founded 5 years ago") is not read.
  const YEARS = /(\d{1,2})\s*\+?\s*(?:(?:-|–|~|to|đến)\s*(\d{1,2})\s*\+?\s*)?(?:năm|years?|yrs?)\b/i;
  // TopDev writes a range as "1 year, 3 years".
  text = text.replace(/(\d+)\s*years?,\s*(\d+)\s*years?/gi, "$1-$2 years");
  const experienceLines = text.split("\n").filter((l) => /experience|kinh nghiệm|\bexp\b|\bKN\b/i.test(l)).join("\n");
  const yearsHit = firstMatch(title, YEARS) ?? firstMatch(experienceLines, YEARS) ?? firstMatch(text, YEARS);
  const years = yearsHit ? Number(yearsHit.match[1]) : null;
  const upper = yearsHit?.match[2] ? Number(yearsHit.match[2]) : years;
  if (level === "unknown" && years !== null && upper !== null) {
    if (years <= 4 && upper >= 2) level = "middle";
    else if (upper <= 1) level = "junior";
    else level = "senior";
  }
  return { level, years, excerpt: yearsHit?.excerpt };
}

// A source's own work-mode line ("Hybrid", "At office") wins; otherwise only unambiguous phrases count,
// because a bare "remote" also appears in "remote team", "remote access" and the like.
export function detectWorkMode(text: string, title = ""): { mode: WorkMode; excerpt?: string } {
  const line = /^\s*(hybrid|at office|on-?site|remote|fully remote|work from home)\s*$/im.exec(text);
  if (line) {
    const v = line[1].toLowerCase();
    return { mode: v === "hybrid" ? "hybrid" : /remote|home/.test(v) ? "remote" : "onsite", excerpt: line[1] };
  }
  if (/\bremote\b/i.test(title)) return { mode: "remote", excerpt: title };
  if (/\bhybrid\b/i.test(title)) return { mode: "hybrid", excerpt: title };
  const hybrid = firstMatch(text, /\bhybrid (work|working|model|mode|schedule)|work(ing)? hybrid|kết hợp (online|từ xa)|\(hybrid\)/i);
  if (hybrid) return { mode: "hybrid", excerpt: hybrid.excerpt };
  const remote = firstMatch(text, /fully remote|100% remote|remote (work|working|position|job)|work(ing)? (fully )?remote(ly)?|work from home|làm việc từ xa/i);
  if (remote) return { mode: "remote", excerpt: remote.excerpt };
  const onsite = firstMatch(text, /\b(at office|onsite|on-site|làm việc tại văn phòng)\b/i);
  return onsite ? { mode: "onsite", excerpt: onsite.excerpt } : { mode: "unknown" };
}

export function detectEnglish(text: string): { english: English; excerpt?: string } {
  const fluent = firstMatch(text, /(fluent|excellent|advanced|professional)[^.\n]{0,25}english|english[^.\n]{0,25}(fluen|excellent|advanced)|tiếng anh (lưu loát|thành thạo)|ielts\s*[67]/i);
  if (fluent) return { english: "fluent", excerpt: fluent.excerpt };
  const good = firstMatch(text, /good[^.\n]{0,20}english|english[^.\n]{0,25}(good|communicat|giao tiếp)|tiếng anh (tốt|giao tiếp)|toeic/i);
  if (good) return { english: "good", excerpt: good.excerpt };
  const basic = firstMatch(text, /\benglish\b|tiếng anh/i);
  if (basic) return { english: "basic", excerpt: basic.excerpt };
  return { english: "none" };
}

// Language exams and classes: paying for these is not the technical certification the owner is after.
const LANGUAGE_CERT = /jlpt|\bbjt\b|nat-test|ielts|toeic|toefl|topik|\bhsk\b|tiếng (nhật|hàn|trung|anh)|japanese|korean|chinese|english/i;

// Sponsorship of technical certifications (AWS, CKA, ...). A line that only funds language exams does not count.
export function detectCertSupport(text: string): { cert: boolean; excerpt?: string } {
  const pattern = /(hỗ trợ|tài trợ|chi trả|sponsor|support|reimburs|cover|funded|paid)[^.\n]{0,60}(chứng chỉ|certification|certificate|exam)|(chứng chỉ|certification|certificate)[^.\n]{0,40}(hỗ trợ|tài trợ|sponsor|support|reimburs|paid|funded)/i;
  const TECH = /\baws\b|azure|\bgcp\b|google cloud|\bcka\b|\bckad\b|\bcks\b|kubernetes|terraform|hashicorp|linux|\brhc|\bccna\b|\bit\b|chuyên môn|kỹ thuật|technical|professional|cloud/i;
  // Sentence by sentence: a language class and a cloud exam can share one bullet.
  for (const line of text.split(/\n|(?<=[.;!?])\s+/)) {
    if (!pattern.test(line)) continue;
    if (LANGUAGE_CERT.test(line) && !TECH.test(line)) continue;
    return { cert: true, excerpt: line.trim().slice(0, 240) };
  }
  return { cert: false };
}

// A requirement for Japanese, Korean or Chinese ("Tiếng Nhật N2 trở lên", "JLPT N3", "Business-level Korean").
// Lines that offer classes or allowances, or call the language a plus, are not requirements.
export function detectForeignLanguage(text: string): { language: string | null; excerpt?: string } {
  const NAMES: [string, RegExp][] = [
    ["Japanese", /tiếng nhật|japanese|jlpt|nihongo/i],
    ["Korean", /tiếng hàn|korean|topik/i],
    ["Chinese", /tiếng trung|chinese|mandarin|\bhsk\b/i],
  ];
  const NOT_REQUIRED = /ưu tiên|lợi thế|là một lợi thế|điểm cộng|\bplus\b|advantage|preferred|nice to have|bonus|lớp|khóa học|khoá học|class|course|phụ cấp|allowance|hỗ trợ|support/i;
  const REQUIRED = /\bn[1-3]\b|jlpt|topik|\bhsk\b|trở lên|thành thạo|giao tiếp|business|fluent|required|yêu cầu|bắt buộc|tốt|good|native/i;
  for (const line of text.split("\n")) {
    for (const [name, re] of NAMES) {
      if (!re.test(line) || NOT_REQUIRED.test(line) || !REQUIRED.test(line)) continue;
      const level = /\bn([1-3])\b/i.exec(line);
      return { language: level && name === "Japanese" ? `Japanese N${level[1]}` : name, excerpt: line.trim().slice(0, 240) };
    }
  }
  return { language: null };
}

export function detectAbroad(text: string): { abroad: boolean; excerpt?: string } {
  const hit = firstMatch(text, /(onsite|làm việc|đào tạo|travel|business trip)[^.\n]{0,40}(nhật bản|japan|singapore|úc|australia|mỹ|usa|europe|châu âu)/i);
  return hit ? { abroad: true, excerpt: hit.excerpt } : { abroad: false };
}

const VIETNAMESE_MARKS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/gi;

export function isVietnameseText(text: string): boolean {
  const marks = text.match(VIETNAMESE_MARKS)?.length ?? 0;
  return marks > Math.max(20, text.length * 0.02);
}

// Keeps postings whose title contains one of the owner's keywords. Data and developer roles are noise on a broad
// search even when their title mentions a platform or the cloud, unless they are explicitly DevOps or SRE.
export function isRelevantTitle(title: string, keywords: string[]): boolean {
  if (/\bdata (engineer|scientist|analyst)|\bdeveloper\b|lập trình viên/i.test(title) && !/devops|sre|site reliability/i.test(title)) return false;
  // Bridge engineers, interpreters and testers are other jobs that share words like "system engineer".
  if (/\bbrse\b|bridge (system )?(se|engineer)|kỹ sư cầu nối|comtor|biên phiên dịch|interpreter|\btester\b|\bqa\b|\bqc\b|quality (assurance|control)|kiểm thử/i.test(title) && !/devops|sre|site reliability/i.test(title)) return false;
  const t = title.toLowerCase();
  return keywords.some((k) => {
    const word = k.trim().toLowerCase();
    if (!word) return false;
    // Short acronyms must stand alone ("SRE" is not "pSREdict").
    return word.length <= 4 ? new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t) : t.includes(word);
  });
}

// HCMC or remote; postings only in other cities are dropped. A place naming no known city is kept.
const HCMC = /h[oồ] ch[ií] minh|\bhcm\b|tp\.? ?hcm|sài gòn|saigon|thủ đức|thu duc/i;
const OTHER_CITY = /hà nội|ha noi|hanoi|đà nẵng|da nang|danang|hải phòng|hai phong|cần thơ|can tho|nha trang|huế|bắc ninh|bac ninh/i;

export function isWantedLocation(location: string, workMode: WorkMode): boolean {
  if (workMode === "remote") return true;
  if (HCMC.test(location)) return true;
  return !OTHER_CITY.test(location);
}

export function extractFacts(input: { title: string; text: string; tags?: string[]; salaryText?: string }): Facts {
  const all = `${input.title}\n${(input.tags ?? []).join(", ")}\n${input.text}`;
  const excerpts: Record<string, string> = {};
  const salary = parseSalary(input.salaryText ?? "") ?? parseSalary(input.title) ?? parseSalaryFromText(input.text, excerpts);
  if (salary && input.salaryText) excerpts.salary = input.salaryText;
  const level = detectLevel(input.title, input.text);
  if (level.excerpt) excerpts.years = level.excerpt;
  const mode = detectWorkMode(`${(input.tags ?? []).join("\n")}\n${input.text}`, input.title);
  if (mode.excerpt) excerpts.workMode = mode.excerpt;
  const english = detectEnglish(input.text);
  if (english.excerpt) excerpts.english = english.excerpt;
  const cert = detectCertSupport(input.text);
  if (cert.excerpt) excerpts.certSupport = cert.excerpt;
  const abroad = detectAbroad(input.text);
  if (abroad.excerpt) excerpts.abroad = abroad.excerpt;
  const foreign = detectForeignLanguage(`${input.title}\n${input.text}`);
  if (foreign.excerpt) excerpts.foreignLanguage = foreign.excerpt;
  return {
    salary,
    workMode: mode.mode,
    level: level.level,
    years: level.years,
    stack: detectStack(all),
    english: english.english,
    certSupport: cert.cert,
    abroad: abroad.abroad,
    foreignLanguage: foreign.language,
    vietnameseText: isVietnameseText(input.text),
    excerpts,
  };
}

// Salary written inside the description: only lines that talk about pay, to avoid matching "3-5 years".
function parseSalaryFromText(text: string, excerpts: Record<string, string>): Salary | null {
  for (const line of text.split("\n")) {
    if (!/lương|salary|thu nhập|income|compensation|offer/i.test(line)) continue;
    const salary = parseSalary(line);
    if (salary) {
      excerpts.salary = line.trim().slice(0, 240);
      return salary;
    }
  }
  return null;
}
