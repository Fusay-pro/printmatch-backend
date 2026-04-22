// routes/portfolio.js — partner portfolio showcase
const router = require('express').Router()
const pool   = require('../db/pool')
const auth   = require('../middleware/auth')

// GET /api/portfolio/printer/:printerId — public, list portfolio items
router.get('/printer/:printerId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, image_url, caption, created_at
       FROM printer_portfolio
       WHERE printer_profile_id = $1
       ORDER BY created_at DESC`,
      [req.params.printerId]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to load portfolio' })
  }
})

// POST /api/portfolio — add portfolio item (partner only)
router.post('/', auth, async (req, res) => {
  const { image_url, image_key, caption } = req.body
  if (!image_url) return res.status(400).json({ error: 'image_url required' })

  // Resolve the requester's printer_profile_id
  const ppRes = await pool.query(
    `SELECT id FROM printer_profiles WHERE user_id = $1 AND status = 'approved'`,
    [req.user.id]
  )
  if (!ppRes.rows.length) return res.status(403).json({ error: 'Not an approved partner' })
  const printerId = ppRes.rows[0].id

  // Cap at 12 portfolio items
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM printer_portfolio WHERE printer_profile_id = $1`, [printerId]
  )
  if (parseInt(countRes.rows[0].count) >= 12) {
    return res.status(400).json({ error: 'Maximum 12 portfolio items allowed' })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO printer_portfolio (printer_profile_id, image_url, image_key, caption)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [printerId, image_url, image_key || null, caption || null]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to add portfolio item' })
  }
})

// DELETE /api/portfolio/:id — remove own portfolio item
router.delete('/:id', auth, async (req, res) => {
  const ppRes = await pool.query(
    `SELECT id FROM printer_profiles WHERE user_id = $1`, [req.user.id]
  )
  if (!ppRes.rows.length) return res.status(403).json({ error: 'Forbidden' })

  const { rowCount } = await pool.query(
    `DELETE FROM printer_portfolio
     WHERE id = $1 AND printer_profile_id = $2`,
    [req.params.id, ppRes.rows[0].id]
  )
  if (!rowCount) return res.status(404).json({ error: 'Not found' })
  res.json({ deleted: true })
})

module.exports = router
