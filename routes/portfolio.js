// ink-studio/routes/portfolio.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

// GET /api/portfolio/:id/image
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

    // 1. Set the correct MIME type
    res.set('Content-Type', mime_type || 'image/jpeg');
    
    // 2. Add strong caching (browser caches it for a year)
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    
    // 3. Send the raw binary buffer
    res.send(image_data);
  } catch (e) {
    console.error('Error serving image:', e);
    res.status(500).send('Error serving image');
  }
});

export default router;
