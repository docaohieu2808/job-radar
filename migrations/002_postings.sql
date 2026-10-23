-- Cross-source dedupe, repost tracking and digest bookkeeping.
ALTER TABLE jobs
  ADD COLUMN dedupe_key   text,
  ADD COLUMN reposted_at  timestamptz,
  ADD COLUMN alerted_at   timestamptz,
  ADD COLUMN digested_at  timestamptz,
  ADD COLUMN posted_at    timestamptz;
CREATE INDEX jobs_dedupe_key ON jobs (dedupe_key);

-- Small key/value state: last digest time and similar.
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
