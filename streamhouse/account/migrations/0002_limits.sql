-- Limits for an account server anyone can sign up to.

-- Sign-ups per connection per hour, like login_failures per email. An IPv6
-- address is counted by its /64, which is what one home or phone is given.
CREATE TABLE signup_attempts (
  address TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);

-- How much each account stores: every item's key and value plus a row's worth
-- of overhead, so a pile of empty rows counts too. Kept up to date by the
-- triggers below rather than summed on every push.
ALTER TABLE users ADD COLUMN stored_bytes INTEGER NOT NULL DEFAULT 0;

UPDATE users SET stored_bytes = (
  SELECT COALESCE(SUM(64 + LENGTH(key) + COALESCE(LENGTH(value), 0)), 0)
  FROM items WHERE items.user_id = users.id
);

CREATE TRIGGER items_stored_insert AFTER INSERT ON items BEGIN
  UPDATE users SET stored_bytes = stored_bytes + 64 + LENGTH(NEW.key) + COALESCE(LENGTH(NEW.value), 0)
  WHERE id = NEW.user_id;
END;

CREATE TRIGGER items_stored_update AFTER UPDATE OF value ON items BEGIN
  UPDATE users SET stored_bytes = stored_bytes + COALESCE(LENGTH(NEW.value), 0) - COALESCE(LENGTH(OLD.value), 0)
  WHERE id = NEW.user_id;
END;
