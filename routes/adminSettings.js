// ink-studio/routes/adminSettings.js
import express from 'express';
import pool from '../db.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();
router.use(requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM studio_settings LIMIT 1');
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

router.patch('/', async (req, res, next) => {
  const { currency_symbol, currency_code } = req.body;
  try {
    await pool.query(
      'UPDATE studio_settings SET currency_symbol = $1, currency_code = $2',
      [currency_symbol, currency_code]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
