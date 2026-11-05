import multer from 'multer';
import { uploadImage, deleteImage } from '../services/storage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG/WebP allowed'), ok);
  }
});

router.post('/:id/portfolio/upload', upload.single('image'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const url = await uploadImage(req.file.buffer, req.file.originalname, req.file.mimetype);
    const { rows } = await pool.query(
      `INSERT INTO artist_portfolio (artist_id, image_url, caption, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING id, image_url`,
      [req.params.id, url, req.body.caption || null, Number(req.body.sort_order) || 0]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id/portfolio/:portfolioId', async (req, res, next) => {
  try {
    const find = await pool.query(
      'SELECT image_url FROM artist_portfolio WHERE id = $1 AND artist_id = $2',
      [req.params.portfolioId, req.params.id]
    );
    if (!find.rowCount) return res.status(404).json({ error: 'Not found' });
    await deleteImage(find.rows[0].image_url);
    await pool.query('DELETE FROM artist_portfolio WHERE id = $1', [req.params.portfolioId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
