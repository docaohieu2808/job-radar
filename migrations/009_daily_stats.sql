-- One row per day of crawling, recorded hourly, for the one-week run the plan asks for: how many hosts were
-- worked, the busiest host's load, errors, and whether the crawler kept going.
CREATE TABLE daily_stats (
  day             date PRIMARY KEY,
  pages           integer NOT NULL,
  tasks           integer NOT NULL,
  errors          integer NOT NULL,
  hosts_worked    integer NOT NULL,
  busiest_host    text,
  busiest_tasks   integer NOT NULL,
  linkedin_tasks  integer NOT NULL,
  idle_hours      integer NOT NULL DEFAULT 0,
  companies       integer NOT NULL,
  career_found    integer NOT NULL,
  postings        integer NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now()
);
