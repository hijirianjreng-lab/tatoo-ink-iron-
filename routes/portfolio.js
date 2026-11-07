// ink-studio/routes/portfolio.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

router.get('/:id/image', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT image_data, mime_type FROM artist_portfolio WHERE id = $1',
      [req.params.id]
    );

    if (!rows.length || !rows[0].image_data) {
      return res.status(404).send('Image not found');
    }

    const { image_data, mime_type } = rows[0];

    res.set('Content-Type', mime_type || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image_data);
  } catch (e) {
    console.error('Error serving image:', e);
    res.status(500).send('Error serving image');
  }
});

export default router;
