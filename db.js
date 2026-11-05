import Database from 'better-sqlite3';
const db = new Database('studio.db');

db.exec(`
CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bio TEXT,
  hourly_rate REAL NOT NULL,
  deposit_amount REAL NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS artist_portfolio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  image_url TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  instructions TEXT,
  fields TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  slot_start TEXT NOT NULL,
  slot_end TEXT NOT NULL,
  status TEXT DEFAULT 'pending_payment',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(artist_id, slot_start)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
  reference_number TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  proof_url TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  confirmation_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(artist_id, slot_start);
`);
export default db;