-- A session of the environment admin (the account with no row in `users`)
-- records which password it was made with: a short fingerprint of the
-- configured hash. Change that password and every such session stops
-- validating, which is the only way the owner has to end them.
--
-- Sessions that exist now have none, so they stop validating once: the owner
-- signs in again, as after migration 004.
ALTER TABLE sessions ADD COLUMN credential TEXT;
