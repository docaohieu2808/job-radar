-- When each task last ran, for the "Last checked" column on the Sources screen.
ALTER TABLE crawl_queue ADD COLUMN last_run_at timestamptz;
