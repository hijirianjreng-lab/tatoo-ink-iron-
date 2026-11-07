// ink-studio/routes/bookings.js
import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import pool from '../db.js';
import { sendAdminNotification } from '../services/brevo.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/setup', async (req, res, next) => {
  try {
    const artistsQ = await pool.query(`
      SELECT a.id, a.name, a.slug, COALESCE(a.bio, '') as bio, 
             CAST(a.hourly_rate AS FLOAT) as hourly_rate, 
             CAST(a.deposit_amount AS FLOAT) as deposit_amount,
             COALESCE(
               (SELECT json_agg(
                 json_build_object('id', p.id, 'path', '/api/portfolio/' || p.id || '/image', 'caption', p.caption)
               ) FROM artist_portfolio p WHERE p.artist_id = a.id), 
               '[]'::json
             ) as portfolio
      FROM artists a
      WHERE a.is_active = 1 
      ORDER BY a.name ASC
    `);
    
    const methodsQ = await pool.query(`
      SELECT id, name, slug, instructions, fields
      FROM payment_methods WHERE is_active = 1 ORDER BY sort_order ASC
    `);

    const settingsQ = await pool.query(`
      SELECT currency_symbol, currency_code FROM studio_settings LIMIT 1
    `);

    res.json({
      artists: artistsQ.rows,
      paymentMethods: methodsQ.rows,
      settings: settingsQ.rows[0] || { currency_symbol: '$', currency_code: 'AUD' }
    });
  } catch (e) { next(e); }
});

router.get('/availability', async (req, res, next) => {
  const { artist_id, date } = req.query;
  if (!artist_id || !date) return res.status(400).json({ error: 'artist_id and date required' });

  const WORK_START = 9;
  const WORK_END = 18;
  const SLOT_MINUTES = 60;

  try {
    const { rows: taken } = await pool.query(
      `SELECT slot_start, slot_end FROM bookings
       WHERE artist_id = $1 AND status != 'cancelled'
         AND DATE(slot_start AT TIME ZONE 'Australia/Sydney') = $2`,
      [artist_id, date]
    );

    const takenHours = new Set(taken.map(t => new Date(t.slot_start).getHours()));
    const free = [];

    for (let h = WORK_START; h + SLOT_MINUTES / 60 <= WORK_END; h++) {
      if (!takenHours.has(h)) {
        const start = new Date(`${date}T${String(h).padStart(2, '0')}:00:00`);
        const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);
        free.push({ slot_start: start.toISOString(), slot_end: end.toISOString() });
      }
    }
    res.json({ date, artist_id: Number(artist_id), free, taken });
  } catch (e) { next(e); }
});

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

    const refImg = req.files?.['reference'] ? req.files['reference'][0].buffer : null;
    const refMime = req.files?.['reference'] ? req.files['reference'][0].mimetype : null;
    
    const proofImg = req.files?.['screenshot'] ? req.files['screenshot'][0].buffer : null;
    const proofMime = req.files?.['screenshot'] ? req.files['screenshot'][0].mimetype : null;

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
    console.error("BOOKING ERROR:", e); // <--- This will show the exact DB error in Render logs if it fails
    next(e);
  } finally {
    client.release();
  }
});

export default router;
