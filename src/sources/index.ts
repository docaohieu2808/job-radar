// All sources, their handlers and seeds in one place.
import { pool } from "../db.js";
import { enqueue } from "../queue.js";
import type { Handler } from "../handlers/index.js";
import { itviec } from "./itviec.js";
import { linkedin } from "./linkedin.js";
import { topdev } from "./topdev.js";
import { vietnamworks } from "./vietnamworks.js";
import { career } from "./career.js";
import { directory } from "./directory.js";
import { remoteBoards } from "./remote-boards.js";
import { discovery } from "./discovery.js";
import { translation } from "../translate.js";
import type { Source } from "./types.js";

export const sources: Source[] = [linkedin, itviec, topdev, vietnamworks, remoteBoards, career, directory, discovery, translation];

export const sourceHandlers: Record<string, Handler> = Object.assign({}, ...sources.map((s) => s.handlers));

// Makes sure every recurring search task and host interval exists; safe to run at every start.
export async function seedSources(): Promise<void> {
  for (const source of sources) {
    for (const seed of source.seeds) await enqueue(seed.kind, seed.url, { priority: seed.priority });
    for (const [host, seconds] of Object.entries(source.hostIntervalSeconds ?? {})) {
      await pool.query(
        "INSERT INTO hosts (host, min_interval_s) VALUES ($1, $2) ON CONFLICT (host) DO UPDATE SET min_interval_s = EXCLUDED.min_interval_s",
        [host, seconds],
      );
    }
  }
}
