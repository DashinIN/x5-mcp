import type Database from 'better-sqlite3';

export function migrate(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 1) throw new Error('Unsupported database version');
  if (version === 1) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE receipts (
        id TEXT PRIMARY KEY, transaction_id TEXT, created_at TEXT NOT NULL,
        purchase_date TEXT NOT NULL, network_code TEXT, title TEXT, store_id TEXT, store_address TEXT,
        total_regular_minor INTEGER, total_paid_minor INTEGER, discount_minor INTEGER,
        check_number TEXT, fiscal_number TEXT, ofd_url TEXT, synced_at TEXT NOT NULL
      );
      CREATE TABLE receipt_items (
        id INTEGER PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
        plu_id TEXT, name TEXT NOT NULL, name_search TEXT NOT NULL, quantity REAL NOT NULL,
        unit TEXT, regular_price_minor INTEGER, paid_price_minor INTEGER, source_price_item_minor INTEGER,
        discount_minor INTEGER, category_code TEXT, image_url TEXT
      );
      CREATE TABLE sync_runs (
        id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
        date_from TEXT NOT NULL, date_to TEXT NOT NULL, network_codes TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','complete','failed')),
        pages INTEGER NOT NULL DEFAULT 0, receipts_inserted INTEGER NOT NULL DEFAULT 0,
        receipts_updated INTEGER NOT NULL DEFAULT 0, error_code TEXT
      );
      CREATE TABLE sync_lock (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX idx_receipts_date ON receipts(purchase_date);
      CREATE INDEX idx_receipts_created ON receipts(created_at);
      CREATE INDEX idx_items_receipt ON receipt_items(receipt_id);
      CREATE INDEX idx_items_plu ON receipt_items(plu_id);
      CREATE INDEX idx_items_name ON receipt_items(name_search);
      PRAGMA user_version = 1;
    `);
  })();
}
