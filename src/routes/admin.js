const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// Middleware: admin only
const adminOnly = async (req, res, next) => {
  const result = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.id]);
  if (!result.rows[0]?.is_admin) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// GET /api/admin/partners?status=pending
router.get('/partners', auth, adminOnly, async (req, res) => {
  const { status = 'pending' } = req.query;
  try {
    const result = await pool.query(
      `SELECT p.id, p.status, p.printers_owned, p.material_prices, p.bio,
              p.province, p.district, p.phone, p.line_id,
              p.printer_photo_url, p.id_photo_url, p.created_at,
              u.name as user_name, u.email as user_email
       FROM printer_profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.status = $1
       ORDER BY p.created_at DESC`,
      [status]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/admin/partners/:id/approve
router.patch('/partners/:id/approve', auth, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE printer_profiles SET status='approved' WHERE id=$1 RETURNING id, status`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/admin/partners/:id/reject
router.patch('/partners/:id/reject', auth, adminOnly, async (req, res) => {
  const { reason } = req.body;
  try {
    const result = await pool.query(
      `UPDATE printer_profiles SET status='rejected', reject_reason=$1 WHERE id=$2 RETURNING id, status`,
      [reason || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/jobs?status=open
router.get('/jobs', auth, adminOnly, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    const where = status ? 'WHERE j.status=$1' : '';
    if (status) params.push(status);
    const result = await pool.query(
      `SELECT j.id, j.title, j.material, j.complexity, j.budget_max, j.status,
              j.created_at, j.is_rush,
              u.name as commissioner_name, u.email as commissioner_email
       FROM jobs j
       JOIN users u ON u.id = j.commissioner_id
       ${where}
       ORDER BY j.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/stats
router.get('/stats', auth, adminOnly, async (req, res) => {
  try {
    const [jobs, openJobs, pending, approved, openAppeals] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM jobs'),
      pool.query("SELECT COUNT(*) FROM jobs WHERE status='open'"),
      pool.query("SELECT COUNT(*) FROM printer_profiles WHERE status='pending'"),
      pool.query("SELECT COUNT(*) FROM printer_profiles WHERE status='approved'"),
      pool.query("SELECT COUNT(*) FROM appeals WHERE status='open'"),
    ]);
    res.json({
      total_jobs: parseInt(jobs.rows[0].count),
      open_jobs: parseInt(openJobs.rows[0].count),
      pending_partners: parseInt(pending.rows[0].count),
      approved_partners: parseInt(approved.rows[0].count),
      open_appeals: parseInt(openAppeals.rows[0].count),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/appeals?status=open
router.get('/appeals', auth, adminOnly, async (req, res) => {
  const { status } = req.query;
  try {
    const params = [];
    const where = status ? 'WHERE a.status=$1' : '';
    if (status) params.push(status);
    const result = await pool.query(
      `SELECT a.*, u.name as sender_name, u.email as sender_email, j.title as job_title
       FROM appeals a
       JOIN users u ON u.id = a.sender_id
       LEFT JOIN jobs j ON j.id = a.job_id
       ${where}
       ORDER BY a.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/admin/appeals/:id/resolve
router.patch('/appeals/:id/resolve', auth, adminOnly, async (req, res) => {
  const { reply } = req.body;
  try {
    const result = await pool.query(
      `UPDATE appeals SET status='resolved', admin_reply=$1, resolved_at=NOW()
       WHERE id=$2 RETURNING *`,
      [reply || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
