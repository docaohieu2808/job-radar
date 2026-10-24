// Vietnamese for English postings: the summary made when the posting reached the Inbox (what the job is, main
// requirements, benefits, catches), and a full translation on request. Shown above the original description.
import { useState } from "react";
import { css } from "./css";
import { api, type DescriptionView } from "./api";

export function VietnameseSection({ id, desc, onUpdate }: { id: number; desc: DescriptionView; onUpdate: (d: DescriptionView) => void }) {
  const [busy, setBusy] = useState<"summary" | "full" | null>(null);
  const [failed, setFailed] = useState(false);
  const [showFull, setShowFull] = useState(false);
  if (!desc.english) return null;
  const run = async (kind: "summary" | "full") => {
    setBusy(kind);
    setFailed(false);
    try {
      onUpdate(await api.translate(id, kind === "full"));
      if (kind === "full") setShowFull(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  const s = desc.viSummary;
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div style={css("margin-top:12px")}>
        <div style={css("font-size:13px;font-weight:600;color:var(--ink2)")}>{title}</div>
        <ul style={css("margin:4px 0 0;padding-left:18px;font-size:14px;line-height:22px;color:var(--ink)")}>
          {items.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      </div>
    );
  const button = (label: string, kind: "summary" | "full") => (
    <button onClick={() => void run(kind)} disabled={busy !== null} className="hv-ctl press"
      style={css("height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px;font-weight:500;cursor:pointer")}>
      {busy === kind ? "Đang dịch…" : label}
    </button>
  );
  return (
    <section lang="vi">
      <h3 style={css("margin:0;font-size:14px;font-weight:600")}>Tiếng Việt</h3>
      <p style={css("margin:4px 0 0;font-size:13px;color:var(--ink3)")}>Gemini tóm tắt từ bản gốc; chi tiết quan trọng thì đối chiếu bản gốc bên dưới.</p>
      {s ? (
        <div style={css("margin-top:12px;max-width:640px")}>
          <p style={css("margin:0;font-size:14px;line-height:22px;color:var(--ink)")}>{s.summary}</p>
          {list("Yêu cầu chính", s.requirements)}
          {list("Phúc lợi", s.benefits)}
          {list("Cần để ý", s.notes)}
        </div>
      ) : (
        <p style={css("margin:12px 0 0;font-size:14px;color:var(--ink2)")}>Chưa có bản tóm tắt.</p>
      )}
      <div style={css("margin-top:12px;display:flex;gap:8px;flex-wrap:wrap")}>
        {!s && button("Tóm tắt ngay", "summary")}
        {desc.viFull
          ? <button onClick={() => setShowFull(!showFull)} className="hv-ctl press" style={css("height:32px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:var(--sheet);font-size:13px;font-weight:500;cursor:pointer")}>{showFull ? "Ẩn bản dịch đầy đủ" : "Xem bản dịch đầy đủ"}</button>
          : button("Dịch toàn bộ", "full")}
      </div>
      {failed && <p style={css("margin:8px 0 0;font-size:13px;color:var(--warn)")}>Chưa dịch được (LLM bận hoặc hết lượt hôm nay). Thử lại sau.</p>}
      {showFull && desc.viFull && (
        <p style={css("margin:12px 0 0;font-size:14px;line-height:22px;color:var(--ink);white-space:pre-line;max-width:640px")}>{desc.viFull}</p>
      )}
    </section>
  );
}
