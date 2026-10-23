// Runtime settings, read once from the environment.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "",
  llmApiKey: process.env.LLM_API_KEY ?? "",
  llmModel: process.env.LLM_MODEL ?? "",
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  userAgent: process.env.USER_AGENT ?? "Mozilla/5.0 (compatible; JobRadarBot/0.1; +mailto:contact@docaohieu.com)",
  // A claimed task whose worker died is released after this long.
  staleLockMinutes: 10,
};
