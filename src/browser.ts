// Headless Chromium for career pages built in JavaScript (an empty shell until scripts run). One browser, one page
// at a time, started on first use and closed after a few idle minutes so it holds no memory between batches.
import { chromium, type Browser } from "playwright-core";

const CHROMIUM = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";
const IDLE_CLOSE_MS = 5 * 60_000;
const PAGE_TIMEOUT_MS = 30_000;
const USER_AGENT = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 JobRadar";

let browser: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

function launch(): Promise<Browser> {
  browser ??= chromium.launch({ executablePath: CHROMIUM, args: ["--disable-dev-shm-usage", "--no-sandbox"] }).catch((err) => {
    browser = null;
    throw err;
  });
  return browser;
}

async function closeWhenIdle(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const b = browser;
    browser = null;
    void b?.then((x) => x.close()).catch(() => undefined);
  }, IDLE_CLOSE_MS);
  idleTimer.unref();
}

// The page's HTML after its scripts ran. Images, fonts and media are not loaded.
export function renderPage(url: string): Promise<string> {
  const run = async () => {
    const context = await (await launch()).newContext({ userAgent: USER_AGENT, locale: "vi-VN" });
    try {
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
      );
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      // Listings usually arrive from an API shortly after the shell; wait for the network to settle, but not forever.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      return await page.content();
    } finally {
      await context.close();
      void closeWhenIdle();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
