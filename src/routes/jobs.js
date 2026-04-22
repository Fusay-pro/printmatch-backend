const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// POST /api/jobs — commissioner sends a request directly to a partner
router.post('/', auth, async (req, res) => {
  const {
    partner_id, title, description, material, estimated_weight_g,
    estimated_time_hr, complexity, is_rush, agreed_price, stl_file_url
  } = req.body;

  if (!partner_id || !title || !material || !agreed_price)
    return res.status(400).json({ error: 'partner_id, title, material and agreed_price required' });

  try {
    // Resolve printer_profile id from partner user id
    const printerRes = await pool.query(
      'SELECT id FROM printer_profiles WHERE user_id=$1 AND status=$2',
      [partner_id, 'approved']
    );
    if (!printerRes.rows.length)
      return res.status(404).json({ error: 'Partner not found or not approved' });

    const result = await pool.query(
      `INSERT INTO jobs
        (commissioner_id, assigned_printer_id, title, description, material,
         estimated_weight_g, estimated_time_hr, complexity, is_rush,
         budget_max, stl_file_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_acceptance')
       RETURNING *`,
      [req.user.id, printerRes.rows[0].id, title, description, material,
       estimated_weight_g || null, estimated_time_hr || null,
       complexity || 'medium', is_rush || false, agreed_price, stl_file_url || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/jobs/:id/accept — partner accepts the request
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const job = await pool.query(
      `SELECT j.*, p.user_id as partner_user_id FROM jobs j
       JOIN printer_profiles p ON p.id=j.assigned_printer_id
       WHERE j.id=$1`, [req.params.id]
    );
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].partner_user_id !== req.user.id)
      return res.status(403).json({ error: 'Not your request' });
    if (job.rows[0].status !== 'pending_acceptance')
      return res.status(400).json({ error: 'Job is not pending acceptance' });

    await pool.query(`UPDATE jobs SET status='in_progress' WHERE id=$1`, [req.params.id]);
    // Hold payment in escrow
    await pool.query(
      `INSERT INTO payments (job_id, commissioner_id, printer_id, amount)
       VALUES ($1,$2,$3,$4) ON CONFLICT (job_id) DO UPDATE SET amount=$4, status='held'`,
      [req.params.id, job.rows[0].commissioner_id, job.rows[0].assigned_printer_id, job.rows[0].budget_max]
    );
    res.json({ message: 'Request accepted, payment held in escrow' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/jobs/:id/decline — partner declines the request
router.patch('/:id/decline', auth, async (req, res) => {
  try {
    const job = await pool.query(
      `SELECT j.*, p.user_id as partner_user_id FROM jobs j
       JOIN printer_profiles p ON p.id=j.assigned_printer_id
       WHERE j.id=$1`, [req.params.id]
    );
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].partner_user_id !== req.user.id)
      return res.status(403).json({ error: 'Not your request' });

    await pool.query(`UPDATE jobs SET status='cancelled' WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Request declined' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/jobs — list jobs for commissioner (mine) or partner (incoming)
router.get('/', auth, async (req, res) => {
  const { status, mine, incoming } = req.query;
  let query = `SELECT j.*, u.name as commissioner_name,
                      pu.name as partner_name
               FROM jobs j
               JOIN users u ON u.id=j.commissioner_id
               LEFT JOIN printer_profiles pp ON pp.id=j.assigned_printer_id
               LEFT JOIN users pu ON pu.id=pp.user_id
               WHERE 1=1`;
  const params = [];

  if (status) { params.push(status); query += ` AND j.status=$${params.length}`; }
  if (mine === 'true') { params.push(req.user.id); query += ` AND j.commissioner_id=$${params.length}`; }
  if (incoming === 'true') { params.push(req.user.id); query += ` AND pp.user_id=$${params.length}`; }

  query += ' ORDER BY j.created_at DESC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/jobs/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT j.*, u.name as commissioner_name, u.address as commissioner_address
       FROM jobs j JOIN users u ON u.id=j.commissioner_id
       WHERE j.id=$1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Job not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/jobs/:id/status — update job status (printer only)
router.patch('/:id/status', auth, async (req, res) => {
  const { status, tracking_number, courier } = req.body;
  try {
    const job = await pool.query(
      `SELECT j.*, p.user_id as printer_user_id
       FROM jobs j LEFT JOIN printer_profiles p ON p.id=j.assigned_printer_id
       WHERE j.id=$1`,
      [req.params.id]
    );
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].printer_user_id !== req.user.id)
      return res.status(403).json({ error: 'Not your job' });

    const result = await pool.query(
      `UPDATE jobs SET status=$1, tracking_number=COALESCE($2, tracking_number),
       courier=COALESCE($3, courier),
       shipped_at=CASE WHEN $1='shipped' THEN NOW() ELSE shipped_at END
       WHERE id=$4 RETURNING *`,
      [status, tracking_number || null, courier || null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/jobs/:id/cancel
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const job = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });
    if (job.rows[0].commissioner_id !== req.user.id)
      return res.status(403).json({ error: 'Not your job' });

    const currentStatus = job.rows[0].status;
    const alreadyPrinting = ['printing', 'shipped'].includes(currentStatus);

    await pool.query('UPDATE jobs SET status=$1 WHERE id=$2', ['cancelled', req.params.id]);

    // If printing started, partial refund — otherwise full refund
    if (alreadyPrinting) {
      await pool.query(
        `UPDATE payments SET status='partial_refund' WHERE job_id=$1`,
        [req.params.id]
      );
    } else {
      await pool.query(
        `UPDATE payments SET status='refunded', refund_amount=amount WHERE job_id=$1`,
        [req.params.id]
      );
    }

    res.json({ message: 'Job cancelled', partial_refund: alreadyPrinting });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/jobs/:id/fail — printer reports failure
router.post('/:id/fail', auth, async (req, res) => {
  const { reason, note } = req.body;
  if (!reason) return res.status(400).json({ error: 'reason required' });

  try {
    const job = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!job.rows.length) return res.status(404).json({ error: 'Job not found' });

    // Get existing failure report for retry count
    const existing = await pool.query(
      'SELECT * FROM failure_reports WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    const retryCount = existing.rows.length ? existing.rows[0].retry_count + 1 : 0;

    await pool.query(
      `INSERT INTO failure_reports (job_id, printer_id, reason, note, retry_count)
       VALUES ($1, (SELECT id FROM printer_profiles WHERE user_id=$2), $3, $4, $5)`,
      [req.params.id, req.user.id, reason, note, retryCount]
    );

    // If printer fault, increment failure_count on profile
    if (reason === 'printer_fault') {
      await pool.query(
        `UPDATE printer_profiles SET failure_count = failure_count + 1 WHERE user_id=$1`,
        [req.user.id]
      );
    }

    // If material issue, re-queue immediately
    if (reason === 'material_issue' || reason === 'external') {
      await pool.query(
        `UPDATE jobs SET status='open', assigned_printer_id=NULL WHERE id=$1`,
        [req.params.id]
      );
      // Partial pay to printer for time spent
      await pool.query(
        `UPDATE payments SET status='partial_refund' WHERE job_id=$1`,
        [req.params.id]
      );
    } else {
      // Printer fault — offer reprint to commissioner, status = failed
      await pool.query(`UPDATE jobs SET status='failed' WHERE id=$1`, [req.params.id]);
    }

    res.json({ message: 'Failure reported', reason, requeue: reason !== 'printer_fault' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/jobs/:id/reprint — commissioner requests reprint
router.post('/:id/reprint', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE failure_reports SET reprint_requested=TRUE
       WHERE job_id=$1 AND id=(
         SELECT id FROM failure_reports WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1
       )`,
      [req.params.id]
    );
    await pool.query(`UPDATE jobs SET status='printing' WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Reprint requested' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/jobs/:id/requeue — commissioner gives up, re-open to new printers
router.post('/:id/requeue', auth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE jobs SET status='open', assigned_printer_id=NULL WHERE id=$1`,
      [req.params.id]
    );
    // Partial pay to original printer for time spent
    await pool.query(
      `UPDATE payments SET status='partial_refund' WHERE job_id=$1`,
      [req.params.id]
    );
    res.json({ message: 'Job re-queued to new printers' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
