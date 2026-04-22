// seed/demo.js — Insert 500 demo partners + 20 commissioners + conversations
// All demo accounts use @demo.printmatch.test emails
// Remove everything with:  node seed/unseed.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const pool = require('../src/db/pool')
const bcrypt = require('bcryptjs')

const DEMO_DOMAIN = '@demo.printmatch.test'
const DEMO_PASSWORD = 'demo1234'

// ── Data pools ──────────────────────────────────────────────────────────────

const LOCATIONS = [
  { province: 'Bangkok',            districts: ['Chatuchak', 'Lat Phrao', 'Bang Kapi', 'Huai Khwang', 'Din Daeng', 'Phra Khanong', 'Min Buri', 'Sathon', 'Bang Rak', 'Pathum Wan'] },
  { province: 'Chiang Mai',         districts: ['Mueang', 'San Sai', 'Hang Dong', 'Mae Rim', 'Saraphi', 'San Kamphaeng', 'Doi Saket', 'Chom Thong'] },
  { province: 'Phuket',             districts: ['Mueang', 'Kathu', 'Thalang'] },
  { province: 'Khon Kaen',          districts: ['Mueang', 'Ban Phai', 'Chum Phae', 'Nam Phong', 'Udon Phatthana'] },
  { province: 'Nakhon Ratchasima',  districts: ['Mueang', 'Pak Chong', 'Bua Yai', 'Chok Chai', 'Phimai'] },
  { province: 'Chon Buri',          districts: ['Mueang', 'Bang Lamung', 'Si Racha', 'Pattaya', 'Sattahip'] },
  { province: 'Songkhla',           districts: ['Mueang', 'Hat Yai', 'Sadao', 'Na Thawi', 'Chana'] },
  { province: 'Nonthaburi',         districts: ['Mueang', 'Bang Yai', 'Bang Bua Thong', 'Pak Kret', 'Bang Kruai'] },
  { province: 'Pathum Thani',       districts: ['Mueang', 'Thanyaburi', 'Lam Luk Ka', 'Khlong Luang', 'Sam Khok'] },
  { province: 'Samut Prakan',       districts: ['Mueang', 'Bang Phli', 'Bang Bo', 'Phra Pradaeng', 'Bang Sao Thong'] },
  { province: 'Chiang Rai',         districts: ['Mueang', 'Mae Chan', 'Chiang Saen', 'Wiang Chai', 'Mae Suai'] },
  { province: 'Udon Thani',         districts: ['Mueang', 'Kumphawapi', 'Nong Wua So', 'Ban Dung', 'Nam Som'] },
]

const PRINTERS = [
  'Bambu Lab X1C', 'Bambu Lab P1S', 'Bambu Lab A1 Mini', 'Bambu Lab P1P',
  'Prusa MK4', 'Prusa MINI+', 'Prusa XL',
  'Creality Ender 3 V3', 'Creality K1 Max', 'Creality CR-10 S5', 'Creality K2 Plus',
  'Anycubic Kobra 3', 'Anycubic Photon Mono X2', 'Anycubic Kobra Max',
  'Elegoo Saturn 4 Ultra', 'Elegoo Neptune 4 Pro', 'Elegoo Mars 4 Ultra',
  'Flashforge Adventurer 5M Pro', 'Flashforge Creator 3',
  'Voron 2.4', 'Voron Trident', 'RatRig V-Core 4',
  'Artillery Sidewinder X3 Pro', 'Artillery Genius Pro',
  'Sovol SV08', 'Sovol SV06 Plus',
]

const FILAMENTS = ['PLA', 'PETG', 'ABS', 'TPU', 'Resin', 'Nylon', 'ASA']

