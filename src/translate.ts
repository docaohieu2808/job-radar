// Vietnamese for English postings, through the LLM on the same node: a summary to skim (what the job is, the main
// requirements, the benefits, the catches) and, on request, a full translation of the description.
import { pool } from "./db.js";
import { askJson } from "./llm.js";
import { config } from "./config.js";
import { enqueue } from "./queue.js";
import { isVietnameseText } from "./extract.js";
import type { Source } from "./sources/types.js";

export type ViSummary = { summary: string; requirements: string[]; benefits: string[]; notes: string[] };

const SUMMARY_SYSTEM =
  "Bạn tóm tắt một tin tuyển dụng cho một kỹ sư DevOps người Việt, đọc tiếng Anh còn chậm. Trả JSON " +
  '{"summary":string,"requirements":string[],"benefits":string[],"notes":string[]}. ' +
  "summary: 2–3 câu tiếng Việt, công việc chính là gì, làm cho ai. requirements: tối đa 6 ý yêu cầu chính. " +
  "benefits: tối đa 6 ý phúc lợi, lương, thưởng, chế độ làm việc. notes: điểm cần để ý trước khi nộp, ví dụ mức tiếng Anh, " +
  "chỉ nhận người ở nước nào, số năm kinh nghiệm, ca làm, chứng chỉ bắt buộc. Viết tiếng Việt ngắn gọn, giữ nguyên tên công nghệ " +
  "và chức danh bằng tiếng Anh (Kubernetes, Terraform, SRE). Không thêm thông tin không có trong tin; mục nào tin không nói thì để mảng rỗng.";

const FULL_SYSTEM =
  'Dịch tin tuyển dụng sau sang tiếng Việt tự nhiên. Trả JSON {"text":string}. Giữ các đoạn và gạch đầu dòng như bản gốc, ' +
  "giữ nguyên tên công nghệ, tên sản phẩm và chức danh bằng tiếng Anh. Không tóm tắt, không thêm ý.";

// Queued for every English posting that reaches the Inbox; paced on the LLM host like any other.
export async function queueSummary(jobId: number): Promise<void> {
  if (!config.llmBaseUrl) return;
  await enqueue("translate-summary", `${config.llmBaseUrl.replace(/\/+$/, "")}/summary/${jobId}`, { priority: 40, payload: { jobId } });
}

export function needsSummary(text: string): boolean {
  return text.trim().length > 200 && !isVietnameseText(text);
}

// The summary, made now if it does not exist; null when the LLM is unavailable or over today's budget.
export async function summarize(jobId: number): Promise<ViSummary | null> {
  const { rows } = await pool.query<{ title: string; company_name: string; description: string | null; vi_summary: ViSummary | null }>(
    "SELECT title, company_name, description, vi_summary FROM jobs WHERE id = $1", [jobId],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.vi_summary) return r.vi_summary;
  const v = await askJson<Partial<ViSummary>>(SUMMARY_SYSTEM, `${r.title} — ${r.company_name}\n\n${(r.description ?? "").slice(0, 12_000)}`, "translate");
  if (!v || typeof v.summary !== "string") return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, 8) : []);
  const summary: ViSummary = { summary: v.summary.trim(), requirements: list(v.requirements), benefits: list(v.benefits), notes: list(v.notes) };
  await pool.query("UPDATE jobs SET vi_summary = $2 WHERE id = $1", [jobId, JSON.stringify(summary)]);
  return summary;
}

export async function translateFull(jobId: number): Promise<string | null> {
  const { rows } = await pool.query<{ description: string | null; vi_full: string | null }>("SELECT description, vi_full FROM jobs WHERE id = $1", [jobId]);
  const r = rows[0];
  if (!r) return null;
  if (r.vi_full) return r.vi_full;
  const v = await askJson<{ text?: string }>(FULL_SYSTEM, (r.description ?? "").slice(0, 16_000), "translate");
  if (!v?.text?.trim()) return null;
  await pool.query("UPDATE jobs SET vi_full = $2 WHERE id = $1", [jobId, v.text.trim()]);
  return v.text.trim();
}

const llmHost = (() => {
  try {
    return new URL(config.llmBaseUrl).host;
  } catch {
    return "";
  }
})();

export const translation: Source = {
  name: "translate",
  seeds: [],
  hostIntervalSeconds: llmHost ? { [llmHost]: 3 } : {},
  handlers: {
    // Over today's budget or the LLM down: try again in six hours.
    "translate-summary": async (task) => ((await summarize(Number(task.payload.jobId))) ? {} : { recrawlAfterSeconds: 6 * 3600 }),
  },
};

// Every open, untriaged English posting in the Inbox without a summary yet (after the feature ships).
export async function queueInboxSummaries(inboxMin: number): Promise<number> {
  const { rows } = await pool.query<{ id: string; description: string | null }>(
    `SELECT j.id, j.description FROM jobs j JOIN applications a ON a.job_id = j.id
      WHERE j.closed_at IS NULL AND a.status = 'new' AND j.score >= $1 AND j.vi_summary IS NULL`,
    [inboxMin],
  );
  let n = 0;
  for (const r of rows) if (needsSummary(r.description ?? "")) {
    await queueSummary(Number(r.id));
    n++;
  }
  return n;
}
