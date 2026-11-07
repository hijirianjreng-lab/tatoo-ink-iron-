// ink-studio/db.js
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[pg pool error]', err);
});

export async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artists (
      id             SERIAL PRIMARY KEY,
      name           TEXT NOT NULL,
      slug           TEXT UNIQUE NOT NULL,
      bio            TEXT,
      hourly_rate    NUMERIC(10,2) NOT NULL,
      deposit_amount NUMERIC(10,2) NOT NULL,
      is_active      INTEGER NOT NULL DEFAULT 1,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS artist_portfolio (
      id         SERIAL PRIMARY KEY,
      artist_id  INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
      image_url  TEXT,
      image_data BYTEA,
      mime_type  TEXT,
      caption    TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE artist_portfolio ADD COLUMN IF NOT EXISTS image_data BYTEA;`);
  await pool.query(`ALTER TABLE artist_portfolio ADD COLUMN IF NOT EXISTS mime_type TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      slug         TEXT UNIQUE NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      instructions TEXT,
      fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    artist_id INTEGER NOT NULL REFERENCES artists(id),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_payment',
    reference_image BYTEA,           -- NEW: For client reference images
    reference_mime_type TEXT,        -- NEW: For client reference images
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (artist_id, slot_start)
  );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id                SERIAL PRIMARY KEY,
      booking_id        INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
      reference_number  TEXT UNIQUE NOT NULL,
      amount            NUMERIC(10,2) NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      proof_url         TEXT,
      confirmed_by      TEXT,
      confirmed_at      TIMESTAMPTZ,
      confirmation_note TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Currency Settings Table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS studio_settings (
      id SERIAL PRIMARY KEY,
      currency_symbol TEXT NOT NULL DEFAULT '$',
      currency_code   TEXT NOT NULL DEFAULT 'AUD'
    );
  `);

  // Insert default settings if table is empty
  const settingsCheck = await pool.query('SELECT COUNT(*) FROM studio_settings');
  if (parseInt(settingsCheck.rows[0].count) === 0) {
    await pool.query(`INSERT INTO studio_settings (currency_symbol, currency_code) VALUES ('$', 'AUD')`);
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(artist_id, slot_start);`);

  console.log('[db] schema ready');
}

export async function close() {
  await pool.end();
}

export default pool;
