// ─────────────────────────────────────────────────────────────────────────────
// Observed average reimbursement, by payer group.
//
// This is the weakest of the rate sources and the last one consulted. A
// contracted schedule is a signed number and the carrier table is a plan's
// stated allowed amount; this is neither — it is what a payer group actually
// paid, averaged over past claims. Compared against the carrier table where
// both exist, it tracks closely in the middle (median ratio 0.96) but ranges
// from roughly half to two-thirds above, so it is an estimate, not a quote.
//
// It earns its place because the alternative is worse: without it, 174 of the
// 176 priced-code gaps in the carrier table cost $0 in an estimate, which
// understates a deposit by a number nobody can see. Every rate drawn from here
// is tagged on screen so it can never be mistaken for a contracted one.
//
// Generated from the Deposit Calculator workbook's `Reimbursement Data` sheet.
// ─────────────────────────────────────────────────────────────────────────────

// payer group → { code: average reimbursement per unit }
export const PAYER_REIMBURSEMENT = {
  "Aetna -": { "80305": 38.59, "90785": 16.8, "90791": 288.73, "90792": 270.81, "90832": 162.17, "90834": 227.13, "90837": 273.43, "90839": 284.05, "90840": 479.58, "90846": 118.14, "90847": 193.82, "90853": 114.63, "93000": 32.13, "96372": 12.53, "97026": 28.73, "97802": 110.49, "97804": 36.13, "97810": 34.74, "97811": 21.47, "99203": 75.0, "99211": 16.87, "99212": 73.81, "99213": 121.69, "99214": 265.8, "99215": 370.29, "99408": 51.7, "99409": 200.0, "H0010": 2098.82, "H0014": 439.52, "H0015": 540.67, "H0018": 2078.45, "H0035": 1286.12, "NOSHOWFEE": 25.0 },
  "Anthem": { "80305": 13.01, "87637": 30.91, "90785": 10.84, "90791": 214.51, "90792": 250.22, "90832": 99.21, "90834": 130.66, "90837": 206.67, "90839": 112.4, "90846": 146.97, "90847": 160.48, "90853": 43.61, "93000": 60.17, "96372": 37.66, "97802": 63.4, "97804": 9.93, "97810": 38.06, "97811": 30.24, "98966": 3.73, "99211": 13.73, "99212": 58.23, "99213": 122.85, "99214": 188.16, "99215": 294.56, "99408": 18.67, "H0006": 22.63, "H0010": 1404.41, "H0015": 267.9, "H0018": 1346.47, "H0035": 823.43, "OvPmt": 300.0 },
  "BCBS": { "80305": 40.06, "87637": 450.0, "90785": 30.68, "90791": 302.99, "90792": 473.89, "90832": 152.28, "90834": 181.95, "90837": 264.34, "90839": 549.27, "90846": 338.66, "90847": 281.46, "90853": 68.25, "93000": 147.88, "96372": 24.07, "97802": 269.5, "97804": 8.0, "97810": 60.05, "97811": 52.55, "98966": 29.17, "98967": 81.25, "99211": 475.0, "99212": 129.16, "99213": 202.37, "99214": 252.81, "99215": 329.22, "99368": 750.0, "99408": 71.66, "99409": 145.22, "H0006": 91.77, "H0010": 1960.95, "H0015": 356.61, "H0018": 2030.66, "H0035": 714.87 },
  "Beacon": { "90785": 38.61, "90791": 374.73, "90792": 352.64, "90832": 225.85, "90834": 302.89, "90837": 417.62, "90839": 456.47, "90846": 223.0, "90847": 293.74, "90853": 88.87, "97810": 6.98, "97811": 5.14, "98966": 15.75, "98967": 22.98, "98968": 33.06, "99212": 126.42, "99213": 80.64, "99214": 362.45, "99215": 498.73, "H0010": 5183.06, "H0014": 4296.41, "H0015": 1480.87, "H0018": 4888.08, "H0035": 3150.0 },
  "Cigna": { "80305": 33.48, "87637": 170.05, "90785": 87.5, "90791": 360.44, "90792": 476.41, "90832": 184.27, "90834": 237.46, "90837": 328.13, "90839": 342.57, "90840": 127.5, "90846": 272.2, "90847": 307.33, "90853": 79.77, "93000": 51.7, "96372": 181.1, "97026": 49.24, "97802": 121.96, "97804": 20.3, "97810": 17.42, "97811": 12.26, "98966": 14.06, "98967": 31.25, "98968": 68.06, "99211": 28.57, "99212": 70.16, "99213": 107.62, "99214": 356.84, "99215": 450.07, "99408": 64.89, "99409": 100.0, "H0006": 2.88, "H0010": 1668.9, "H0015": 541.42, "H0018": 1636.42, "H0035": 591.43, "NOSHOWFEE": 25.0 },
  "Connecticare -": { "90791": 51.96, "90792": 115.18, "90832": 24.59, "90834": 54.8, "90837": 65.68, "90846": 15.44, "90847": 44.42, "90853": 36.17, "96372": 20.5, "98967": 17.51, "98968": 19.73, "99211": 25.36, "99212": 42.33, "99213": 35.94, "99214": 110.43, "99215": 170.48, "99408": 12.05, "H0010": 1128.25, "H0015": 301.14, "H0018": 967.68, "H0035": 409.15 },
  "Harvard Pilgrim": { "90791": 29.55, "90832": 19.13, "90837": 86.52, "97810": 10.94, "97811": 6.42, "99213": 21.63, "H0010": 1152.0, "H0015": 300.39, "H0018": 937.27, "H0035": 1575.0 },
  "Lower Hudson Valley EAP  -": { "80305": 50.0, "90837": 172.5, "90853": 105.0, "93000": 2.5, "H0010": 1327.33, "H0018": 1430.0 },
  "Magellan": { "90791": 91.96, "90792": 130.27, "90832": 40.33, "90834": 101.12, "90837": 105.49, "90846": 77.01, "90847": 98.38, "90853": 65.66, "99214": 52.76, "H0010": 1329.06, "H0015": 289.83, "H0018": 1285.31 },
  "Misc": { "80305": 10.19, "87637": 119.61, "90791": 124.78, "90792": 170.1, "90832": 60.07, "90834": 112.6, "90837": 149.7, "90846": 63.16, "90847": 81.62, "90853": 44.81, "93000": 5.98, "96372": 40.0, "97802": 98.01, "97804": 23.37, "97810": 7.99, "97811": 7.71, "99211": 10.68, "99212": 27.14, "99213": 44.04, "99214": 212.67, "99215": 293.22, "99408": 15.88, "H0006": 19.17, "H0010": 1360.76, "H0014": 825.43, "H0015": 376.12, "H0018": 1182.97, "H0035": 513.37, "NOSHOWFEE": 100.0 },
  "Oxford": { "90791": 38.9, "90792": 111.31, "90832": 30.88, "90834": 42.38, "90837": 50.52, "90846": 11.11, "90847": 37.26, "90853": 39.25, "96372": 18.79, "97802": 25.0, "97804": 31.25, "98967": 3.73, "99203": 126.82, "99212": 15.78, "99213": 6.72, "99214": 111.54, "99215": 132.6, "99408": 3.57, "H0010": 1165.19, "H0014": 482.14, "H0015": 297.98, "H0018": 987.92, "H0035": 426.21, "NOSHOWFEE": 48.63 },
  "UBH": { "90785": 9.59, "90791": 50.56, "90792": 122.81, "90832": 32.95, "90834": 52.84, "90837": 80.09, "90846": 15.71, "90847": 51.72, "90853": 44.85, "96372": 18.86, "98966": 2.24, "99212": 23.35, "99213": 20.81, "99214": 137.4, "99215": 171.7, "99408": 9.43, "H0010": 1148.37, "H0015": 307.02, "H0018": 1029.34, "H0035": 419.83, "NOSHOWFEE": 12.5 },
  "UMR": { "80305": 1.24, "90791": 84.32, "90792": 145.76, "90832": 14.35, "90837": 64.08, "90846": 8.38, "90847": 49.75, "90853": 43.19, "93000": 34.86, "96372": 20.5, "97802": 240.68, "99211": 35.23, "99212": 51.56, "99214": 118.78, "H0010": 1134.7, "H0015": 311.9, "H0018": 907.14 },
}

