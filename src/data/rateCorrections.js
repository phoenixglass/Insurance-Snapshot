// ─────────────────────────────────────────────────────────────────────────────
// Hand corrections to the generated rate table.
//
// `rates.js` is generated from the workbook and gets overwritten whenever the
// workbook is re-exported. A rate corrected directly in that file would revert
// silently and without warning, so corrections live here instead and are laid
// over the generated table at lookup time.
//
// An entry is either a rate the workbook has wrong (`was` holds the old value)
// or a rate the workbook is missing that has since been established by someone
// who knows it (`was: null`). What never goes here is a guess: a rate nobody
// has stated is left missing so the app can say so. Each entry carries the date
// and the reason, because the next person to re-export the workbook needs to
// know whether this list is still right — and once the workbook carries the
// same number, the entry should be retired, not left sitting as a no-op.
// ─────────────────────────────────────────────────────────────────────────────

// The last retired entry was the self-pay psychiatric evaluation, corrected from
// $650 to $675 on 2026-08-31; the 2026 revision of the workbook adopted $675.
export const RATE_CORRECTIONS = [
  // MagnaCare OPWM/OWM, per day. Management set one rate for both MagnaCare
  // rows; the workbook has no H0014 rate for either.
  {
    carrier: 'MagnaCare -',
    code: 'H0014',
    rate: 800,
    was: null,
    noted: '2026-11-20',
    reason: 'MagnaCare OPWM/OWM per-day rate supplied by management; the workbook has none.',
  },
  {
    carrier: 'Magna Care (JPRN Consulting)',
    code: 'H0014',
    rate: 800,
    was: null,
    noted: '2026-11-20',
    reason: 'MagnaCare OPWM/OWM per-day rate supplied by management, applies to the JPRN Consulting row too; the workbook has none.',
  },
]

const BY_CARRIER = RATE_CORRECTIONS.reduce((acc, c) => {
  acc[c.carrier] = acc[c.carrier] || {}
  acc[c.carrier][c.code] = c.rate
  return acc
}, {})

// The corrected rate for a carrier and code, or null when nothing is corrected.
export function correctedRate(carrier, code) {
  const rate = BY_CARRIER[carrier]?.[String(code)]
  return typeof rate === 'number' ? rate : null
}
