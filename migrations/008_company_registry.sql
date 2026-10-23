-- Companies are keyed by their normalized name (the same key postings are grouped by), not the raw name,
-- so "Endava Việt Nam" and "Endava Vietnam" are one company. Career-page discovery state lives here too.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_name_key;
ALTER TABLE companies
  ADD COLUMN key text,
  ADD COLUMN website_source text,
  ADD COLUMN career_status text NOT NULL DEFAULT 'unknown'
    CHECK (career_status IN ('unknown', 'found', 'none', 'needs_browser', 'error')),
  ADD COLUMN career_checked_at timestamptz;
CREATE UNIQUE INDEX companies_key ON companies (key);

ALTER TABLE career_pages
  ADD COLUMN check_interval_s integer NOT NULL DEFAULT 86400,
  ADD COLUMN depth integer NOT NULL DEFAULT 0,
  ADD COLUMN postings_found integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text;
