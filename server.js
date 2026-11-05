// ink-studio/server.js
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
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

// Block direct access to private folder
app.use('/private', (req, res) => res.status(404).end());

app.use(express.static(path.join(__dirname, 'public')));

// Secret admin panel route — path from env
app.get(`/${process.env.ADMIN_PATH || 'admin-secret'}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'private', 'admin.html'));
});

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' }
});
app.post('/admin/login', loginLimiter, adminLogin);

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

app.use('/api/bookings', bookings);
app.use('/api/payments', payments);
app.use('/api/artists', artists);
app.use('/api/payment-methods', paymentMethods);
app.use('/api/portfolio', portfolio);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('[server error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

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
