// Telegram delivery: digests and alerts out, a few commands in. Only the owner's chat is answered.
import { config } from "./config.js";

const api = (method: string) => `https://api.telegram.org/bot${config.telegramToken}/${method}`;

export function telegramEnabled(): boolean {
  return Boolean(config.telegramToken && config.telegramChatId);
}

export async function sendMessage(text: string): Promise<void> {
  if (!telegramEnabled()) {
    console.log(`[telegram disabled] ${text}`);
    return;
  }
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
  });
  if (!res.ok) throw new Error(`telegram sendMessage ${res.status}: ${await res.text()}`);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Update = { update_id: number; message?: { chat: { id: number }; text?: string } };
export type CommandHandler = (command: string) => Promise<string>;

// Long-polls for commands until the signal aborts.
export async function pollCommands(onCommand: CommandHandler, signal: AbortSignal): Promise<void> {
  if (!telegramEnabled()) return;
  let offset = 0;
  while (!signal.aborted) {
    try {
      const res = await fetch(api(`getUpdates?timeout=50&offset=${offset}`), { signal });
      const body = (await res.json()) as { ok: boolean; result: Update[] };
      for (const update of body.result ?? []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg?.text || String(msg.chat.id) !== config.telegramChatId) continue;
        const command = msg.text.trim().split(/\s+/)[0].split("@")[0];
        await sendMessage(await onCommand(command));
      }
    } catch (err) {
      if (signal.aborted) return;
      console.error("telegram poll failed", err);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}
