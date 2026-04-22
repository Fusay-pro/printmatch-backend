// seed/unseed.js — Remove ALL demo data in one shot
// Safe to run at any time. Cascades through printer_profiles,
// conversations, messages, etc. automatically.

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const pool = require('../src/db/pool')

async function unseed() {
  console.log('Removing demo data (@demo.printmatch.test accounts)...')

  const result = await pool.query(
    `DELETE FROM users WHERE email LIKE '%@demo.printmatch.test' RETURNING id`
  )

  console.log(`✓ Removed ${result.rowCount} demo users`)
  console.log('  (printer_profiles, conversations, messages all cascade-deleted)')

  await pool.end()
}

unseed().catch(e => { console.error('Unseed failed:', e.message); process.exit(1) })
