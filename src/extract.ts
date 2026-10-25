// Rule-based extraction of the facts the score needs, from a posting's title, tags and description.
// Every value keeps the sentence it came from (excerpts) so a wrong extraction can be checked against the source.

import * as cheerio from "cheerio";

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
  // "Golang", or a bare "Go" given as a tag (sources' skill lists, and the stored stack passed back on rescoring).
  Go: /\bgolang\b|\bgo lang\b|(?:^|[\n,])\s*Go\s*(?=$|[\n,])/m,
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

// Pages that wrap every tag of a list in its own block ("DevOps", ",", "GCP", ",", ...) leave one-word lines and
// lines holding only a comma or a bullet; those are folded back into sentences.
export function tidyText(text: string): string {
  return text
    .replace(/\n[ \t]*([,;:.)\]])[ \t]*(?=\n)/g, "$1")
    .replace(/([,;:])\n[ \t]*/g, "$1 ")
    .replace(/\n[ \t]*[-•*][ \t]*(?=\n)/g, "")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Text of an HTML fragment, read with a real parser: tag attributes that contain ">" (Tailwind classes such as
// "[&>span]:line-clamp-1") cannot leak into the text, and block elements become line breaks.
const BLOCK = "p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,section,article,header,footer,tr,table,blockquote,pre,dt,dd";

export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,template,svg").remove();
  $("br").replaceWith("\n");
  $("li").each((_, el) => void $(el).prepend("- "));
  $(BLOCK).each((_, el) => void $(el).append("\n"));
  return tidyText(
    $.root()
      .text()
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n\s*\n+/g, "\n")
      .trim(),
  );
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
// "400–550 triệu/năm", "$60,000 per year": yearly figures are turned into monthly ones, which the score expects.
// The yearly marker must sit right after the amount ("550 triệu đồng/năm", "$60,000 per year") or name the salary
// as yearly ("lương năm", "annual salary"); "review lương hàng năm" after a monthly range is not one. A monthly
// marker anywhere wins.
const PER_YEAR = /(triệu|tr\b|million|\bm\b|usd|\$|\d)\s*(đồng|vnđ|vnd)?\s*(\/\s*(năm|year|yr|annum)\b|(mỗi|một) năm|per (year|annum)|a year\b|annually|yearly|\bp\.a\.(?!\w))|(lương|thu nhập|tổng thu nhập) (theo )?năm|annual (salary|compensation|base)|yearly salary/i;
const PER_MONTH = /\/\s*(tháng|month|mo)\b|(mỗi|một|hàng) tháng|per month|monthly|a month\b/i;

// No monthly pay in this market reaches $20,000; a figure that high is a yearly one written without "/year"
// ("The pay range for this role is $164,200 - $295,600").
const USD_YEARLY_FLOOR = 20_000;

export function parseSalary(input: string): Salary | null {
  const salary = parseSalaryAmount(input);
  const yearlyUsd = salary?.currency === "USD" && (salary.max ?? salary.min ?? 0) >= USD_YEARLY_FLOOR;
  if (!salary || ((!PER_YEAR.test(input) || PER_MONTH.test(input)) && !yearlyUsd)) return salary;
  const monthly = (v: number | null) => (v === null ? null : Math.round(v / 12));
  return { ...salary, min: monthly(salary.min), max: monthly(salary.max) };
}

