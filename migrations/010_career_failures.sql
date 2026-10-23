-- Failed reads of a company site in a row: the retry waits 1 day, then 7, then 30.
ALTER TABLE companies ADD COLUMN career_failures integer NOT NULL DEFAULT 0;
