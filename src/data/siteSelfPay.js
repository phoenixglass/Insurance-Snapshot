// ─────────────────────────────────────────────────────────────────────────────
// Levels of care a payer's plan does not price at some sites.
//
// An in-network carrier is normally priced through the plan: the allowed
// amount runs through the deductible, coinsurance, copay and out-of-pocket
// maximum. A rule here takes one level of care out of that for a carrier at
// the sites it names. The client is charged a flat daily rate for it instead,
// as if self-pay, and the plan's terms are disregarded for that level
// entirely: it spends none of the deductible, charges no coinsurance or copay,
// and neither counts toward nor is capped by the out-of-pocket maximum. The
// rest of the episode is priced through the plan as usual, starting from
// accumulators this level left untouched.
//
// Like `siteNetworks.js`, this is laid over the generated tables at lookup time
// so a re-export of the workbook does not quietly undo it.
//
// Which site applies: the Location selected on the estimate, which is the site
// the client is admitting to. Until one is selected, a carrier named for a site
// is taken to be at that site, so `Optum Wilton` with no location reads as
// Wilton and `Optum Canaan` as Canaan.
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_SELF_PAY = [
  {
    // The per-site Optum rows. The other Optum-administered plans (UMR,
    // Emblem, UBH-HP, Surest, UHC Shared Services, GEHA-ASA) are not covered:
    // they are separate plans and nothing has been said about them.
    carriers: {
      'Optum Canaan': 'canaan',
      'Optum Wilton': 'wilton',
      'Optum Chappaqua': 'chappaqua',
      'Optum NYC': 'nyc',
      'Optum Huntington': 'huntington',
      'Optum Ramsey': 'ramsey',
    },
    level: 'PHP',
    code: 'H0035',
    ratePerDay: 442,
    exceptAt: ['canaan'],
    noted: '2026-11-20',
    reason:
      'Optum PHP outside Canaan is treated as self-pay at $442 a day. The deductible, out-of-pocket maximum and coinsurance are disregarded for it.',
  },
]

// The rule taking `level` out of the plan for this estimate, or null when the
// level is priced through the plan as usual.
export function siteSelfPayRule({ carrier, location }, level) {
  for (const rule of SITE_SELF_PAY) {
    if (rule.level !== level) continue
    const homeSite = rule.carriers[carrier]
    if (homeSite === undefined) continue
    const site = location || homeSite
    if (rule.exceptAt.includes(site)) continue
    return rule
  }
  return null
}
