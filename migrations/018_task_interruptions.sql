-- How many times in a row a task was cut off mid-run (its worker crashed or it hung past the stale limit).
-- A task that keeps killing the worker is quarantined instead of being picked up again on every restart.
ALTER TABLE crawl_queue ADD COLUMN IF NOT EXISTS interrupted integer NOT NULL DEFAULT 0;
