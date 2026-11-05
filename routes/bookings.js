// ink-studio/routes/bookings.js
import express from 'express';
import crypto from 'node:crypto';
import pool from '../db.js';

const router = express.Router();

router.get('/setup', async (req, res, next) => {
  try {
    // Cast NUMERIC to FLOAT so they arrive as JS numbers, not strings
    const artistsQ = await pool.query(`
      SELECT id, name, slug, COALESCE(bio, '') as bio, 
             CAST(hourly_rate AS FLOAT) as hourly_rate, 
             CAST(deposit_amount AS FLOAT) as deposit_amount
      FROM artists WHERE is_active = 1 ORDER BY name ASC
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

router.post('/', async (req, res, next) => {
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

    const methodQ = await client.query(
      `SELECT id FROM payment_methods WHERE id = $1 AND is_active = 1`,
      [payment_method_id]
    );
    if (!methodQ.rowCount) return res.status(404).json({ error: 'Payment method unavailable' });

    const ref = `INK-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    await client.query('BEGIN');

    const conflict = await client.query(
      `SELECT 1 FROM bookings
       WHERE artist_id = $1 AND status != 'cancelled'
         AND slot_start < $2 AND slot_end > $3`,
      [artist_id, slot_end, slot_start]
    );
    if (conflict.rowCount > 0) throw new Error('SLOT_TAKEN');

    const inserted = await client.query(
      `INSERT INTO bookings (artist_id, customer_name, customer_email, customer_phone, slot_start, slot_end, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending_payment') RETURNING id`,
      [artist_id, customer_name, customer_email, customer_phone || null, slot_start, slot_end]
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
