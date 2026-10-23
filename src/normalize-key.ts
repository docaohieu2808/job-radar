// Company and title keys for matching the same posting across sources. Pure, shared with the web screens.
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\b(cong ty|company|co\.?,? ?ltd|jsc|tnhh|co phan|corporation|corp|vietnam|viet nam|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
