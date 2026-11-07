// ink-studio/routes/bookings.js
import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import pool from '../db.js';
import { sendAdminNotification } from '../services/brevo.js'; // We will create this function

const router = express.Router();

// Accept BOTH the reference tattoo AND the payment screenshot
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ... (setup & availability routes stay the same) ...

router.post('/', upload.fields([{ name: 'reference', maxCount: 1 }, { name: 'screenshot', maxCount: 1 }]), async (req, res, next) => {
  const {
    artist_id, customer_name, customer_email, customer_phone,
    slot_start, slot_end, payment_method_id
  } = req.body;

  if (!artist_id || !customer_name || !customer_email || !slot_start || !slot_end || !payment_method_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    const artistQ = await client.query(`SELECT name, deposit_amount FROM artists WHERE id = $1 AND is_active = 1`, [artist_id]);
    if (!artistQ.rowCount) return res.status(404).json({ error: 'Artist not found or inactive' });
    const deposit = Number(artistQ.rows[0].deposit_amount);
    const artistName = artistQ.rows[0].name;

    const ref = `INK-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    // Get file buffers
    const refImg = req.files['reference'] ? req.files['reference'][0].buffer : null;
    const refMime = req.files['reference'] ? req.files['reference'][0].mimetype : null;
    
    const proofImg = req.files['screenshot'] ? req.files['screenshot'][0].buffer : null;
    const proofMime = req.files['screenshot'] ? req.files['screenshot'][0].mimetype : null;

    await client.query('BEGIN');

    const conflict = await client.query(
      `SELECT 1 FROM bookings WHERE artist_id = $1 AND status != 'cancelled' AND slot_start < $2 AND slot_end > $3`,
      [artist_id, slot_end, slot_start]
    );
    if (conflict.rowCount > 0) throw new Error('SLOT_TAKEN');

    const inserted = await client.query(
      `INSERT INTO bookings (artist_id, customer_name, customer_email, customer_phone, slot_start, slot_end, status, reference_image, reference_mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,'pending_payment',$7,$8) RETURNING id`,
      [artist_id, customer_name, customer_email, customer_phone || null, slot_start, slot_end, refImg, refMime]
    );
    const bookingId = inserted.rows[0].id;

    // Save the payment WITH the screenshot proof
    await client.query(
      `INSERT INTO payments (booking_id, payment_method_id, reference_number, amount, status, proof_data, proof_mime_type)
       VALUES ($1,$2,$3,$4,'pending', $5, $6)`,
      [bookingId, payment_method_id, ref, deposit, proofImg, proofMime]
    );

    await client.query('COMMIT');

    // Send notification to Admin (fire and forget)
    if (proofImg) {
      sendAdminNotification({
        adminEmail: process.env.ADMIN_EMAIL,
        reference: ref,
        customerName: customer_name,
        artistName: artistName,
        amount: deposit,
        screenshotBuffer: proofImg,
        screenshotMime: proofMime
      }).catch(err => console.error('Admin email failed:', err));
    }

    res.status(201).json({ bookingId, reference: ref, amount: deposit });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    if (e.message === 'SLOT_TAKEN') return res.status(409).json({ error: 'Slot already reserved' });
    if (e.code === '23505') return res.status(409).json({ error: 'Slot already reserved' });
    next(e);
  } finally {
    client.release();
  }
});

export default router;
