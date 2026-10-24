-- claim() now checks that no other task of the same host is in flight; this keeps that check cheap.
CREATE INDEX IF NOT EXISTS crawl_queue_locked_host ON crawl_queue (host) WHERE locked_at IS NOT NULL;
-- Recurring searches that died after five failures before the fix: bring them back.
UPDATE crawl_queue SET done_at = NULL, attempts = 0, next_fetch_at = now()
 WHERE done_at IS NOT NULL AND (kind LIKE '%-search' OR kind LIKE 'directory-%');
