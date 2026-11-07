// ink-studio/routes/bookings.js
import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import pool from '../db.js';

const router = express.Router();

// Memory storage for reference image
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/setup', async (req, res, next) => {
  try {
    // Fetch artists with their portfolios aggregated into a JSON array
    const artistsQ = await pool.query(`
      SELECT a.id, a.name, a.slug, COALESCE(a.bio, '') as bio, 
             CAST(a.hourly_rate AS FLOAT) as hourly_rate, 
             CAST(a.deposit_amount AS FLOAT) as deposit_amount,
             COALESCE(
               json_agg(
                 json_build_object('id', p.id, 'path', '/api/portfolio/' || p.id || '/image', 'caption', p.caption)
               ) FILTER (WHERE p.id IS NOT NULL), '[]'
             ) as portfolio
      FROM artists a
      LEFT JOIN artist_portfolio p ON a.id = p.artist_id
      WHERE a.is_active = 1 
      GROUP BY a.id
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

// ... (Availability route stays the same) ...

// POST /api/bookings - Now accepts multipart form data
router.post('/', upload.single('reference'), async (req, res, next) => {
  const {
    artist_id, customer_name, customer_email, customer_phone,
    slot_start, slot_end, payment_method_id
  } = req.body;

  if (!artist_id || !customer_name || !customer_email || !slot_start || !slot_end || !payment_method_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    const artistQ = await client.query(
      `SELECT deposit_amount FROM artists WHERE id = $1 AND is_active = 1`,
      [artist_id]
    );
    if (!artistQ.rowCount) return res.status(404).json({ error: 'Artist not found or inactive' });
    const deposit = Number(artistQ.rows[0].deposit_amount);

    const ref = `INK-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    await client.query('BEGIN');

    const conflict = await client.query(
      `SELECT 1 FROM bookings WHERE artist_id = $1 AND status != 'cancelled' AND slot_start < $2 AND slot_end > $3`,
      [artist_id, slot_end, slot_start]
    );
    if (conflict.rowCount > 0) throw new Error('SLOT_TAKEN');

    // Insert with optional reference image
    const refImage = req.file ? req.file.buffer : null;
    const refMime = req.file ? req.file.mimetype : null;

    const inserted = await client.query(
      `INSERT INTO bookings (artist_id, customer_name, customer_email, customer_phone, slot_start, slot_end, status, reference_image, reference_mime_type)
       VALUES ($1,$2,$3,$4,$5,$6,'pending_payment',$7,$8) RETURNING id`,
      [artist_id, customer_name, customer_email, customer_phone || null, slot_start, slot_end, refImage, refMime]
    );
    const bookingId = inserted.rows[0].id;

    await client.query(
      `INSERT INTO payments (booking_id, payment_method_id, reference_number, amount, status)
       VALUES ($1,$2,$3,$4,'pending')`,
      [bookingId, payment_method_id, ref, deposit]
    );

    await client.query('COMMIT');
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
