-- Foreign keys used in joins had no index; with thousands of companies the state query scanned career_pages once
-- per company (about 6 s per page load).
CREATE INDEX IF NOT EXISTS career_pages_company ON career_pages (company_id);
CREATE INDEX IF NOT EXISTS job_sources_job ON job_sources (job_id);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs (company_id);
CREATE INDEX IF NOT EXISTS applications_job ON applications (job_id);
CREATE INDEX IF NOT EXISTS domain_candidates_company ON domain_candidates (company_id);
CREATE INDEX IF NOT EXISTS crawl_queue_kind ON crawl_queue (kind);
