-- Notifications were dropped: the owner reads everything on the web screens instead.
ALTER TABLE jobs DROP COLUMN alerted_at, DROP COLUMN digested_at;