function parseSalaryAmount(input: string): Salary | null {
  // "15 triệu - 40 triệu" reads as "15 - 40 triệu".
  const s = input.replace(/\s+/g, " ").replace(/(\d)\s*(triệu|tr)\s*(-|–|~|đến|to)\s*(\d)/gi, "$1 $3 $4");
  const num = (v: string) => Number(v.replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));

  const vnd = /(?:(?:từ|from)\s*)?(\d{1,3}(?:[.,]\d)?)\s*(?:-|–|~|to|đến)\s*(\d{1,3}(?:[.,]\d)?)\s*(?:triệu|tr\b|m\b|million)/i.exec(s);
  if (vnd) return { min: num(vnd[1]) * MILLION, max: num(vnd[2]) * MILLION, currency: "VND" };
  const vndUpTo = /(?:up to|lên (?:đến|tới)|tới|đến|max)\s*(\d{1,3}(?:[.,]\d)?)\s*(?:triệu|tr\b|m\b|million)/i.exec(s);
  if (vndUpTo) return { min: null, max: num(vndUpTo[1]) * MILLION, currency: "VND" };
  const vndFrom = /(?:từ|from|trên|over)\s*(\d{1,3}(?:[.,]\d)?)\s*(?:triệu|tr\b|m\b|million)/i.exec(s);
  if (vndFrom) return { min: num(vndFrom[1]) * MILLION, max: null, currency: "VND" };

  // "$1,500 - 2,000", "800 - 1200 USD", "$164,200 - $295,600" (three-digit amounts count when a currency is named).
  // An amount starts at a number's first digit, so "$164,200" is never read from its tail as "64,200".
  const usd = /(?<![\d.,])\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{3,6})\s*(?:-|–|~|to)\s*\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{3,6})\s*(?:usd|\$)?/i.exec(s);
  if (usd && (/usd|\$/i.test(usd[0]))) return { min: num(usd[1]), max: num(usd[2]), currency: "USD" };
  const usdUpTo = /(?:up to|lên (?:đến|tới)|tới|max)\s*\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\s*(usd|\$)?/i.exec(s);
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
  if (/\b(intern|internship|thực tập)\b/i.test(t)) level = "intern";
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
  // Lines about the company's own track record ("we have 10 years of experience in outsourcing") are skipped.
  const COMPANY_RECORD = /\b(we|our company|our team|the company)\b[^.\n]{0,30}\b(have|has|bring|with)\b|chúng tôi (có|với)|công ty (có|với)|thành lập|founded|established/i;
  const experienceLines = text.split("\n").filter((l) => /experience|kinh nghiệm|\bexp\b|\bKN\b/i.test(l) && !COMPANY_RECORD.test(l)).join("\n");
  const yearsHit = firstMatch(title, YEARS) ?? firstMatch(experienceLines, YEARS) ?? firstMatch(text, YEARS);
  // Company age ("23+ years of expertise") is not a requirement; no posting here asks for more than 15 years.
  const years = yearsHit && Number(yearsHit.match[1]) <= 15 ? Number(yearsHit.match[1]) : null;
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
  // A remote role, not a remote perk ("remote working on Fridays", "work from home 2 days a week").
  const remote = firstMatch(text, /fully remote|100% remote|remote[- ]first|remote (position|job|role)|this (is a|role is) remote|work(ing)? fully remote(ly)?|làm việc từ xa (hoàn toàn|100%)|full[- ]time remote/i);
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
  // The requirement word must sit next to the language ("tiếng Nhật N2", "good Japanese", "Japanese (required)");
  // "a Japanese company offering good benefits" is about the employer, not a requirement.
  const LANG = "tiếng nhật|japanese|tiếng hàn|korean|tiếng trung|chinese|mandarin";
  const REQUIRED = new RegExp(
    `\\bn[1-3]\\b|jlpt|topik|\\bhsk\\b|(${LANG})\\s*[:(-]?\\s*(trở lên|thành thạo|giao tiếp|business|fluent|required|bắt buộc|tốt|giỏi|native|proficien|level)|` +
      `(thành thạo|giao tiếp|business[- ]level|fluent|good|excellent|native|proficient|giỏi|biết)\\s+(in\\s+)?(${LANG})|(speak|read|write|communicate)[^.\\n]{0,20}(${LANG})`,
    "i",
  );
  const ABOUT_EMPLOYER = /(japanese|korean|chinese) (company|client|customer|market|partner|owned|firm|corporation|enterprise)|(công ty|khách hàng|đối tác|doanh nghiệp|thị trường) (nhật|hàn|trung)/i;
  for (const line of text.split("\n")) {
    for (const [name, re] of NAMES) {
      if (!re.test(line) || NOT_REQUIRED.test(line) || !REQUIRED.test(line) || (ABOUT_EMPLOYER.test(line) && !/\bn[1-3]\b|jlpt|topik|hsk/i.test(line))) continue;
      const level = /\bn([1-3])\b/i.exec(line);
      return { language: level && name === "Japanese" ? `Japanese N${level[1]}` : name, excerpt: line.trim().slice(0, 240) };
    }
  }
  return { language: null };
}

