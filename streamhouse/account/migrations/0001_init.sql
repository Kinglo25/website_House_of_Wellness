-- Accounts, device sessions, and the synced items themselves.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,   -- sha256(salt:key), where key is stretched from the password on the device
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,   -- sha256 of the bearer token; the token itself is never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE INDEX sessions_user ON sessions(user_id);

-- One row per synced thing: a Continue watching entry, a library title, the
-- add-on list, one setting. value NULL means deleted.
CREATE TABLE items (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at INTEGER NOT NULL,   -- when the device that made the change made it
  seq INTEGER NOT NULL,          -- per-account, only goes up; what device cursors point at
  PRIMARY KEY (user_id, kind, key)
);

CREATE INDEX items_seq ON items(user_id, seq);

CREATE TABLE login_failures (
  email TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
