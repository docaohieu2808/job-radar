-- Vietnamese for postings written in English: a short summary made when a posting reaches the Inbox, and a full
-- translation made on request. Both come from the LLM and are kept, so each is made once.
ALTER TABLE jobs ADD COLUMN vi_summary jsonb;
ALTER TABLE jobs ADD COLUMN vi_full text;