export function detectAbroad(text: string): { abroad: boolean; excerpt?: string } {
  const hit = firstMatch(text, /(onsite|làm việc|đào tạo|travel|business trip)[^.\n]{0,40}(nhật bản|japan|singapore|(?<!\p{L})úc(?!\p{L})|australia|(?<!\p{L})mỹ(?!\p{L})|usa|europe|châu âu)/iu);
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
  // "Vận hành" also names plant, machine and sales operations; those are other trades.
  if (/lò hơi|máy nén|nhà máy|điện gió|điện mặt trời|vận hành máy|cơ điện|bảo trì máy|kinh doanh|bán hàng|\bsales\b|presales?|kế toán|marketing|chăm sóc khách hàng|xây dựng|sản xuất/i.test(title) && !/devops|sre|site reliability|cloud|kubernetes/i.test(title)) return false;
  // Infra, system and network roles stay even when titled "developer" ("Lập trình viên Infra-system-Network").
  if (/\bdata (engineer|scientist|analyst)|\bdeveloper\b|lập trình viên/i.test(title) && !/devops|sre|site reliability|infra|system|network|hạ tầng|hệ thống|\bmạng\b/i.test(title)) return false;
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
// Other Vietnamese cities, and offices abroad that sister sites list next to the HCMC ones ("Japan Office").
const OTHER_CITY = /hà nội|ha noi|hanoi|đà nẵng|da nang|danang|hải phòng|hai phong|cần thơ|can tho|nha trang|huế|bắc ninh|bac ninh|bình dương|binh duong|đồng nai|dong nai|biên hòa|bien hoa|long an|vũng tàu|vung tau|bà rịa|ba ria|hồ tràm|ho tram|bắc giang|hưng yên|vĩnh phúc|thái nguyên|quảng ninh|hạ long|đà lạt|quy nhơn|bình định|thuận an|dĩ an|tân uyên|vinh\b|japan office|văn phòng nhật bản|tokyo|osaka/i;

// Places abroad, as they appear in a location, a title ("- Thailand, Bangkok") or a career-site address ("/REF5842J-Leeds").
const ABROAD = /\b(japan|tokyo|osaka|singapore|thailand|bangkok|malaysia|kuala lumpur|indonesia|jakarta|philippines|manila|india|bangalore|bengaluru|pune|hyderabad|australia|sydney|melbourne|new zealand|united kingdom|england|london|leeds|manchester|ireland|dublin|germany|berlin|munich|switzerland|zurich|z[uü]rich|bern|geneva|denmark|copenhagen|aarhus|belgium|brussels|netherlands|amsterdam|france|paris|poland|warsaw|krakow|lithuania|vilnius|serbia|belgrade|romania|bucharest|spain|madrid|portugal|lisbon|sweden|stockholm|norway|oslo|finland|helsinki|usa|united states|new york|san francisco|seattle|canada|toronto|vancouver|korea|seoul|china|shanghai|beijing|hong kong|taiwan|taipei|dubai|nepal|kathmandu|mumbai|delhi|noida|gurgaon|gurugram|chennai|kolkata|ahmedabad|sri lanka|colombo|bangladesh|dhaka|pakistan|karachi|lahore|islamabad|cambodia|phnom penh|myanmar|yangon|laos|vientiane|egypt|cairo|nigeria|lagos|kenya|nairobi|south africa|cape town|brazil|são paulo|sao paulo|argentina|buenos aires|colombia|bogot[aá]|mexico|chile|santiago|peru|lima|turkey|istanbul|israel|tel aviv|ukraine|kyiv|greece|athens|italy|milan|rome|austria|vienna|czech|prague|hungary|budapest|bulgaria|sofia|croatia|zagreb|estonia|tallinn|latvia|riga)\b|metropolitan (region|area)(?![^,]*h[oồ] ch[ií] minh)/i;

// HCMC or remote. Remote work for a company abroad is welcome; going to an office abroad or in another
// Vietnamese city is not. `other` is the title and address, where career sites often put the city.
// Regions a remote posting may be limited to that leave Vietnam out ("Remote - US", "Europe only", "CET +/- 3 h").
// Regions that include someone working from Vietnam. "Remote (Milan)", "Panama - Remote" or "Remote, US" name a
// country of residence elsewhere and are not open; a bare "Remote" names nothing and is judged on its text.
// Places in Vietnam count too: a Vietnamese company's remote role is listed under its office city.
const REMOTE_OPEN = /worldwide|anywhere|global|everywhere|vietnam|việt nam|viet nam|\bapac\b|asia|gmt\s*\+\s*[5-9]|utc\s*\+\s*[5-9]|\bict\b|ho chi minh|hồ chí minh|\bhcm|sài gòn|saigon|hà nội|ha noi|hanoi|đà nẵng|da nang|cần thơ|hải phòng/i;

export function remoteOpenToVietnam(region: string): boolean {
  if (/anywhere in (the )?(us|u\.s\.|usa|united states|uk|europe|eu|canada|latam|americas?)\b/i.test(region)) return false;
  return !region.trim() || REMOTE_OPEN.test(region);
}

// A role whose location is only "Remote" is kept when its text opens it to the world or this region; on company
// boards abroad "Remote" alone usually means remote within the company's own country.
const OPEN_WIDELY = /work from anywhere|from anywhere|anywhere in the world|worldwide|fully distributed|globally distributed|any (time ?zone|country|location)|\bapac\b|asia[- ]pacific|southeast asia|vietnam|gmt\s*\+\s*7|utc\s*\+\s*7/i;

export function bareRemote(location: string): boolean {
  return location.replace(/[()\s\-–,]/g, "").toLowerCase() === "remote";
}

export function openWidely(description: string): boolean {
  return OPEN_WIDELY.test(description);
}

// A plain "Remote" role whose text limits it to one country or region elsewhere.
const ELSEWHERE_ONLY = /\b(u\.?s\.? citizen(ship)?|security clearance|clearance (is )?required|green card|work permit for the (us|uk|eu))\b|(must|need to|required to) (be )?(located|based|reside|live|work) (in|from) (the )?(us|u\.s\.|united states|usa|canada|uk|united kingdom|europe|eu|emea|latam|india)\b|\b(us|u\.s\.|usa|uk|eu)[- ]based (candidates|applicants|only)|\b(us|usa|u\.s\.|uk|eu|europe) only\b|(eligible|authori[sz]ed|legally able) to work in the (us|u\.s\.|united states|uk|united kingdom|eu)\b/i;

export function remoteElsewhereOnly(description: string): boolean {
  return ELSEWHERE_ONLY.test(description);
}

export function isWantedLocation(location: string, workMode: WorkMode, other = ""): boolean {
  if (workMode === "remote") return remoteOpenToVietnam(location);
  if (HCMC.test(location)) return true;
  if (ABROAD.test(location) || ABROAD.test(other.replace(/[-_/%]+/g, " "))) return false;
  return !OTHER_CITY.test(location);
}

// Workday puts a role's primary place in the URL ("/job/Austin-TX/…") and shows "2 Locations" when there are more.
// A primary place outside Vietnam, in a posting whose text never mentions Vietnam, is an office abroad.
export function workdayAbroad(urls: string, text: string): boolean {
  const places = [...urls.matchAll(/myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[^/\s]+\/job\/([^/\s]+)\//gi)].map((m) => m[1]);
  if (!places.length) return false;
  const local = places.some((place) => {
    const words = decodeURIComponent(place).replace(/[-_]+/g, " ");
    return HCMC.test(words) || /viet ?nam|việt nam|remote/i.test(words);
  });
  return !local && !/viet ?nam|việt nam|h[oồ] ch[ií] minh|\bhcm\b/i.test(text);
}

// A location naming remote work ("Remote (...)" from remote boards, "Remote - APAC" from ATS boards) settles the work
// mode even when the description does not say.
export function extractFacts(input: { title: string; text: string; tags?: string[]; salaryText?: string; location?: string }): Facts {
  const all = `${input.title}\n${(input.tags ?? []).join(", ")}\n${input.text}`;
  const excerpts: Record<string, string> = {};
  const salary = parseSalary(input.salaryText ?? "") ?? parseSalary(input.title) ?? parseSalaryFromText(input.text, excerpts);
  if (salary && input.salaryText) excerpts.salary = input.salaryText;
  const level = detectLevel(input.title, input.text);
  if (level.excerpt) excerpts.years = level.excerpt;
  const mode = /\bremote\b/i.test(input.location ?? "")
    ? { mode: "remote" as const, excerpt: input.location }
    : detectWorkMode(`${(input.tags ?? []).join("\n")}\n${input.text}`, input.title);
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
