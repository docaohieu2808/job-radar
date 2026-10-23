// What every source provides: its task handlers and the recurring search tasks that start crawling.
import type { Handler } from "../handlers/index.js";

export type Seed = { kind: string; url: string; priority: number };

export type Source = {
  name: string;
  handlers: Record<string, Handler>;
  seeds: Seed[];
  // Minimum seconds between two requests to this source's host.
  hostIntervalSeconds?: Record<string, number>;
};

export const HOUR = 3600;
