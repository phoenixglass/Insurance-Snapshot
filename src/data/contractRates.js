// ─────────────────────────────────────────────────────────────────────────────
// In-network contracted rate schedules, by facility location.
//
// These are a different axis from the carrier rate table in `rates.js`. That
// table answers "what does this payer allow?"; a schedule here answers "what
// have we contracted to be paid at this location?" — and where a schedule
// covers a code, it is the authority, because it is a signed rate rather than
// an observed or estimated one.
//
// A code the schedule does not name is absent, not zero. The estimator falls
// back to the carrier table for those and says so.
//
// Transcribed from the contract rate sheets. `billed` is the charge master
// rate; the difference between it and `contracted` is the contractual
// adjustment the schedule also lists, so it is not stored separately.
// ─────────────────────────────────────────────────────────────────────────────

// Every professional (non-facility) rate is identical between the Connecticut
// and New York schedules, so the shared block is written once.
const SHARED_PROFESSIONAL = {
  '90791': { billed: 875, contracted: 118.19 },
  '90792': { billed: 1050, contracted: 176.3 },
  '90832': { billed: 375, contracted: 57.38 },
  '90834': { billed: 545, contracted: 76.72 },
  '90837': { billed: 750, contracted: 95.9 },
  '90839': { billed: 850, contracted: 120.06 },
  '90853': { billed: 525, contracted: 40 },
  '96372': { billed: 695, contracted: 20.5 },
  '99211': { billed: 475, contracted: 25.36 },
  '99212': { billed: 500, contracted: 51.56 },
  '99213': { billed: 545, contracted: 85.65 },
  '99214': { billed: 750, contracted: 126.4 },
  '99215': { billed: 675, contracted: 170.48 },
  '99408': { billed: 115, contracted: 41.58 },
  '99409': { billed: 200, contracted: 80.67 },
  '90847': { billed: 750, contracted: 96.36 },
  '90846': { billed: 600, contracted: 92.62 },
}

export const CONTRACT_SCHEDULES = [
  {
    id: 'ct',
    label: 'Connecticut',
    region: 'CT',
    effective: '7/24/2026 – present',
    // The only schedule that carries facility rates. H0018 is contracted at two
    // rates against two revenue codes — 1,186.00 under rev 1000 (Residential
    // 3.7 and Residential Eval) and 1,045.00 under rev 1002 (Residential 3.5
    // and Residential). The workbook's rate table labels H0018 "Residential
    // 3.5", so the residential line prices at the 1002 rate; `alternates`
    // records the other one rather than losing it.
    rates: {
      'H0010': { billed: 5450, contracted: 1186 },
      'H0018': { billed: 4950, contracted: 1045 },
      'H0014': { billed: 4500, contracted: 485 },
      'H0035': { billed: 3150, contracted: 442 },
      'H0015': { billed: 1550, contracted: 328 },
      ...SHARED_PROFESSIONAL,
      '90840': { billed: 425, contracted: 57.38 },
    },
    alternates: [
      {
        code: 'H0018',
        contracted: 1186,
        note: 'Residential 3.7 / Residential Eval, revenue code 1000',
      },
    ],
  },
  {
    id: 'nj-ramsey',
    label: 'New Jersey — Ramsey',
    region: 'NJ',
    effective: '7/6/2024',
    // Professional rates only; this sheet carries no facility per diems, so
    // detox, residential, PHP and OPWM fall back to the carrier table.
    rates: {
      'H0015': { billed: 1550, contracted: 225 },
      '90791': { billed: 875, contracted: 112.56 },
      '90792': { billed: 1050, contracted: 167.9 },
      '90832': { billed: 375, contracted: 54.65 },
      '90834': { billed: 525, contracted: 73.06 },
      '90837': { billed: 750, contracted: 109.59 },
      '90839': { billed: 850, contracted: 114.35 },
      '90840': { billed: 425, contracted: 54.65 },
      '90853': { billed: 525, contracted: 40 },
      '96372': { billed: 695, contracted: 22.97 },
      '99211': { billed: 475, contracted: 24.16 },
      '99212': { billed: 500, contracted: 49.1 },
      '99213': { billed: 545, contracted: 81.58 },
      '99214': { billed: 750, contracted: 120.38 },
      '99215': { billed: 675, contracted: 162.36 },
      '99408': { billed: 115, contracted: 39.6 },
      '99409': { billed: 200, contracted: 76.82 },
      '90847': { billed: 750, contracted: 91.77 },
      '90846': { billed: 600, contracted: 88.21 },
    },
    alternates: [],
  },
  {
    id: 'ny',
    label: 'New York',
    region: 'NY',
    effective: '12/06/2024',
    rates: {
      'H0015': { billed: 1550, contracted: 305 },
      ...SHARED_PROFESSIONAL,
      '90840': { billed: 475, contracted: 57.38 },
    },
    alternates: [],
  },
]

// Codes the schedules list with no contracted rate — billed but not contracted.
// Named so a service that looks missing can be told apart from one that is
// genuinely uncontracted at this location.
export const UNCONTRACTED_CODES = ['80305', 'H0006', '99368', '98966', '98967', '98968']

const SCHEDULE_BY_ID = new Map(CONTRACT_SCHEDULES.map((s) => [s.id, s]))

export function getSchedule(id) {
  return SCHEDULE_BY_ID.get(id) || null
}

// The contracted rate this schedule pays for a code, or null when the schedule
// does not cover it.
export function scheduleRate(scheduleId, code) {
  const schedule = SCHEDULE_BY_ID.get(scheduleId)
  if (!schedule) return null
  const entry = schedule.rates[String(code)]
  return entry ? entry.contracted : null
}

export function scheduleBilledRate(scheduleId, code) {
  const schedule = SCHEDULE_BY_ID.get(scheduleId)
  if (!schedule) return null
  const entry = schedule.rates[String(code)]
  return entry ? entry.billed : null
}
