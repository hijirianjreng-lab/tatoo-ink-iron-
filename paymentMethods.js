// ink-studio/routes/paymentMethods.js
import express from 'express';
import db from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();
router.use(requireAdmin);

// List all (admin sees inactive too)
router.get('/', (req, res) => {
  const methods = db.prepare('SELECT * FROM payment_methods ORDER BY sort_order ASC').all()
    .map(m => ({ ...m, fields: JSON.parse(m.fields || '{}') }));
  res.json({ methods });
});

// Create
router.post('/', (req, res) => {
  const { name, slug, instructions, fields, sort_order } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
  try {
    const r = db.prepare(`
      INSERT INTO payment_methods (name, slug, instructions, fields, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, slug, instructions || null, JSON.stringify(fields || {}), sort_order || 0);
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Slug already exists' });
    throw e;
  }
});

// Update (this is how admin toggles is_active and edits BSB details etc.)
router.patch('/:id', (req, res) => {
  const allowed = ['name', 'slug', 'instructions', 'sort_order', 'is_active'];
  const fields = [];
  const values = [];
  for (const key of allowed) {
    if (key in req.body) { fields.push(`${key} = ?`); values.push(req.body[key]); }
  }
  if ('fields' in req.body) {
    fields.push('fields = ?');
    values.push(JSON.stringify(req.body.fields));
  }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  values.push(req.params.id);
  const r = db.prepare(`UPDATE payment_methods SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// Delete (soft-deactivate if referenced by bookings)
router.delete('/:id', (req, res) => {
  const used = db.prepare('SELECT 1 FROM payments WHERE payment_method_id = ? LIMIT 1').get(req.params.id);
  if (used) {
    db.prepare('UPDATE payment_methods SET is_active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ ok: true, softDeleted: true });
  }
  db.prepare('DELETE FROM payment_methods WHERE id = ?').run(req.params.id);
  res.json({ ok: true, softDeleted: false });
});

export default router;