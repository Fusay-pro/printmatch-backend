const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// POST /api/reports — submit a report
router.post('/', auth, async (req, res) => {
  const { reported_user_id, conversation_id, reason, details } = req.body;
  if (!reported_user_id || !reason) return res.status(400).json({ error: 'reported_user_id and reason required' });
  if (reported_user_id === req.user.id) return res.status(400).json({ error: 'Cannot report yourself' });
  try {
    const result = await pool.query(
      `INSERT INTO reports (reporter_id, reported_user_id, conversation_id, reason, details)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, reported_user_id, conversation_id || null, reason, details || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reports — admin only
router.get('/', auth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  try {
    const result = await pool.query(
      `SELECT r.*,
              ru.name AS reporter_name, ru.email AS reporter_email,
              rd.name AS reported_name, rd.email AS reported_email
       FROM reports r
       JOIN users ru ON ru.id = r.reporter_id
       JOIN users rd ON rd.id = r.reported_user_id
       ORDER BY r.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/reports/:id/resolve — admin marks resolved
router.patch('/:id/resolve', auth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  try {
    const result = await pool.query(
      `UPDATE reports SET status='resolved' WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/reports/:id/dismiss — admin dismisses
router.patch('/:id/dismiss', auth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  try {
    const result = await pool.query(
      `UPDATE reports SET status='dismissed' WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
