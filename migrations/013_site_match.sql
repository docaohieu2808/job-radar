-- How sure the registry is that a company's website really is that company's (0–100), and why.
ALTER TABLE companies ADD COLUMN site_match integer;
ALTER TABLE companies ADD COLUMN site_match_reasons jsonb NOT NULL DEFAULT '[]';
