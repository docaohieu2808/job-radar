-- Link discovery: other sites that company pages link to. Each is checked once ("is this an IT company in
-- Vietnam or one hiring remotely?") and either becomes a company or is remembered as rejected.
CREATE TABLE domain_candidates (
  domain       text PRIMARY KEY,
  found_on     text NOT NULL,
  from_company bigint REFERENCES companies(id) ON DELETE SET NULL,
  hops         integer NOT NULL,
  status       text NOT NULL DEFAULT 'pending',   -- pending | accepted | rejected | error
  score        integer,
  decided_by   text,                               -- rules | llm
  reason       text,
  company_id   bigint REFERENCES companies(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  checked_at   timestamptz
);
CREATE INDEX domain_candidates_status ON domain_candidates (status);

-- How many links away from a known source a company was found (0 = boards, directory, owner).
ALTER TABLE companies ADD COLUMN discovery_hops integer NOT NULL DEFAULT 0;