const FIRST_NAMES = [
  'Arm', 'Beam', 'Bank', 'Best', 'Bow', 'Chai', 'Dek', 'Earn', 'Film', 'Gift',
  'Gig', 'Got', 'James', 'Jay', 'Joy', 'June', 'Kate', 'Kay', 'Ken', 'Kim',
  'Krit', 'Lee', 'Lek', 'Lin', 'Luke', 'May', 'Mike', 'Min', 'Nam', 'Nan',
  'New', 'Nice', 'Nick', 'Nit', 'Note', 'Num', 'Oak', 'Off', 'Oil', 'Om',
  'Orm', 'Pat', 'Pete', 'Pim', 'Ploy', 'Pop', 'Port', 'Praew', 'Pun', 'Rin',
  'Sam', 'Sao', 'Sean', 'Sin', 'Som', 'Sun', 'Tan', 'Tarn', 'Tim', 'Ting',
  'Ton', 'Tong', 'Top', 'Wan', 'Win', 'Yok', 'Naree', 'Somchai', 'Fah', 'Nook',
  'Bun', 'Lena', 'Nina', 'Paul', 'Sara', 'Alex', 'Chris', 'Mark', 'John', 'Anna',
]

const LAST_NAMES = [
  'Siripong', 'Wongsawat', 'Pattana', 'Chaiyo', 'Suthirak', 'Promma',
  'Sakulrat', 'Chaiwat', 'Lertsiri', 'Boonma', 'Thongchai', 'Srisuk',
  'Khamhan', 'Rangsit', 'Phakdi', 'Suwannarat', 'Charoenwong', 'Kongkam',
  'Rattana', 'Somboon', 'Wiriyawong', 'Noppadon', 'Phetsuwan', 'Wongsa',
  'Manee', 'Nakorn', 'Prasert', 'Siriwan', 'Thamma', 'Khanong',
]

const BIOS = [
  'Passionate maker with 3+ years of printing experience. Specialising in functional parts and prototypes.',
  'Engineering student turned full-time printer. Love complex geometries and tight tolerances.',
  'Home studio with 2 printers running 24/7. Fast turnaround, great quality.',
  'Architect by day, maker by night. Expert in large-format prints and architectural models.',
  'Ex-factory worker with deep knowledge of material properties. Quality guaranteed.',
  'Hobbyist turned professional. Every print is treated like a work of art.',
  'Multi-material specialist — ABS, PETG, TPU handled with precision.',
  'Climate-controlled studio for consistent, warp-free results every time.',
  'Game model enthusiast who loves detailed miniatures and cosplay props.',
  'Industrial designer with a fleet of printers. Production runs welcome.',
  'Resin specialist for ultra-fine detail work — jewelry, dental, miniatures.',
  'FDM expert, 5 years experience. Prototyping, jigs, fixtures are my specialty.',
  'Maker space operator. Multiple machines, fast delivery, bulk pricing available.',
  'Engineer with material science background. I know my filaments inside out.',
  'Reliable side hustle. Affordable pricing, clean supports, fast shipping.',
  'Based in Bangkok, shipping nationwide. Same-day printing for small jobs.',
  'Voron builder with years of calibration experience. Dimensional accuracy is priority.',
  'Running Bambu Lab X1C for speed and P1S for quality. Best of both worlds.',
  null,
  null,
]

// ── Helpers ──────────────────────────────────────────────────────────────────

