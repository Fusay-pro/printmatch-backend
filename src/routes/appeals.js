const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// POST /api/appeals — submit an appeal
router.post('/', auth, async (req, res) => {
  const { type, subject, message, job_id } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'subject and message required' });
  try {
    const result = await pool.query(
      `INSERT INTO appeals (sender_id, type, subject, message, job_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, type || 'other', subject, message, job_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/appeals/mine — user's own appeals
router.get('/mine', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, j.title as job_title
       FROM appeals a
       LEFT JOIN jobs j ON j.id = a.job_id
       WHERE a.sender_id = $1
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
