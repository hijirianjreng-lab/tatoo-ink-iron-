// ink-studio/routes/bookings.js
import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';

const router = express.Router();

// ---------- Public: list active artists + active payment methods ----------
// The booking wizard needs both before it can render.
router.get('/setup', (req, res) => {
  const artists = db.prepare(`
    SELECT id, name, slug, bio, hourly_rate, deposit_amount
    FROM artists WHERE is_active = 1 ORDER BY name ASC
  `).all();

  const methods = db.prepare(`
    SELECT id, name, slug, instructions, fields
    FROM payment_methods WHERE is_active = 1 ORDER BY sort_order ASC
  `).all().map(m => ({ ...m, fields: JSON.parse(m.fields || '{}') }));

  res.json({ artists, paymentMethods: methods });
});

// ---------- Public: free slots for one artist on one date ----------
// Working hours: 09:00–18:00, 1-hour granularity. Adjust WORK_START/WORK_END.
router.get('/availability', (req, res) => {
  const { artist_id, date } = req.query; // date = YYYY-MM-DD
  if (!artist_id || !date) return res.status(400).json({ error: 'artist_id and date required' });

  const WORK_START = 9;   // 09:00
  const WORK_END = 18;    // last slot ends 18:00
  const SLOT_MINUTES = 60;

  const taken = db.prepare(`
    SELECT slot_start, slot_end FROM bookings
    WHERE artist_id = ? AND status != 'cancelled' AND date(slot_start) = ?
  `).all(artist_id, date);

  const takenSet = new Set(taken.map(t => new Date(t.slot_start).getHours()));

  const free = [];
  for (let h = WORK_START; h + SLOT_MINUTES / 60 <= WORK_END; h++) {
    if (!takenSet.has(h)) {
      const start = new Date(`${date}T${String(h).padStart(2, '0')}:00:00`);
      const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);
      free.push({ slot_start: start.toISOString(), slot_end: end.toISOString() });
    }
  }

  res.json({ date, artist_id: Number(artist_id), free, taken });
});

// ---------- Public: create booking + pending payment ----------
router.post('/', (req, res) => {
  const {
    artist_id, customer_name, customer_email, customer_phone,
    slot_start, slot_end, payment_method_id
  } = req.body;

  if (!artist_id || !customer_name || !customer_email || !slot_start || !slot_end || !payment_method_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const artist = db.prepare('SELECT deposit_amount FROM artists WHERE id = ? AND is_active = 1').get(artist_id);
  if (!artist) return res.status(404).json({ error: 'Artist not found or inactive' });

  const method = db.prepare('SELECT id FROM payment_methods WHERE id = ? AND is_active = 1').get(payment_method_id);
  if (!method) return res.status(404).json({ error: 'Payment method unavailable' });

  const ref = `INK-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const tx = db.transaction(() => {
    // Re-check inside transaction — prevents TOCTOU race
    const conflict = db.prepare(`
      SELECT 1 FROM bookings
      WHERE artist_id = ? AND status != 'cancelled'
        AND slot_start < ? AND slot_end > ?
    `).get(artist_id, slot_end, slot_start);
    if (conflict) throw new Error('SLOT_TAKEN');

    const b = db.prepare(`
      INSERT INTO bookings (artist_id, customer_name, customer_email, customer_phone, slot_start, slot_end, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending_payment')
    `).run(artist_id, customer_name, customer_email, customer_phone || null, slot_start, slot_end);

    db.prepare(`
      INSERT INTO payments (booking_id, payment_method_id, reference_number, amount, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(b.lastInsertRowid, payment_method_id, ref, artist.deposit_amount);

    return { bookingId: b.lastInsertRowid, reference: ref, amount: artist.deposit_amount };
  });

  try {
    res.status(201).json(tx());
  } catch (e) {
    if (e.message === 'SLOT_TAKEN') return res.status(409).json({ error: 'Slot already reserved' });
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Slot already reserved' });
    console.error('[booking create]', e);
    res.status(500).json({ error: 'Booking failed' });
  }
});

export default router;