const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const pickMultiple = (arr, min, max) => {
  const count = min + Math.floor(Math.random() * (max - min + 1))
  return [...arr].sort(() => Math.random() - 0.5).slice(0, count)
}
const rand = (min, max) => min + Math.random() * (max - min)
const randInt = (min, max) => Math.floor(rand(min, max + 1))

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
  console.log('✓ Password hashed\n')

  // ── 1. Insert 500 demo partners ───────────────────────────────────────────
  console.log('Inserting 500 demo partners...')
  const partnerIds = []

  for (let i = 1; i <= 500; i++) {
    const name  = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`
    const email = `partner${String(i).padStart(3, '0')}${DEMO_DOMAIN}`
    const loc   = pick(LOCATIONS)

    const { rows: [user] } = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [name, email, passwordHash]
    )

    const filaments = pickMultiple(FILAMENTS, 1, 5)
    const printers  = pickMultiple(PRINTERS, 1, 3)
    const rating    = parseFloat(rand(3.2, 5.0).toFixed(2))
    const reviews   = randInt(0, 150)
    const jobs      = randInt(0, 250)
    const available = Math.random() > 0.22  // ~78% available

    await pool.query(
      `INSERT INTO printer_profiles
         (user_id, bio, filaments, printers_owned, province, district,
          avg_rating, total_reviews, jobs_completed, is_available, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved')`,
      [user.id, pick(BIOS), filaments, printers,
       loc.province, pick(loc.districts),
       rating, reviews, jobs, available]
    )

    partnerIds.push(user.id)
    if (i % 100 === 0) console.log(`  ${i}/500 partners...`)
  }

  console.log('✓ 500 partners done\n')

  // ── 2. Insert 20 demo commissioners ──────────────────────────────────────
  console.log('Inserting 20 demo commissioners...')
  const commIds = []

  for (let i = 1; i <= 20; i++) {
    const name  = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`
    const email = `user${String(i).padStart(2, '0')}${DEMO_DOMAIN}`

    const { rows: [user] } = await pool.query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [name, email, passwordHash]
    )
    commIds.push(user.id)
  }

  console.log('✓ 20 commissioners done\n')

  // ── 3. Insert ~60 demo conversations (3 per commissioner) ─────────────────
  console.log('Inserting demo conversations & messages...')
  let convCount = 0

  for (const commId of commIds) {
    const shuffled = [...partnerIds].sort(() => Math.random() - 0.5).slice(0, 3)
    for (const partnerId of shuffled) {
      try {
        const { rows: [conv] } = await pool.query(
          `INSERT INTO conversations (commissioner_id, partner_user_id)
           VALUES ($1, $2) RETURNING id`,
          [commId, partnerId]
        )

        // Seed initial request message
        const titles = [
          'Custom phone stand with cable management',
          'Miniature D&D dungeon tiles × 20',
          'Replacement bracket for IKEA shelf',
          'Cosplay helmet visor frame',
          'Mechanical keyboard case prototype',
          'Wall-mount bracket for monitor arm',
          'Articulated dragon figurine',
          'Drone frame replacement arm',
        ]
        const materials = ['PLA', 'PETG', 'ABS', 'TPU', 'Resin']
        const reqData = {
          title: pick(titles),
          material: pick(materials),
          weight_g: randInt(20, 500),
          is_rush: Math.random() > 0.8,
        }

        await pool.query(
          `INSERT INTO conversation_messages (conversation_id, sender_id, msg_type, content, offer_data)
           VALUES ($1, $2, 'request', $3, $4)`,
          [conv.id, commId, JSON.stringify(reqData), JSON.stringify(reqData)]
        )

        // Maybe add a few text replies
        if (Math.random() > 0.4) {
          const replies = [
            'Looks interesting! Can you share the STL file?',
            'Sure, I can handle this. What\'s your deadline?',
            'I\'ve done similar jobs before — no problem.',
            'What colour were you thinking?',
            'Happy to help. Do you need supports removed?',
          ]
          await pool.query(
            `INSERT INTO conversation_messages (conversation_id, sender_id, msg_type, content)
             VALUES ($1, $2, 'text', $3)`,
            [conv.id, partnerId, pick(replies)]
          )
        }

        convCount++
      } catch {
        // skip duplicate commissioner+partner pairs (shouldn't happen, but safe)
      }
    }
  }

  console.log(`✓ ${convCount} conversations seeded\n`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════')
  console.log('  Demo data ready!')
  console.log('═══════════════════════════════════════════')
  console.log(`  Partners   : partner001${DEMO_DOMAIN}`)
  console.log(`               partner002${DEMO_DOMAIN}  …  partner500${DEMO_DOMAIN}`)
  console.log(`  Users      : user01${DEMO_DOMAIN}  …  user20${DEMO_DOMAIN}`)
  console.log(`  Password   : ${DEMO_PASSWORD}  (all accounts)`)
  console.log('───────────────────────────────────────────')
  console.log('  To remove: node seed/unseed.js')
  console.log('═══════════════════════════════════════════\n')

  await pool.end()
}

seed().catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
