// ─────────────────────────────────────────────────────────────────────────────
// Carriers whose network status depends on the site the client admits to.
//
// The workbook gives every carrier one network, and `rates.js` (generated from
// it) does the same. Some agreements are site-specific: we are in network with
// the payer at some locations and out of network at the rest. Those carriers are
// listed here and laid over the generated table at lookup time, the same way
// `rateCorrections.js` is, so a re-export of the workbook does not quietly undo
// them. The carrier keeps its workbook network (OON) as the base; this file
// only says where that changes.
//
// `inNetworkAt` lists location ids from `contractRates.js`. At any other
// location the carrier is out of network. With no location selected its
// network is not established, and the estimator asks for the site rather than
// guessing, because INN and OON change the rates, the bundling and what the
// client is told.
//
// `siteSchedule` says whether our contracted rate schedule for the site prices
// this payer. The schedules are location contracts, not this payer's, so an
// agreement priced on its own terms sets this to false. The carrier then
// prices from its own row in the rate table while still being in network for
// everything else (bundling, cost-share, the client letter).
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_NETWORKS = [
  {
    // Every Anthem-administered BCBS plan in the list. The BCBS - Mass rows are
    // a different Blue plan and stay out of network everywhere; so do Empire,
    // Horizon, Other and WellPoint.
    carriers: ['BCBS - Anthem CT', 'BCBS - Anthem NJ', 'BCBS - Anthem NY'],
    inNetworkAt: ['canaan', 'wilton'],
    siteSchedule: false,
    noted: '2026-11-20',
    reason:
      'Anthem BCBS is in network at Canaan and Wilton only. Its rates stay its own; the Connecticut schedule does not apply to it.',
  },
]

const RULE_BY_CARRIER = new Map(
  SITE_NETWORKS.flatMap((rule) => rule.carriers.map((name) => [name, rule]))
)

// The site rule for a carrier, or null when its network is the same everywhere.
export function siteNetworkRule(carrier) {
  return RULE_BY_CARRIER.get(carrier) || null
}
