const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// ─── QUOTES ───────────────────────────────

// POST /api/quotes/:jobId
router.post('/quotes/:jobId', auth, async (req, res) => {
  const { final_price, note, estimated_days, match_score, suggested_price } = req.body;
  if (!final_price) return res.status(400).json({ error: 'final_price required' });

  try {
    const printer = await pool.query(
      'SELECT id FROM printer_profiles WHERE user_id=$1', [req.user.id]
    );
    if (!printer.rows.length)
      return res.status(403).json({ error: 'Must have a printer profile to quote' });

    const result = await pool.query(
      `INSERT INTO quotes (job_id, printer_id, suggested_price, final_price, note, estimated_days, match_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.jobId, printer.rows[0].id, suggested_price || final_price,
       final_price, note, estimated_days, match_score]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/quotes/:jobId
router.get('/quotes/:jobId', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT q.*, u.name as printer_name, u.avatar_url,
              p.avg_rating, p.jobs_completed, p.failure_count
       FROM quotes q
       JOIN printer_profiles p ON p.id=q.printer_id
       JOIN users u ON u.id=p.user_id
       WHERE q.job_id=$1
       ORDER BY q.match_score DESC NULLS LAST`,
      [req.params.jobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/quotes/:id/accept
router.patch('/quotes/:id/accept', auth, async (req, res) => {
  try {
    const quote = await pool.query(
      'SELECT q.*, j.commissioner_id, j.budget_max FROM quotes q JOIN jobs j ON j.id=q.job_id WHERE q.id=$1',
      [req.params.id]
    );
    if (!quote.rows.length) return res.status(404).json({ error: 'Quote not found' });
    const q = quote.rows[0];
    if (q.commissioner_id !== req.user.id)
      return res.status(403).json({ error: 'Not your job' });

    // Accept this quote, reject others
    await pool.query(`UPDATE quotes SET status='rejected' WHERE job_id=$1`, [q.job_id]);
    await pool.query(`UPDATE quotes SET status='accepted' WHERE id=$1`, [req.params.id]);

    // Assign printer + update job status
    await pool.query(
      `UPDATE jobs SET status='in_progress', assigned_printer_id=$1 WHERE id=$2`,
      [q.printer_id, q.job_id]
    );

    // Hold payment in escrow
    await pool.query(
      `INSERT INTO payments (job_id, commissioner_id, printer_id, amount)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (job_id) DO UPDATE SET amount=$4, status='held'`,
      [q.job_id, req.user.id, q.printer_id, q.final_price]
    );

    res.json({ message: 'Quote accepted, payment held in escrow', quote: q });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/quotes/:id/reject
router.patch('/quotes/:id/reject', auth, async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT q.*, j.commissioner_id FROM quotes q JOIN jobs j ON j.id=q.job_id WHERE q.id=$1`,
      [req.params.id]
    );
    if (!q.rows.length) return res.status(404).json({ error: 'Quote not found' });
    if (q.rows[0].commissioner_id !== req.user.id)
      return res.status(403).json({ error: 'Not your job' });

    await pool.query(`UPDATE quotes SET status='rejected' WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Quote rejected' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PAYMENTS ─────────────────────────────

// POST /api/payments/release — commissioner confirms delivery
router.post('/payments/release', auth, async (req, res) => {
  const { job_id } = req.body;
  try {
    await pool.query(
      `UPDATE payments SET status='released', escrow_released_at=NOW()
       WHERE job_id=$1 AND commissioner_id=$2`,
      [job_id, req.user.id]
    );
    await pool.query(`UPDATE jobs SET status='closed' WHERE id=$1`, [job_id]);
    res.json({ message: 'Payment released to printer' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/payments/dispute — freeze escrow (commissioner or printer only)
router.post('/payments/dispute', auth, async (req, res) => {
  const { job_id, reason } = req.body;
  try {
    const job = await pool.query(
      `SELECT j.*, p.user_id as printer_user_id
       FROM jobs j LEFT JOIN printer_profiles p ON p.id=j.assigned_printer_id
       WHERE j.id=$1`,
      [job_id]
    );
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    const isCommissioner = job.rows[0].commissioner_id === req.user.id;
    const isPrinter = job.rows[0].printer_user_id === req.user.id;
    if (!isCommissioner && !isPrinter)
      return res.status(403).json({ error: 'Not your job' });

    await pool.query(`UPDATE payments SET status='frozen' WHERE job_id=$1`, [job_id]);
    await pool.query(`UPDATE jobs SET status='disputed' WHERE id=$1`, [job_id]);
    res.json({ message: 'Payment frozen, dispute opened' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PROGRESS UPDATES ─────────────────────

// POST /api/progress/:jobId
router.post('/progress/:jobId', auth, async (req, res) => {
  const { message, photo_url, percent_complete } = req.body;
  try {
    const job = await pool.query(
      `SELECT j.*, p.user_id as printer_user_id
       FROM jobs j LEFT JOIN printer_profiles p ON p.id=j.assigned_printer_id
       WHERE j.id=$1`,
      [req.params.jobId]
    );
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].printer_user_id !== req.user.id)
      return res.status(403).json({ error: 'Not your job' });

    const result = await pool.query(
      `INSERT INTO progress_updates (job_id, printer_id, message, photo_url, percent_complete)
       VALUES ($1, (SELECT id FROM printer_profiles WHERE user_id=$2), $3, $4, $5)
       RETURNING *`,
      [req.params.jobId, req.user.id, message, photo_url, percent_complete]
    );

    // Update job status to 'printing' on first update
    await pool.query(
      `UPDATE jobs SET status='printing' WHERE id=$1 AND status='in_progress'`,
      [req.params.jobId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/progress/:jobId
router.get('/progress/:jobId', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pu.*, u.name as printer_name FROM progress_updates pu
       JOIN printer_profiles p ON p.id=pu.printer_id
       JOIN users u ON u.id=p.user_id
       WHERE pu.job_id=$1 ORDER BY pu.created_at ASC`,
      [req.params.jobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── REVIEWS ──────────────────────────────

// POST /api/reviews/:jobId
router.post('/reviews/:jobId', auth, async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating) return res.status(400).json({ error: 'rating required' });

  try {
    const job = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.jobId]);
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].commissioner_id !== req.user.id)
      return res.status(403).json({ error: 'Only the commissioner can leave a review' });

    const result = await pool.query(
      `INSERT INTO reviews (job_id, commissioner_id, printer_id, rating, comment)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.jobId, req.user.id, job.rows[0].assigned_printer_id, rating, comment]
    );

    // Update printer avg_rating
    await pool.query(
      `UPDATE printer_profiles
       SET avg_rating = (
         SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE printer_id=$1
       ),
       total_reviews = total_reviews + 1
       WHERE id=$1`,
      [job.rows[0].assigned_printer_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reviews/printer/:printerId
router.get('/reviews/printer/:printerId', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, u.name as commissioner_name, u.avatar_url
       FROM reviews r JOIN users u ON u.id=r.commissioner_id
       WHERE r.printer_id=$1 ORDER BY r.created_at DESC`,
      [req.params.printerId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── MESSAGES ─────────────────────────────

// POST /api/messages/:jobId
router.post('/messages/:jobId', auth, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  try {
    const job = await pool.query(
      `SELECT j.*, p.user_id as printer_user_id
       FROM jobs j LEFT JOIN printer_profiles p ON p.id=j.assigned_printer_id
       WHERE j.id=$1`,
      [req.params.jobId]
    );
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    const isParticipant = job.rows[0].commissioner_id === req.user.id || job.rows[0].printer_user_id === req.user.id;
    if (!isParticipant) return res.status(403).json({ error: 'Not your job' });

    const result = await pool.query(
      `INSERT INTO messages (job_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.jobId, req.user.id, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/messages/:jobId
router.get('/messages/:jobId', auth, async (req, res) => {
  try {
    const job = await pool.query(
      `SELECT j.*, p.user_id as printer_user_id
       FROM jobs j LEFT JOIN printer_profiles p ON p.id=j.assigned_printer_id
       WHERE j.id=$1`,
      [req.params.jobId]
    );
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    const isParticipant = job.rows[0].commissioner_id === req.user.id || job.rows[0].printer_user_id === req.user.id;
    if (!isParticipant) return res.status(403).json({ error: 'Not your job' });

    const result = await pool.query(
      `SELECT m.*, u.name as sender_name, u.avatar_url
       FROM messages m JOIN users u ON u.id=m.sender_id
       WHERE m.job_id=$1 ORDER BY m.created_at ASC`,
      [req.params.jobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
