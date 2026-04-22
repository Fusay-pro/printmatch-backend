const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const { calcMatchScore, calcSuggestedPrice } = require('../utils/matching');

// POST /api/printers — create printer profile
router.post('/', auth, async (req, res) => {
  const { bio, printers_owned, filaments, printer_wattage,
          province, district, address, phone, line_id } = req.body;

  try {
    const existing = await pool.query(
      'SELECT id FROM printer_profiles WHERE user_id=$1', [req.user.id]
    );
    if (existing.rows.length)
      return res.status(409).json({ error: 'Printer profile already exists' });

    const result = await pool.query(
      `INSERT INTO printer_profiles
         (user_id, bio, printers_owned, filaments, printer_wattage,
          province, district, phone, line_id, rate_per_hour, material_prices)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, 0, '{}') RETURNING *`,
      [req.user.id, bio || null, printers_owned || [],
       filaments || [], printer_wattage || 250,
       province || null, district || null, phone || null, line_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/printers — browse approved partners
router.get('/', auth, async (req, res) => {
  const { filament, province, search } = req.query;
  try {
    let query = `
      SELECT p.id, p.user_id, p.bio, p.printers_owned, p.filaments, p.printer_wattage,
             p.province, p.district, p.avg_rating, p.total_reviews, p.jobs_completed,
             p.is_available, u.name, u.avatar_url,
             COALESCE((
               SELECT json_agg(sub.image_url)
               FROM (SELECT image_url FROM printer_portfolio WHERE printer_profile_id = p.id ORDER BY created_at DESC LIMIT 3) sub
             ), '[]'::json) AS portfolio_preview
      FROM printer_profiles p JOIN users u ON u.id=p.user_id
      WHERE p.status='approved'`;
    const params = [];
    if (filament) { params.push(`%${filament}%`); query += ` AND p.filaments::text ILIKE $${params.length}`; }
    if (province) { params.push(province); query += ` AND p.province=$${params.length}`; }
    if (search)   { params.push(`%${search}%`); query += ` AND (u.name ILIKE $${params.length} OR p.bio ILIKE $${params.length})`; }
    query += ' ORDER BY p.avg_rating DESC, p.jobs_completed DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/printers/by-user/:userId — get partner profile by user id
router.get('/by-user/:userId', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name, u.email, u.avatar_url
       FROM printer_profiles p JOIN users u ON u.id=p.user_id
       WHERE p.user_id=$1 AND p.status='approved'`,
      [req.params.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Partner not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/printers/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name, u.email, u.avatar_url, u.address, u.latitude, u.longitude
       FROM printer_profiles p JOIN users u ON u.id=p.user_id
       WHERE p.id=$1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Printer not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/printers/:id
router.patch('/:id', auth, async (req, res) => {
  const { bio, printers_owned, filaments, printer_wattage,
          is_available, province, district, phone, line_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE printer_profiles
       SET bio             = COALESCE($1, bio),
           printers_owned  = COALESCE($2, printers_owned),
           filaments       = COALESCE($3, filaments),
           printer_wattage = COALESCE($4, printer_wattage),
           is_available    = COALESCE($5, is_available),
           province        = COALESCE($6, province),
           district        = COALESCE($7, district),
           phone           = COALESCE($8, phone),
           line_id         = COALESCE($9, line_id)
       WHERE id=$10 AND user_id=$11 RETURNING *`,
      [bio ?? null, printers_owned ?? null,
       filaments ?? null, printer_wattage ?? null,
       is_available ?? null,
       province ?? null, district ?? null, phone ?? null, line_id ?? null,
       req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/printers/match/:jobId — ranked printer list for a job
router.get('/match/:jobId', auth, async (req, res) => {
  try {
    const jobResult = await pool.query(
      `SELECT j.*, u.latitude as comm_lat, u.longitude as comm_lng
       FROM jobs j JOIN users u ON u.id=j.commissioner_id
       WHERE j.id=$1`,
      [req.params.jobId]
    );
    if (!jobResult.rows.length) return res.status(404).json({ error: 'Job not found' });
    const job = jobResult.rows[0];

    // Get all available printers that support the material
    const printersResult = await pool.query(
      `SELECT p.*, u.name, u.latitude, u.longitude, u.address, u.avatar_url
       FROM printer_profiles p JOIN users u ON u.id=p.user_id
       WHERE p.is_available=TRUE
         AND p.material_prices ? $1`,
      [job.material]
    );

    const commUser = { latitude: job.comm_lat, longitude: job.comm_lng };

    const ranked = printersResult.rows
      .map((printer) => {
        const printerUser = { latitude: printer.latitude, longitude: printer.longitude };
        const score = calcMatchScore(printer, printerUser, job, commUser);
        const suggested_price = calcSuggestedPrice(printer, job);
        return { ...printer, match_score: score, suggested_price };
      })
      .filter((p) => parseFloat(p.suggested_price) <= job.budget_max)
      .sort((a, b) => b.match_score - a.match_score);

    res.json(ranked);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
