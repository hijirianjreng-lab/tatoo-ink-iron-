// ink-studio/server.js
import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { adminLogin, requireAdmin } from './middleware/adminAuth.js';
import payments from './routes/payments.js';
import bookings from './routes/bookings.js';
import artists from './routes/artists.js';
import paymentMethods from './routes/paymentMethods.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---------- Core middleware ----------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ---------- Static files (public/) ----------
// index.html -> /
// admin.html -> /admin.html
// css/styles.css -> /css/styles.css
// js/booking.js -> /js/booking.js
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Health check ----------
app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- Admin login (rate limited) ----------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' }
});
app.post('/admin/login', loginLimiter, adminLogin);

// ---------- Admin-only: pending payments list ----------
// Small endpoint the admin panel needs to render the "Pending" tab.
app.get('/api/payments/pending', requireAdmin, (req, res) => {
  const rows = db.prepare(`
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
  `).all();
  res.json({ pending: rows });
});

// ---------- API routers ----------
app.use('/api/artists', artists);
app.use('/api/payment-methods', paymentMethods);
app.use('/api/bookings', bookings);
app.use('/api/payments', payments);

// ---------- 404 for unmatched API routes ----------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ---------- Centralized error handler ----------
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- Pending payment expiry job ----------
// Marks 'pending' payments older than PENDING_EXPIRY_HOURS as 'expired'
// and cancels their booking so the slot is freed.
function expireStalePayments() {
  const hours = parseInt(process.env.PENDING_EXPIRY_HOURS || '24', 10);
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const stale = db.prepare(`
    SELECT id, booking_id FROM payments
    WHERE status = 'pending' AND created_at < ?
  `).all(cutoff);

  if (!stale.length) return;

  const tx = db.transaction(() => {
    const markExpired = db.prepare(`
      UPDATE payments SET status = 'expired'
      WHERE id = ? AND status = 'pending'
    `);
    const cancelBooking = db.prepare(`
      UPDATE bookings SET status = 'cancelled' WHERE id = ?
    `);
    for (const row of stale) {
      const r = markExpired.run(row.id);
      if (r.changes > 0) cancelBooking.run(row.booking_id);
    }
  });
  tx();

  console.log(`[expiry] expired ${stale.length} stale pending payment(s)`);
}

// Run every 15 minutes, and once at startup
setInterval(expireStalePayments, 15 * 60 * 1000);
expireStalePayments();

// ---------- Start ----------
const PORT = parseInt(process.env.PORT || '3000', 10);
const server = app.listen(PORT, () => {
  console.log(`Ink Studio running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin.html`);
});

// ---------- Graceful shutdown ----------
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close(() => {
    try { db.close(); } catch { /* ignore */ }
    process.exit(0);
  });
  // force-exit if hanging
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));