// ink-studio/server.js
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pool, { init, close as closeDb } from './db.js';
import { adminLogin, requireAdmin } from './middleware/adminAuth.js';
import payments from './routes/payments.js';
import bookings from './routes/bookings.js';
import artists from './routes/artists.js';
import paymentMethods from './routes/paymentMethods.js';
import portfolio from './routes/portfolio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ---------- Admin panel: private HTML served from a secret route ---------- */

// Resolve the admin path once, at startup, and log it for diagnostics.
const ADMIN_PATH = (process.env.ADMIN_PATH || 'admin-secret').trim();
const ADMIN_FILE = path.join(__dirname, 'private', 'admin.html');

console.log('[admin] ADMIN_PATH =', JSON.stringify(ADMIN_PATH));
console.log('[admin] ADMIN_FILE =', ADMIN_FILE);
console.log('[admin] file exists =', fs.existsSync(ADMIN_FILE));

// Block direct access to the private folder, regardless of what's inside.
app.use('/private', (req, res) => res.status(404).end());

// Serve the admin HTML only through the secret path.
app.get(`/${ADMIN_PATH}`, (req, res) => {
  res.sendFile(ADMIN_FILE, (err) => {
    if (err) {
      console.error('[admin] sendFile failed:', err.message);
      if (!res.headersSent) res.status(500).send('Admin file not found on server');
    }
  });
});

/* ---------- Static public assets ---------- */

app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Health ---------- */

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* ---------- Admin login ---------- */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' }
});
app.post('/admin/login', loginLimiter, adminLogin);

/* ---------- Admin-only: pending payments ---------- */

app.get('/api/payments/pending', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.reference_number, p.amount, p.status, p.created_at,
             b.customer_name, b.customer_email, b.slot_start,
             a.name AS artist_name,
             pm.name AS method_name
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN artists a ON a.id = b.artist_id
      JOIN payment_methods pm ON pm.id = p.payment_method_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at ASC
    `);
    res.json({ pending: rows });
  } catch (e) { next(e); }
});

/* ---------- API routers ---------- */

app.use('/api/bookings', bookings);
app.use('/api/payments', payments);
app.use('/api/artists', artists);
app.use('/api/payment-methods', paymentMethods);
app.use('/api/portfolio', portfolio);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ---------- Central error handler ---------- */

app.use((err, req, res, next) => {
  console.error('[server error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ---------- Pending-payment expiry job ---------- */

async function expireStalePayments() {
  const hours = parseInt(process.env.PENDING_EXPIRY_HOURS || '24', 10);
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, booking_id FROM payments WHERE status = 'pending' AND created_at < $1`,
      [cutoff]
    );
    for (const row of rows) {
      const r = await client.query(
        `UPDATE payments SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
        [row.id]
      );
      if (r.rowCount > 0) {
        await client.query(`UPDATE bookings SET status = 'cancelled' WHERE id = $1`, [row.booking_id]);
      }
    }
    await client.query('COMMIT');
    if (rows.length) console.log(`[expiry] expired ${rows.length} stale payment(s)`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[expiry]', e);
  } finally {
    client.release();
  }
}

setInterval(() => expireStalePayments().catch(console.error), 15 * 60 * 1000);

/* ---------- Startup ---------- */

const PORT = parseInt(process.env.PORT || '3000', 10);

init()
  .then(() => {
    expireStalePayments().catch(console.error);
    const server = app.listen(PORT, () => {
      console.log(`Ink Studio running on port ${PORT}`);
    });

    const shutdown = (signal) => {
      console.log(`\n${signal} received, shutting down...`);
      server.close(async () => {
        try { await closeDb(); } catch { /* ignore */ }
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 5000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((e) => {
    console.error('[startup] failed to init DB', e);
    process.exit(1);
  });
