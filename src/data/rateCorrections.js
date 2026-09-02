// ─────────────────────────────────────────────────────────────────────────────
// Hand corrections to the generated rate table.
//
// `rates.js` is generated from the workbook and gets overwritten whenever the
// workbook is re-exported. A rate corrected directly in that file would revert
// silently and without warning, so corrections live here instead and are laid
// over the generated table at lookup time.
//
// Every entry is a rate the workbook has wrong, not a rate it is missing — a
// missing rate is left missing so the app can say so. Each carries the date and
// the reason, because the next person to re-export the workbook needs to know
// whether this list is still right.
// ─────────────────────────────────────────────────────────────────────────────

// Empty is the healthy state: it means the workbook and the app agree.
//
// The last entry here was the self-pay psychiatric evaluation, corrected from
// $650 to $675 on 2026-08-31. The 2026 revision of the workbook carries $675,
// so the correction has been retired rather than left to sit as a no-op — an
// entry that no longer changes anything is one nobody can tell is still needed.
export const RATE_CORRECTIONS = []

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
