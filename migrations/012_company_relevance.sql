-- Best-first frontier: how likely a company is to have a DevOps opening, with the reasons, recomputed hourly.
ALTER TABLE companies ADD COLUMN relevance integer NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN relevance_reasons jsonb NOT NULL DEFAULT '[]';
