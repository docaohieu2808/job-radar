// Task handlers by kind. Each source adds its own kinds in later phases.
import type { Task } from "../queue.js";

export type HandlerResult = {
  // Schedule the same task again after this many seconds (recurring pages); omit for one-off tasks.
  recrawlAfterSeconds?: number;
  fetched?: number;
  llmCalls?: number;
};

export type Handler = (task: Task) => Promise<HandlerResult>;

// Lets the queue be exercised end to end without touching any real source.
const noop: Handler = async () => ({});

export const handlers: Record<string, Handler> = {
  noop,
};

// Thrown by a handler when the host refused us (429/403); the worker pauses the host instead of retrying it hot.
// retryAfterSeconds is the host's own Retry-After when it sent one.
export class HostRefusedError extends Error {
  constructor(public readonly status: number, public readonly retryAfterSeconds: number | null) {
    super(`host refused with ${status}`);
  }
}
