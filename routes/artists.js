// ink-studio/routes/artists.js
import express from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

// All routes here are admin-only
router.use(requireAdmin);

// List all artists (including inactive)
router.get('/', (req, res) => {
  const artists = db.prepare('SELECT * FROM artists ORDER BY name ASC').all();
  res.json({ artists });
});

// Create artist
router.post('/', (req, res) => {
  const { name, slug, bio, hourly_rate, deposit_amount } = req.body;
  if (!name || !slug || hourly_rate == null || deposit_amount == null) {
    return res.status(400).json({ error: 'name, slug, hourly_rate, deposit_amount required' });
  }
  try {
    const r = db.prepare(`
      INSERT INTO artists (name, slug, bio, hourly_rate, deposit_amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, slug, bio || null, hourly_rate, deposit_amount);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Slug already exists' });
    throw e;
  }
});

// Update artist
router.patch('/:id', (req, res) => {
  const allowed = ['name', 'slug', 'bio', 'hourly_rate', 'deposit_amount', 'is_active'];
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (key in req.body) { fields.push(`${key} = ?`); values.push(req.body[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);
  const r = db.prepare(`UPDATE artists SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (r.changes === 0) return res.status(404).json({ error: 'Artist not found' });
  res.json({ ok: true });
});

// Delete artist (soft-delete via is_active=0 if they have bookings)
router.delete('/:id', (req, res) => {
  const hasBookings = db.prepare('SELECT 1 FROM bookings WHERE artist_id = ? LIMIT 1').get(req.params.id);
  if (hasBookings) {
    db.prepare('UPDATE artists SET is_active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, softDeleted: true });
  }
  db.prepare('DELETE FROM artists WHERE id = ?').run(req.params.id);
  res.json({ ok: true, softDeleted: false });
});

// Portfolio: list
router.get('/:id/portfolio', (req, res) => {
  const rows = db.prepare('SELECT * FROM artist_portfolio WHERE artist_id = ? ORDER BY sort_order ASC').all(req.params.id);
  res.json({ portfolio: rows });
});

// Portfolio: add (URL-based; file upload would attach multer here later)
router.post('/:id/portfolio', (req, res) => {
  const { image_url, caption, sort_order } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });
  const r = db.prepare(`
    INSERT INTO artist_portfolio (artist_id, image_url, caption, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(req.params.id, image_url, caption || null, sort_order || 0);
  res.status(201).json({ id: r.lastInsertRowid });
});

// Portfolio: remove
router.delete('/:id/portfolio/:portfolioId', (req, res) => {
  const r = db.prepare('DELETE FROM artist_portfolio WHERE id = ? AND artist_id = ?')
    .run(req.params.portfolioId, req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
