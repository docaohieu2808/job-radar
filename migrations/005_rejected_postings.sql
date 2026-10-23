-- Postings read once and not kept (wrong title, place or work mode). Remembered so search pages
-- do not send the crawler back to them every run.
CREATE TABLE rejected_postings (
  source      text NOT NULL,
  external_id text NOT NULL,
  reason      text NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, external_id)
);
