-- Accounts for the lecture site. The environment admin is not a row here: it
-- is the bootstrap account and keeps signing in from its settings alone.
--
-- Usernames are stored lower-case and compared as such. `role` is the only
-- thing that decides what an account may read; `disabled` ends it without
-- losing its history, and the command that sets it also deletes the sessions.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE CHECK (username = lower(username)),
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin', 'friend', 'member')),
  created_at    INTEGER NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1))
);

-- A session belongs to one site and to one kind of account:
--   scope 'admin'  the blog host's admin (the environment admin, as before)
--   scope 'learn'  the lecture host; user_id names the account, or is NULL for
--                  the environment admin, whose `role` is then 'admin'.
-- A token from one scope never validates in the other. For a session with a
-- user_id the account's current role is what counts, not the one at sign-in.
ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'admin' CHECK (scope IN ('admin', 'learn'));
ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE sessions ADD COLUMN role TEXT;

CREATE INDEX sessions_user ON sessions (user_id);
