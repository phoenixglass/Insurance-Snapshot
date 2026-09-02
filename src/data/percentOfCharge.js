// ─────────────────────────────────────────────────────────────────────────────
// Payers priced off our own charge master, because they price off it too.
//
// A few plans have no allowed amounts on file at all — the workbook's row for
// them is empty — but their claims come back at a stable percentage of what we
// billed. That percentage is a rate: 30% of a $5,450 detox night is $1,635, and
// $1,635 is a far better number to quote than the $0 an unpriced line costs.
//
// It is not the same kind of fact as a contracted rate or a stated allowed
// amount, though, so it resolves after both, never displaces either, and is
// tagged on screen with the percentage it came from. A staff member looking at
// the line can see it is arithmetic on our charge master rather than a number
// the plan has agreed to.
//
// The base is the charge master itself — the `billed` column of the signed
// contract schedules — so a change to what we charge moves these rates with it
// instead of leaving them behind at last year's figure.
// ─────────────────────────────────────────────────────────────────────────────

import { CONTRACT_SCHEDULES } from './contractRates.js'

// carrier name → how their claims are processing.
//
// `percent` is of billed charges. `roundUpTo` is the workbook's own rule for an
// out-of-network rate — "OON RATES ARE ROUNDED UP TO THE NEXT $5 INCREMENT" —
// carried here per payer rather than inferred, so an in-network payer added
// later is not silently rounded as well.
export const PERCENT_OF_CHARGE_PAYERS = {
  'Diversified Group -': {
    percent: 0.3,
    roundUpTo: 5,
    noted: '2026-09-02',
    reason:
      'No allowed amounts on file for this plan. Claims are processing at 30% of billed charges.',
  },
}

// One location bills 90834 and 90840 differently from the others. A derived
// rate needs a single number, so it takes the one most schedules carry, and the
// lower of two where they tie: a rate we worked out ourselves should not be the
// highest reading available.
function consensus(values) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
}

const CHARGE_MASTER = (() => {
  const billedByCode = {}
  for (const schedule of CONTRACT_SCHEDULES) {
    for (const [code, rate] of Object.entries(schedule.rates)) {
      if (typeof rate.billed === 'number') {
        billedByCode[code] = billedByCode[code] || []
        billedByCode[code].push(rate.billed)
      }
    }
  }
  return Object.fromEntries(
    Object.entries(billedByCode).map(([code, values]) => [code, consensus(values)])
  )
})()

// What we bill for a code, or null where the schedules do not name it. A code
// with no charge on file gets no derived rate — an invented base would make the
// whole line invented.
export function chargeMasterRate(code) {
  const billed = CHARGE_MASTER[String(code)]
  return typeof billed === 'number' ? billed : null
}

export function percentOfChargePayer(carrier) {
  return PERCENT_OF_CHARGE_PAYERS[carrier] || null
}

// The derived rate for a carrier and code, with the workings, or null when this
// payer is not priced this way or the code has no charge on file.
export function percentOfChargeRate(carrier, code) {
  const payer = PERCENT_OF_CHARGE_PAYERS[carrier]
  if (!payer) return null
  const billed = chargeMasterRate(code)
  if (billed === null) return null
  const raw = billed * payer.percent
  const rate = payer.roundUpTo
    ? Math.ceil(raw / payer.roundUpTo) * payer.roundUpTo
    : Math.round(raw * 100) / 100
  return { rate, percent: payer.percent, billed }
}
