// ─────────────────────────────────────────────────────────────────────────────
// Self-pay cost & scholarship estimate
//
// Ports the workbook's `Self Pay Calc` sheet. There is no insurance here, so
// there is no cost-share waterfall — the arithmetic is one subtraction per line:
//
//   program cost (rate × units)  −  client payment  =  scholarship
//
// What the sheet is actually for is the shape of that gap. A director signing
// off on a scholarship wants it in the units they think in: a percentage of the
// program, a number of nights covered, and an average daily rate. Those are the
// three columns beside the dollar figure, and they are why this is a sheet
// rather than a subtraction anyone could do in their head.
// ─────────────────────────────────────────────────────────────────────────────

import { lookupRate, sequenceIncludes, toNumber, SEQ_LOC } from './estimate.js'

// The workbook prices self-pay off the "Self Pay" row of the same carrier
// table the insurance estimator reads.
export const SELF_PAY_CARRIER = 'Self Pay'

// The sheet's thirteen lines, with its default unit counts.
//
// Individual therapy starts at the OP course — 10 sessions, the same count the
// insurance estimator carries for an OP level of care. The workbook's own 18
// belonged to no single level of care, and it quoted an OP episode nearly two
// courses of therapy. Like every other count here it is editable, so a longer
// course is typed in rather than assumed.
//
// `fixedRate` is the one line that does not come from the rate table: the
// workbook hard-codes the OP specialty group at $100 against CPT 90853, which
// already carries a different self-pay rate as the routine group. Two prices
// for one code is exactly why it is written down rather than looked up.
export const SELF_PAY_LINES = [
  { key: 'detox', label: 'Detox', code: 'H0010', units: 6, unitNoun: 'nights', activatedBy: [SEQ_LOC.DETOX], group: 'inpatient' },
  { key: 'residential', label: 'Residential', code: 'H0018', units: 36, unitNoun: 'nights', activatedBy: [SEQ_LOC.RESIDENTIAL], group: 'inpatient' },
  { key: 'opwm', label: 'OPWM', code: 'H0014', units: 5, unitNoun: 'units', activatedBy: [SEQ_LOC.OPWM], group: 'outpatient' },
  { key: 'php', label: 'PHP', code: 'H0035', units: 20, unitNoun: 'units', activatedBy: [SEQ_LOC.PHP], group: 'outpatient' },
  { key: 'assessment', label: 'Initial Assessment', code: '90791', units: 1, unitNoun: 'visits', activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], group: 'outpatient' },
  { key: 'individual', label: 'Individual Therapy', code: '90837', units: 10, unitNoun: 'sessions', activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], group: 'outpatient' },
  { key: 'iop', label: 'IOP Services', code: 'H0015', units: 30, unitNoun: 'units', activatedBy: [SEQ_LOC.IOP], group: 'outpatient' },
  { key: 'opGroups', label: 'OP Groups', code: '90853', units: 10, unitNoun: 'groups', activatedBy: [SEQ_LOC.OP], group: 'outpatient' },
  { key: 'opSpecialtyGroup', label: 'OP Specialty Group', code: '90853', units: 0, unitNoun: 'groups', activatedBy: [SEQ_LOC.OP], group: 'outpatient', fixedRate: 100 },
  { key: 'psychEval', label: 'Psychiatric Evaluation', code: '90792', units: 1, unitNoun: 'visits', activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], group: 'outpatient' },
  { key: 'psychFollowUp', label: 'Psychiatric Follow Up', code: '99214', units: 4, unitNoun: 'visits', activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], group: 'outpatient' },
  { key: 'family', label: 'Family Therapy', code: '90847', units: 3, unitNoun: 'sessions', activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], group: 'outpatient' },
  { key: 'mats', label: 'MATs Injection', code: '96372', units: 0, unitNoun: 'injections', activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], group: 'outpatient' },
]

export const INITIAL_SELF_PAY_STATE = {
  treatmentSequence: '',
  units: Object.fromEntries(SELF_PAY_LINES.map((l) => [l.key, String(l.units)])),
  payments: Object.fromEntries(SELF_PAY_LINES.map((l) => [l.key, ''])),
  rateOverrides: {},
}

export function selfPayRate(line, overrides = {}) {
  const override = overrides[line.key]
  if (override !== undefined && override !== '') {
    const n = parseFloat(override)
    if (Number.isFinite(n)) return n
  }
  if (typeof line.fixedRate === 'number') return line.fixedRate
  return lookupRate(SELF_PAY_CARRIER, line.code)
}

export function computeSelfPay(form) {
  const sequence = form.treatmentSequence

  const lines = SELF_PAY_LINES.map((line) => {
    const active = line.activatedBy.some((loc) => sequenceIncludes(sequence, loc))
    const units = toNumber(form.units[line.key])
    const rate = selfPayRate(line, form.rateOverrides)
    const programCost = active && rate !== null ? units * rate : 0
    const payment = toNumber(form.payments[line.key])

    // The client's payment is applied to this line's cost first; the
    // scholarship is whatever the payment did not reach. A payment above the
    // program cost does not create a negative scholarship — it is simply a line
    // paid in full, which the overpaid flag names rather than hiding.
    const scholarship = Math.max(0, programCost - payment)

    return {
      ...line,
      active,
      units,
      rate,
      rateMissing: active && rate === null,
      programCost,
      payment,
      scholarship,
      scholarshipPercent: programCost === 0 ? 0 : scholarship / programCost,
      // The scholarship restated as nights or units of care covered — the unit
      // the person approving it actually thinks in.
      scholarshipUnits: rate ? scholarship / rate : 0,
      averageDailyRate: units > 0 ? payment / units : 0,
      clientResponsibility: payment,
      overpaid: programCost > 0 && payment > programCost,
    }
  })

  const sum = (fn) => lines.reduce((total, l) => total + fn(l), 0)
  const grossCost = sum((l) => l.programCost)
  const totalPayment = sum((l) => l.payment)
  const totalScholarship = sum((l) => l.scholarship)
  const totalUnits = sum((l) => (l.programCost > 0 ? l.units : 0))

  return {
    lines,
    active: lines.some((l) => l.active),
    grossCost,
    totalPayment,
    totalScholarship,
    scholarshipPercent: grossCost === 0 ? 0 : totalScholarship / grossCost,
    scholarshipUnits: sum((l) => l.scholarshipUnits),
    // The blended rate across every costed line — what one day of this
    // client's episode actually collects.
    blendedDailyRate: totalUnits > 0 ? totalPayment / totalUnits : 0,
    finalClientResponsibility: totalPayment,
    missingRates: lines
      .filter((l) => l.rateMissing)
      .map((l) => ({ key: l.key, label: l.label, code: l.code })),
    overpaidLines: lines.filter((l) => l.overpaid).map((l) => l.label),
  }
}

export function selfPayBlockers(form) {
  const blockers = []
  if (!form.treatmentSequence) blockers.push('Select a treatment sequence')
  return blockers
}
