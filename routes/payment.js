import express from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { buildReceiptPdf } from '../services/receipt.js';
import { sendReceiptEmail } from '../services/brevo.js';

const router = express.Router();

router.post('/:id/confirm', requireAdmin, async (req, res) => {
  const { note } = req.body;
  const payment = db.prepare(`SELECT p.*, b.customer_name, b.customer_email, b.slot_start, a.name AS artist_name
    FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN artists a ON a.id = b.artist_id
    WHERE p.id = ?`).get(req.params.id);

  if (!payment) return res.status(404).json({ error: 'Not found' });
  if (payment.status !== 'pending') return res.status(409).json({ error: `Already ${payment.status}` });

  const tx = db.transaction(() => {
    const upd = db.prepare(`UPDATE payments SET status='confirmed', confirmed_by=?, confirmed_at=?, confirmation_note=?
      WHERE id=? AND status='pending'`).run(process.env.ADMIN_IDENTIFIER, new Date().toISOString(), note || null, payment.id);
    if (upd.changes === 0) throw new Error('ALREADY_CONFIRMED'); // idempotency guard
    db.prepare(`UPDATE bookings SET status='confirmed' WHERE id=?`).run(payment.booking_id);
  });

  try { tx(); }
  catch (e) { return res.status(409).json({ error: 'Payment already processed' }); }

  try {
    const pdf = await buildReceiptPdf({ ...payment, confirmedBy: process.env.ADMIN_IDENTIFIER, confirmedAt: new Date().toISOString() });
    await sendReceiptEmail({
      to: payment.customer_email, adminEmail: process.env.ADMIN_EMAIL,
      pdfBase64: pdf, reference: payment.reference_number, amount: payment.amount,
      method: payment.method, customerName: payment.customer_name,
      artistName: payment.artist_name, slotStart: payment.slot_start
    });
  } catch (e) { console.error('Brevo failed:', e.message); }

  res.json({ ok: true, reference: payment.reference_number });
});

router.post('/:id/cancel', requireAdmin, (req, res) => {
  const r = db.prepare(`UPDATE payments SET status='cancelled', confirmed_by=?, confirmed_at=?
    WHERE id=? AND status='pending'`).run(process.env.ADMIN_IDENTIFIER, new Date().toISOString(), req.params.id);
  if (r.changes === 0) return res.status(409).json({ error: 'Not pending' });
  res.json({ ok: true });
});

export default router;
