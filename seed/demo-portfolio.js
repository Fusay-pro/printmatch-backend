// seed/demo-portfolio.js — Add demo portfolio photos to first 10 demo partners
// Uses free public images from picsum.photos (no S3 needed)
// Remove with: node seed/unseed.js  (cascades automatically)

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const pool = require('../src/db/pool')

// 3D-printing-flavoured captions
const CAPTIONS = [
  'Custom mechanical keyboard case – PLA+',
  'D&D miniature set, 0.1mm layer height',
  'Replacement drone arm – PETG',
  'Articulated dragon, 24-part print',
  'Architectural scale model',
  'Cosplay helmet visor frame – ABS',
  'Cable management desk bracket',
  'Resin jewelry mold – 4K print',
  'Functional snap-fit enclosure',
  'Voron 2.4 toolhead assembly',
  'TPU phone grip customised',
  'Wall-mount bracket for monitor arm',
  'Fan duct upgrade – heat-resistant ASA',
  'Miniature chess set – 32 pieces',
  'Prototype product housing',
]

// Picsum seeds that look interesting (consistent, free, no auth)
const IMAGE_SEEDS = [
  // These seed values produce varied, good-looking photos
  10, 20, 37, 42, 56, 64, 77, 83, 91, 103,
  115, 128, 134, 147, 158, 162, 175, 189, 194, 207,
  213, 226, 238, 241, 255, 267, 272, 284, 291, 304,
]

function pickCaptions(n) {
  return [...CAPTIONS].sort(() => Math.random() - 0.5).slice(0, n)
}

async function seedPortfolio() {
  // Get first 10 approved demo partners
  const { rows: partners } = await pool.query(`
    SELECT pp.id
    FROM printer_profiles pp
    JOIN users u ON u.id = pp.user_id
    WHERE u.email LIKE '%@demo.printmatch.test'
      AND pp.status = 'approved'
    ORDER BY pp.created_at ASC
    LIMIT 30
  `)

  if (!partners.length) {
    console.log('No demo partners found. Run node seed/demo.js first.')
    await pool.end()
    return
  }

  console.log(`Adding portfolio photos to ${partners.length} demo partners...\n`)


  let total = 0
  const seedPool = [...IMAGE_SEEDS].sort(() => Math.random() - 0.5)

  for (let i = 0; i < partners.length; i++) {
    const { id: printerId } = partners[i]
    const count = 2 + Math.floor(Math.random() * 4) // 2–5 photos each
    const captions = pickCaptions(count)

    for (let j = 0; j < count; j++) {
      const seed = seedPool[(i * 3 + j) % seedPool.length]
      const imageUrl = `https://picsum.photos/seed/${seed}/600/450`

      await pool.query(
        `INSERT INTO printer_portfolio (printer_profile_id, image_url, caption)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [printerId, imageUrl, captions[j]]
      )
      total++
    }

    console.log(`  Partner ${i + 1}/${partners.length} — ${count} photos added`)
  }

  console.log(`\n✓ ${total} portfolio photos seeded across ${partners.length} partners`)
  console.log('  Hover a card in Browse Partners to see the popup preview\n')

  await pool.end()
}

seedPortfolio().catch(e => { console.error('Failed:', e.message); process.exit(1) })
