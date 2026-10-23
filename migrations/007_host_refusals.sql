-- How many times in a row a host refused us; each refusal doubles the pause.
ALTER TABLE hosts ADD COLUMN refusals integer NOT NULL DEFAULT 0;
