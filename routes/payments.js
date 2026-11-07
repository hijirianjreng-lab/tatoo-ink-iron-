// ink-studio/routes/payments.js
import express from 'express';
import pool from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { buildReceiptPdf } from '../services/receipt.js';
import { sendReceiptEmail } from '../services/brevo.js';

const router = express.Router();

// --- NEW: Serve the payment screenshot to the admin panel ---
router.get('/proof/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT proof_data, proof_mime_type FROM payments WHERE id = $1', 
      [req.params.id]
    );
    
    if (!rows.length || !rows[0].proof_data) {
      return res.status(404).send('No screenshot uploaded for this payment.');
    }
    
    res.set('Content-Type', rows[0].proof_mime_type || 'image/jpeg');
    res.send(rows[0].proof_data);
  } catch (e) { next(e); }
});

// --- Confirm Payment ---
router.post('/:id/confirm', requireAdmin, async (req, res, next) => {
  const { note } = req.body;
  const client = await pool.connect();
  try {
    const payQ = await client.query(`
      SELECT p.*, b.customer_name, b.customer_email, b.slot_start,
             a.name AS artist_name, pm.name AS method_name
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN artists a ON a.id = b.artist_id
      JOIN payment_methods pm ON pm.id = p.payment_method_id
      WHERE p.id = $1
    `, [req.params.id]);

    if (!payQ.rowCount) return res.status(404).json({ error: 'Not found' });
    const payment = payQ.rows[0];
    if (payment.status !== 'pending') {
      return res.status(409).json({ error: `Already ${payment.status}` });
    }

    await client.query('BEGIN');
    const upd = await client.query(`
      UPDATE payments
      SET status='confirmed', confirmed_by=$1, confirmed_at=NOW(), confirmation_note=$2
      WHERE id=$3 AND status='pending'
    `, [process.env.ADMIN_IDENTIFIER, note || null, payment.id]);
    if (upd.rowCount === 0) throw new Error('ALREADY_CONFIRMED');
    await client.query(`UPDATE bookings SET status='confirmed' WHERE id=$1`, [payment.booking_id]);
    await client.query('COMMIT');

    try {
      const pdf = await buildReceiptPdf({
        reference: payment.reference_number,
        customerName: payment.customer_name,
        artistName: payment.artist_name,
        slotStart: payment.slot_start,
        method: payment.method_name,
        amount: Number(payment.amount),
        confirmedBy: process.env.ADMIN_IDENTIFIER,
        confirmedAt: new Date().toISOString()
      });
      await sendReceiptEmail({
        to: payment.customer_email,
        adminEmail: process.env.ADMIN_EMAIL,
        pdfBase64: pdf,
        reference: payment.reference_number,
        amount: Number(payment.amount),
        method: payment.method_name,
        customerName: payment.customer_name,
        artistName: payment.artist_name,
        slotStart: payment.slot_start
      });
    } catch (e) {
      console.error('[brevo] receipt failed:', e.message);
    }

    res.json({ ok: true, reference: payment.reference_number });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    if (e.message === 'ALREADY_CONFIRMED') {
      return res.status(409).json({ error: 'Payment already processed' });
    }
    next(e);
  } finally {
    client.release();
  }
});

// --- Cancel Payment ---
router.post('/:id/cancel', requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(`
      UPDATE payments
      SET status='cancelled', confirmed_by=$1, confirmed_at=NOW()
      WHERE id=$2 AND status='pending'
    `, [process.env.ADMIN_IDENTIFIER, req.params.id]);
    if (r.rowCount === 0) return res.status(409).json({ error: 'Not pending' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
