// ink-studio/routes/artists.js
import express from 'express';
import pool from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { portfolioUpload } from '../services/uploads.js';

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM artists ORDER BY name ASC');
    res.json({ artists: rows });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  const { name, slug, bio, hourly_rate, deposit_amount } = req.body;
  if (!name || !slug || hourly_rate == null || deposit_amount == null) {
    return res.status(400).json({ error: 'name, slug, hourly_rate, deposit_amount required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO artists (name, slug, bio, hourly_rate, deposit_amount)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, slug, bio || null, hourly_rate, deposit_amount]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  const allowed = ['name', 'slug', 'bio', 'hourly_rate', 'deposit_amount', 'is_active'];
  const fields = [], values = [];
  let i = 1;
  for (const key of allowed) {
    if (key in req.body) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE artists SET ${fields.join(', ')} WHERE id = $${i}`, values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Artist not found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const used = await pool.query('SELECT 1 FROM bookings WHERE artist_id = $1 LIMIT 1', [req.params.id]);
    if (used.rowCount > 0) {
      await pool.query('UPDATE artists SET is_active = 0 WHERE id = $1', [req.params.id]);
      return res.json({ ok: true, softDeleted: true });
    }
    await pool.query('DELETE FROM artists WHERE id = $1', [req.params.id]);
    res.json({ ok: true, softDeleted: false });
  } catch (e) { next(e); }
});

/* ---------- Portfolio ---------- */

router.get('/:id/portfolio', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, caption, sort_order,
              CASE WHEN image_data IS NOT NULL THEN '/api/portfolio/' || id || '/image'
              ELSE image_url END AS image_path 
        FROM artist_portfolio WHERE artist_id = $1 ORDER BY sort_order ASC`, 
      [req.params.id]
    );
    res.json({ portfolio: rows });
  } catch (e) { next(e); }
});

// Upload image route
router.post('/:id/portfolio/upload', portfolioUpload.single('image'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const artistCheck = await pool.query('SELECT 1 FROM artists WHERE id = $1', [req.params.id]);
  if (!artistCheck.rowCount) return res.status(404).json({ error: 'Artist not found' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO artist_portfolio (artist_id, image_data, mime_type, caption, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, caption, sort_order, created_at`,
      [
        req.params.id,
        req.file.buffer,
        req.file.mimetype,
        req.body.caption || null,
        Number(req.body.sort_order) || 0
      ]
    );
    const row = rows[0];
    res.status(201).json({
      id: row.id,
      caption: row.caption,
      sort_order: row.sort_order,
      image_path: `/api/portfolio/${row.id}/image`
    });
  } catch (e) { 
    console.error('Upload error:', e);
    next(e); 
  }
});

// Add image via URL (fallback)
router.post('/:id/portfolio', async (req, res, next) => {
  const { image_url, caption, sort_order } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO artist_portfolio (artist_id, image_url, caption, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [req.params.id, image_url, caption || null, sort_order || 0]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) { next(e); }
});

router.delete('/:id/portfolio/:portfolioId', async (req, res, next) => {
  try {
    const r = await pool.query(
      'DELETE FROM artist_portfolio WHERE id = $1 AND artist_id = $2',
      [req.params.portfolioId, req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
