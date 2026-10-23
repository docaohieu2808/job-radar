-- Core schema: companies and their career pages, the crawl frontier, postings and the owner's pipeline.

CREATE TABLE companies (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  website       text,
  district      text,
  discovered_via text NOT NULL DEFAULT 'manual',
  watch         boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE career_pages (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url             text NOT NULL UNIQUE,
  kind            text NOT NULL CHECK (kind IN ('board', 'ats', 'custom')),
  ats_kind        text,
  needs_browser   boolean NOT NULL DEFAULT false,
  content_hash    text,
  status          text NOT NULL DEFAULT 'unknown',
  last_fetched_at timestamptz,
  last_changed_at timestamptz
);

-- One row per host: robots.txt cache and the politeness clock.
CREATE TABLE hosts (
  host              text PRIMARY KEY,
  robots_txt        text,
  robots_fetched_at timestamptz,
  min_interval_s    integer NOT NULL DEFAULT 30,
  next_allowed_at   timestamptz NOT NULL DEFAULT now(),
  blocked_until     timestamptz
);

-- The frontier. A row is a unit of work; workers claim rows with FOR UPDATE SKIP LOCKED.
CREATE TABLE crawl_queue (
  id            bigserial PRIMARY KEY,
  kind          text NOT NULL,
  url           text NOT NULL,
  host          text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  priority      integer NOT NULL DEFAULT 100,
  next_fetch_at timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  last_error    text,
  locked_at     timestamptz,
  done_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, url)
);
CREATE INDEX crawl_queue_due ON crawl_queue (priority, next_fetch_at) WHERE done_at IS NULL AND locked_at IS NULL;

CREATE TABLE jobs (
  id              bigserial PRIMARY KEY,
  company_id      bigint REFERENCES companies(id),
  company_name    text NOT NULL,
  title           text NOT NULL,
  salary_min      numeric,
  salary_max      numeric,
  currency        text,
  location        text,
  work_mode       text,
  level           text,
  years           numeric,
  stack           jsonb NOT NULL DEFAULT '[]',
  benefits        jsonb NOT NULL DEFAULT '[]',
  english_required text,
  cert_support    boolean,
  description     text,
  raw_excerpts    jsonb NOT NULL DEFAULT '{}',
  content_hash    text NOT NULL,
  score           integer,
  score_reasons   jsonb NOT NULL DEFAULT '[]',
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz
);
CREATE INDEX jobs_open_score ON jobs (score DESC) WHERE closed_at IS NULL;
CREATE INDEX jobs_content_hash ON jobs (content_hash);

-- Where a posting was seen. The same posting on several boards is one job with several sources.
CREATE TABLE job_sources (
  id            bigserial PRIMARY KEY,
  job_id        bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  source        text NOT NULL,
  external_id   text NOT NULL,
  url           text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  missing_runs  integer NOT NULL DEFAULT 0,
  UNIQUE (source, external_id)
);

CREATE TABLE applications (
  job_id     bigint PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'new'
             CHECK (status IN ('new', 'interested', 'applied', 'interviewing', 'offer', 'skipped')),
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE crawl_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  kind        text NOT NULL,
  fetched     integer NOT NULL DEFAULT 0,
  errors      integer NOT NULL DEFAULT 0,
  llm_calls   integer NOT NULL DEFAULT 0,
  detail      jsonb NOT NULL DEFAULT '{}'
);
