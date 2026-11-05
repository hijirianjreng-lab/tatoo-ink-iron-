// ink-studio/routes/paymentMethods.js
import express from 'express';
import pool from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payment_methods ORDER BY sort_order ASC');
    res.json({ methods: rows });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  const { name, slug, instructions, fields, sort_order } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO payment_methods (name, slug, instructions, fields, sort_order)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, slug, instructions || null, JSON.stringify(fields || {}), sort_order || 0]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    next(e);
  }
});

router.patch('/:id', async (req, res, next) => {
  const allowed = ['name', 'slug', 'instructions', 'sort_order', 'is_active'];
  const fields = [], values = [];
  let i = 1;
  for (const key of allowed) {
    if (key in req.body) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
  }
  if ('fields' in req.body) {
    fields.push(`fields = $${i++}`);
    values.push(JSON.stringify(req.body.fields));
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE payment_methods SET ${fields.join(', ')} WHERE id = $${i}`, values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const used = await pool.query('SELECT 1 FROM payments WHERE payment_method_id = $1 LIMIT 1', [req.params.id]);
    if (used.rowCount > 0) {
      await pool.query('UPDATE payment_methods SET is_active = 0 WHERE id = $1', [req.params.id]);
      return res.json({ ok: true, softDeleted: true });
    }
    await pool.query('DELETE FROM payment_methods WHERE id = $1', [req.params.id]);
    res.json({ ok: true, softDeleted: false });
  } catch (e) { next(e); }
});

export default router;
