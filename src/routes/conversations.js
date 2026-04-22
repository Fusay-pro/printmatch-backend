const router = require('express').Router();
const pool = require('../db/pool');
const auth = require('../middleware/auth');

// POST /api/conversations — start or get existing convo between commissioner & partner
router.post('/', auth, async (req, res) => {
  const { partner_user_id } = req.body;
  if (!partner_user_id) return res.status(400).json({ error: 'partner_user_id required' });
  try {
    const result = await pool.query(
      `INSERT INTO conversations (commissioner_id, partner_user_id)
       VALUES ($1,$2)
       ON CONFLICT (commissioner_id, partner_user_id)
       DO UPDATE SET created_at=conversations.created_at
       RETURNING *`,
      [req.user.id, partner_user_id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/conversations — list all conversations for current user
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*,
              cu.name as commissioner_name,
              pu.name as partner_name,
              (SELECT cm.content FROM conversation_messages cm
               WHERE cm.conversation_id=c.id ORDER BY cm.created_at DESC LIMIT 1) as last_message,
              (SELECT cm.created_at FROM conversation_messages cm
               WHERE cm.conversation_id=c.id ORDER BY cm.created_at DESC LIMIT 1) as last_message_at
       FROM conversations c
       JOIN users cu ON cu.id=c.commissioner_id
       JOIN users pu ON pu.id=c.partner_user_id
       WHERE c.commissioner_id=$1 OR c.partner_user_id=$1
       ORDER BY last_message_at DESC NULLS LAST, c.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/conversations/:id/messages
router.get('/:id/messages', auth, async (req, res) => {
  try {
    // Verify user is part of this conversation
    const conv = await pool.query(
      `SELECT c.*,
              cu.name AS commissioner_name,
              pu.name AS partner_name
       FROM conversations c
       JOIN users cu ON cu.id = c.commissioner_id
       JOIN users pu ON pu.id = c.partner_user_id
       WHERE c.id=$1 AND (c.commissioner_id=$2 OR c.partner_user_id=$2)`,
      [req.params.id, req.user.id]
    );
    if (!conv.rows.length) return res.status(403).json({ error: 'Forbidden' });

    const result = await pool.query(
      `SELECT cm.*, u.name as sender_name
       FROM conversation_messages cm
       JOIN users u ON u.id=cm.sender_id
       WHERE cm.conversation_id=$1
       ORDER BY cm.created_at ASC`,
      [req.params.id]
    );
    res.json({ conversation: conv.rows[0], messages: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/conversations/:id/messages — send text or offer
router.post('/:id/messages', auth, async (req, res) => {
  const { content, msg_type, offer_data } = req.body;
  try {
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id=$1 AND (commissioner_id=$2 OR partner_user_id=$2)',
      [req.params.id, req.user.id]
    );
    if (!conv.rows.length) return res.status(403).json({ error: 'Forbidden' });

    // Only partner can send offers
    if (msg_type === 'offer' && conv.rows[0].partner_user_id !== req.user.id)
      return res.status(403).json({ error: 'Only the partner can send offers' });

    const result = await pool.query(
      `INSERT INTO conversation_messages (conversation_id, sender_id, content, msg_type, offer_data)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, req.user.id, content || null,
       msg_type || 'text', offer_data ? JSON.stringify(offer_data) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/conversations/:id/offers/:msgId/accept — commissioner accepts offer → creates job
router.patch('/:id/offers/:msgId/accept', auth, async (req, res) => {
  try {
    const conv = await pool.query(
      'SELECT * FROM conversations WHERE id=$1 AND commissioner_id=$2',
      [req.params.id, req.user.id]
    );
    if (!conv.rows.length) return res.status(403).json({ error: 'Only the commissioner can accept' });

    const msg = await pool.query(
      'SELECT * FROM conversation_messages WHERE id=$1 AND msg_type=$2',
      [req.params.msgId, 'offer']
    );
    if (!msg.rows.length) return res.status(404).json({ error: 'Offer not found' });

    const offer = msg.rows[0].offer_data;
    const c = conv.rows[0];

    // Normalize material to match material_type enum
    const MATERIAL_NORM = {
      PLA:'PLA', ABS:'ABS', PETG:'PETG',
      Resin:'resin', resin:'resin', RESIN:'resin',
      TPU:'TPU', Nylon:'nylon', nylon:'nylon', NYLON:'nylon',
      ASA:'other', Other:'other', other:'other',
    };
    const material = MATERIAL_NORM[offer.material] || 'other';

    // Fetch STL file URL from the original request message
    const reqMsg = await pool.query(
      `SELECT content FROM conversation_messages
       WHERE conversation_id=$1 AND msg_type='request'
       ORDER BY created_at ASC LIMIT 1`,
      [req.params.id]
    );
    const requestContent = reqMsg.rows[0] ? JSON.parse(reqMsg.rows[0].content) : {};

    // Get printer profile id for partner
    const printer = await pool.query(
      'SELECT id FROM printer_profiles WHERE user_id=$1', [c.partner_user_id]
    );
    if (!printer.rows.length) return res.status(404).json({ error: 'Partner profile not found' });

    // Create the job
    const job = await pool.query(
      `INSERT INTO jobs
         (commissioner_id, assigned_printer_id, title, description, material,
          estimated_weight_g, estimated_time_hr, complexity, is_rush,
          budget_max, stl_file_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'in_progress') RETURNING *`,
      [req.user.id, printer.rows[0].id,
       offer.title, offer.description || null, material,
       offer.weight_g || null, offer.time_hr || null,
       offer.complexity || 'medium', offer.is_rush || false,
       offer.price, requestContent.file_url || null]
    );

    // Hold payment in escrow
    await pool.query(
      `INSERT INTO payments (job_id, commissioner_id, printer_id, amount)
       VALUES ($1,$2,$3,$4)`,
      [job.rows[0].id, req.user.id, printer.rows[0].id, offer.price]
    );

    // Mark offer as accepted in message
    await pool.query(
      `UPDATE conversation_messages
       SET offer_data = jsonb_set(offer_data, '{accepted}', 'true') ||
                       jsonb_build_object('job_id', $2::text)
       WHERE id = $1`,
      [req.params.msgId, job.rows[0].id]
    );

    res.json({ job: job.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM conversations WHERE id=$1 AND (commissioner_id=$2 OR partner_user_id=$2) RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(403).json({ error: 'Not found or forbidden' });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