// payer group → { code: average charge amount } — the billed side of the same
// claims, shown in the rate lookup for context.
export const PAYER_CHARGES = {
  "Aetna -": { "80305": 260.0, "90785": 175.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90839": 850.0, "90840": 850.0, "90846": 600.0, "90847": 750.0, "90853": 522.64, "93000": 195.0, "96372": 695.0, "97026": 175.0, "97802": 600.0, "97804": 500.0, "97810": 175.0, "97811": 175.0, "99203": 750.0, "99211": 475.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 782.14, "99408": 150.0, "99409": 200.0, "H0010": 5450.0, "H0014": 4500.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0, "NOSHOWFEE": 25.0 },
  "Anthem": { "80305": 260.0, "87637": 450.0, "90785": 175.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90839": 850.0, "90846": 600.0, "90847": 750.0, "90853": 524.75, "93000": 195.0, "96372": 695.0, "97802": 600.0, "97804": 500.0, "97810": 175.0, "97811": 175.0, "98966": 75.0, "99211": 475.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 800.0, "99408": 151.92, "H0006": 230.0, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0, "OvPmt": 300.0 },
  "BCBS": { "80305": 260.0, "87637": 450.0, "90785": 175.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90839": 850.0, "90846": 600.0, "90847": 750.0, "90853": 525.0, "93000": 195.0, "96372": 695.0, "97802": 600.0, "97804": 500.0, "97810": 175.0, "97811": 175.0, "98966": 75.0, "98967": 125.0, "99211": 475.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 862.5, "99368": 750.0, "99408": 157.53, "99409": 200.0, "H0006": 240.0, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0 },
  "Beacon": { "90785": 175.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90839": 850.0, "90846": 600.0, "90847": 750.0, "90853": 524.23, "97810": 175.0, "97811": 175.0, "98966": 75.0, "98967": 125.0, "98968": 175.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 1050.0, "H0010": 5450.0, "H0014": 4500.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0 },
  "Cigna": { "80305": 260.0, "87637": 450.0, "90785": 175.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90839": 850.0, "90840": 425.0, "90846": 600.0, "90847": 750.0, "90853": 524.82, "93000": 195.0, "96372": 695.0, "97026": 175.0, "97802": 566.67, "97804": 500.0, "97810": 175.0, "97811": 175.0, "98966": 75.0, "98967": 125.0, "98968": 175.0, "99211": 475.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 883.33, "99408": 152.97, "99409": 200.0, "H0006": 235.0, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0, "NOSHOWFEE": 25.0 },
  "Connecticare -": { "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 518.57, "90837": 750.0, "90846": 600.0, "90847": 750.0, "90853": 525.0, "96372": 695.0, "98967": 125.0, "98968": 175.0, "99211": 475.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 675.0, "99408": 169.01, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0 },
  "Harvard Pilgrim": { "90791": 875.0, "90832": 375.0, "90837": 750.0, "97810": 175.0, "97811": 175.0, "99213": 545.0, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0 },
  "Lower Hudson Valley EAP  -": { "80305": 260.0, "90837": 750.0, "90853": 525.0, "93000": 195.0, "H0010": 5450.0, "H0018": 4950.0 },
  "Magellan": { "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90846": 600.0, "90847": 750.0, "90853": 525.0, "99214": 750.0, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0 },
  "Misc": { "80305": 265.2, "87637": 450.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90846": 600.0, "90847": 744.83, "90853": 524.49, "93000": 195.0, "96372": 695.0, "97802": 600.0, "97804": 500.0, "97810": 175.0, "97811": 175.0, "99211": 475.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 825.0, "99408": 163.24, "H0006": 230.0, "H0010": 5450.0, "H0014": 4500.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0, "NOSHOWFEE": 100.0 },
  "Oxford": { "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90846": 622.22, "90847": 750.0, "90853": 524.52, "96372": 695.0, "97802": 600.0, "97804": 500.0, "98967": 125.0, "99203": 750.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 925.0, "99408": 163.89, "H0010": 5450.0, "H0014": 4500.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0, "NOSHOWFEE": 55.0 },
  "UBH": { "90785": 175.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90834": 545.0, "90837": 750.0, "90846": 613.04, "90847": 756.41, "90853": 524.65, "96372": 695.0, "98966": 75.0, "99212": 500.0, "99213": 545.0, "99214": 750.0, "99215": 800.0, "99408": 161.81, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0, "H0035": 3150.0, "NOSHOWFEE": 25.0 },
  "UMR": { "80305": 260.0, "90791": 875.0, "90792": 1050.0, "90832": 375.0, "90837": 750.0, "90846": 600.0, "90847": 750.0, "90853": 525.0, "93000": 195.0, "96372": 695.0, "97802": 600.0, "99211": 475.0, "99212": 500.0, "99214": 750.0, "H0010": 5450.0, "H0015": 1550.0, "H0018": 4950.0 },
}

// `Misc` is the bucket a carrier that is not listed in the app reports under.
// It is therefore never a fallback for a carrier that IS listed: a named plan
// with no rate of its own gets no rate, not somebody else's average. The only
// thing that reaches Misc is the explicit "not listed" carrier below.
export const MISC_GROUP = 'Misc'

// The carrier option for a plan the app does not carry. Its rates come from the
// Misc claims bucket, which is exactly what that bucket is.
export const OTHER_CARRIER = 'Other — not listed'

// Payers the claims data prices but the workbook's rate table never carried.
// Selectable so their claims history is reachable; nothing states their network
// status, so the estimator asks for it rather than assuming. Empty for now —
// Harvard Pilgrim is in the claims data but its averages look unreliable, so it
// stays out until someone confirms them.
export const SUPPLEMENTAL_CARRIERS = []

// Optum administers Oxford, UHC, UBH and Connecticare on one set of contracted
// rates, and the 2026 revision of the workbook consolidated all four onto the
// carriers named for it. The claims export still reports them under their four
// old names, so a carrier the sheet now calls Optum is asking about claims
// filed as Oxford, UBH, Connecticare and UMR.
//
// Picking one of the four to stand for the rest would be arbitrary, so the
// group is the average of the ones carrying the code. That is stable rather
// than a compromise between sources that disagree: on every facility code —
// the ones that actually move a deposit — the four sit within 13% of each
// other, and within 5% on the detox, IOP and PHP per diems.
const OPTUM_SOURCE_GROUPS = ['Oxford', 'UBH', 'Connecticare -', 'UMR']
export const OPTUM_GROUP = 'Optum'

// Carriers Optum administers that are not themselves one of the reported
// names. Checked last, so a carrier that maps to a bucket of its own — UBH-HP
// to UBH, UMR (Optum) to UMR — keeps that narrower reading; this only reaches
// the ones that had no payer group at all.
const OPTUM_ADMINISTERED = /\(Optum\)|^Optum |^UHC\b/i

const blend = (table) => {
  const byCode = {}
  for (const group of OPTUM_SOURCE_GROUPS) {
    for (const [code, value] of Object.entries(table[group] || {})) {
      byCode[code] = byCode[code] || []
      byCode[code].push(value)
    }
  }
  return Object.fromEntries(
    Object.entries(byCode).map(([code, values]) => [
      code,
      Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
    ])
  )
}

// The generated tables plus the derived Optum one, which is the only entry not
// read straight from the claims export.
const GROUP_REIMBURSEMENT = { ...PAYER_REIMBURSEMENT, [OPTUM_GROUP]: blend(PAYER_REIMBURSEMENT) }
const GROUP_CHARGES = { ...PAYER_CHARGES, [OPTUM_GROUP]: blend(PAYER_CHARGES) }

const EXACT_GROUPS = new Set(Object.keys(PAYER_REIMBURSEMENT))

// Which group a carrier's claims were reported under. Most groups are a carrier
// name verbatim; the rest are families. A carrier matching none of them returns
// null rather than falling through to Misc.
export function payerGroupFor(carrier) {
  if (!carrier) return null
  if (carrier === OTHER_CARRIER) return { group: MISC_GROUP, exact: true }
  if (carrier === MISC_GROUP) return null
  if (EXACT_GROUPS.has(carrier)) return { group: carrier, exact: true }
  // The BCBS plans split two ways in the claims data: the Anthem-administered
  // ones report under Anthem, the rest under BCBS.
  if (carrier.startsWith('BCBS - Anthem')) return { group: 'Anthem', exact: false }
  if (carrier.startsWith('BCBS')) return { group: 'BCBS', exact: false }
  for (const prefix of ['Cigna', 'UMR', 'UBH', 'Connecticare', 'Oxford', 'Magellan']) {
    if (carrier.startsWith(prefix)) {
      const group = prefix === 'Connecticare' ? 'Connecticare -' : prefix
      if (EXACT_GROUPS.has(group)) return { group, exact: false }
    }
  }
  if (OPTUM_ADMINISTERED.test(carrier)) return { group: OPTUM_GROUP, exact: false }
  return null
}

// The Misc average for a code, offered as a one-click fill beside a rate the
// app cannot supply — chosen deliberately rather than applied behind the back.
export function miscRate(code) {
  const rate = PAYER_REIMBURSEMENT[MISC_GROUP]?.[String(code)]
  return typeof rate === 'number' ? rate : null
}

// The average this carrier's payer group was reimbursed for a code, or null.
export function reimbursementRate(carrier, code) {
  const match = payerGroupFor(carrier)
  if (!match) return null
  const rate = GROUP_REIMBURSEMENT[match.group]?.[String(code)]
  return typeof rate === 'number' ? rate : null
}

export function reimbursementDetail(carrier, code) {
  const match = payerGroupFor(carrier)
  if (!match) return null
  const rate = GROUP_REIMBURSEMENT[match.group]?.[String(code)]
  if (typeof rate !== 'number') return null
  return {
    group: match.group,
    exact: match.exact,
    rate,
    charge: GROUP_CHARGES[match.group]?.[String(code)] ?? null,
    // Where the number is a blend of the names one payer reports under, the
    // names are carried with it — a reader checking a rate against a claims
    // report needs to know which reports it came from.
    blendedFrom: match.group === OPTUM_GROUP ? OPTUM_SOURCE_GROUPS : null,
  }
}
