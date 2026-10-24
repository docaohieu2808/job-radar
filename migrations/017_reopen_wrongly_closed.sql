-- Postings closed by the old seven-day rule that the new rule (a month for board postings) keeps open.
UPDATE jobs j SET closed_at = NULL
 WHERE j.closed_at IS NOT NULL AND j.last_seen_at > now() - interval '30 days'
   AND EXISTS (SELECT 1 FROM job_sources s WHERE s.job_id = j.id AND s.source <> 'career');
