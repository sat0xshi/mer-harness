PRAGMA foreign_keys = ON;
CREATE TABLE items (
 id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK(category IN ('phone','gadget','clothing','other')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','listed','trading','to_ship','done','shelf')),
 answers_json TEXT NOT NULL DEFAULT '{}', title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
 price INTEGER NOT NULL DEFAULT 0 CHECK(price>=0), shipping INTEGER NOT NULL DEFAULT 750 CHECK(shipping>=0), comps_json TEXT NOT NULL DEFAULT '[]',
 version INTEGER NOT NULL DEFAULT 0, listed_at INTEGER, sold_at INTEGER, shipped_at INTEGER, completed_at INTEGER, sold_price INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX items_status ON items(status,updated_at);
CREATE TABLE photos (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, data BLOB NOT NULL CHECK(length(data)<=307200), position INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX photos_item ON photos(item_id,position);
CREATE TRIGGER photo_limit BEFORE INSERT ON photos WHEN (SELECT count(*) FROM photos WHERE item_id=NEW.item_id)>=10 BEGIN SELECT RAISE(ABORT,'photo_limit'); END;
CREATE TABLE events (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, type TEXT NOT NULL, item_id TEXT REFERENCES items(id) ON DELETE SET NULL, xp INTEGER NOT NULL CHECK(xp>=0), meta_json TEXT NOT NULL DEFAULT '{}', day TEXT NOT NULL, rule_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
CREATE INDEX events_time ON events(created_at);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE ai_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0);
CREATE TABLE operations (key TEXT PRIMARY KEY, item_id TEXT NOT NULL, from_status TEXT, to_status TEXT, snapshot TEXT NOT NULL, created_at INTEGER NOT NULL);
