// ─────────────────────────────────────────────────────────────────────────────
// Carriers whose rate row depends on the site the client admits to.
//
// The workbook carries Optum as one row per site — "Optum Canaan", "Optum
// Wilton" and so on — because a spreadsheet has no other way to vary a rate by
// location. The estimator already asks for the location in its own field, so
// asking for it a second time inside the carrier name is redundant, and lets
// the two disagree (Optum Wilton picked with Canaan as the location).
//
// So the carrier dropdown offers one entry, and the location picks the row.
// `rows` maps location ids from `contractRates.js` to the generated rate
// table's row names. A location with no row (Mass Virtual) has no Optum rate
// sheet; the estimator falls back to the Optum claims average there and says
// so, rather than borrowing another site's row.
//
// The per-site rows stay in `rates.js` (it is generated from the workbook and
// would bring them back on the next export anyway); they are only hidden from
// the carrier dropdowns.
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_RATE_CARRIERS = [
  {
    name: 'Optum',
    // Every per-site Optum row in the workbook is in network.
    network: 'INN',
    rows: {
      canaan: 'Optum Canaan',
      wilton: 'Optum Wilton',
      ramsey: 'Optum Ramsey',
      nyc: 'Optum NYC',
      chappaqua: 'Optum Chappaqua',
      huntington: 'Optum Huntington',
    },
  },
]

const BY_NAME = new Map(SITE_RATE_CARRIERS.map((c) => [c.name, c]))

// The site-rate carrier by name, or null for an ordinary carrier.
export function siteRateCarrier(name) {
  return BY_NAME.get(name) || null
}

// Rate-table row names that a site-rate carrier stands in for. Hidden from the
// dropdowns, still valid as lookups.
export const SITE_RATE_ROWS = new Set(SITE_RATE_CARRIERS.flatMap((c) => Object.values(c.rows)))

// The rate-table row to read for this carrier at this location. An ordinary
// carrier is its own row; a site-rate carrier is the row for the location, or
// null when no location is chosen or the location has no row.
export function rateRowFor(carrier, location) {
  const site = BY_NAME.get(carrier)
  if (!site) return carrier
  return site.rows[location] || null
}
