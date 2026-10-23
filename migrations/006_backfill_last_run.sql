-- Tasks finished before last_run_at existed: their finish time is when they last ran.
UPDATE crawl_queue SET last_run_at = done_at WHERE last_run_at IS NULL AND done_at IS NOT NULL;
