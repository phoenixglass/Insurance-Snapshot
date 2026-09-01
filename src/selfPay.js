// ─────────────────────────────────────────────────────────────────────────────
// Self-pay cost & scholarship estimate
//
// Ports the workbook's `Self Pay Calc` sheet. There is no insurance here, so
// there is no cost-share waterfall — the arithmetic is one subtraction per line:
//
//   program cost (rate × units)  −  scholarship  =  what the client pays
//
// The thing that subtraction has to keep straight is what a scholarship is
// here. It is a dollar-amount award against the program, granted as a count of
// units the program is covering — not a discount on the rate. A 50% scholarship
// on 30 IOP sessions at $295 is 15 sessions billed at $295 and 15 sessions
// covered, $4,425 either way; it is never 30 sessions repriced to $147.50. The
// rate the client sees on the sessions they pay for is the rate on the sheet,
// and every figure this module reports is stated in those terms: units covered,
// units paid, and the dollars each side of the split comes to.
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
  // How the scholarship is entered. 'units' is the way a scholarship is
  // actually granted — a count of sessions or nights the program is covering —
  // and 'amount' is there for the case where a dollar figure was agreed first
  // and has to be entered as it was written.
  scholarshipMode: 'units',
  units: Object.fromEntries(SELF_PAY_LINES.map((l) => [l.key, String(l.units)])),
  // Per line: units covered in 'units' mode, dollars covered in 'amount' mode.
  scholarship: Object.fromEntries(SELF_PAY_LINES.map((l) => [l.key, ''])),
  rateOverrides: {},
}

export const SCHOLARSHIP_MODES = [
  { value: 'units', label: 'Sessions covered' },
  { value: 'amount', label: 'Dollar amount' },
]

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
  const byUnits = (form.scholarshipMode ?? 'units') === 'units'

  const lines = SELF_PAY_LINES.map((line) => {
    const active = line.activatedBy.some((loc) => sequenceIncludes(sequence, loc))
    const units = toNumber(form.units[line.key])
    const rate = selfPayRate(line, form.rateOverrides)
    const programCost = active && rate !== null ? units * rate : 0
    const entered = toNumber(form.scholarship?.[line.key])

    // The scholarship is a count of units the program is covering, priced at
    // the same rate the client pays for the units they cover. It never becomes
    // a discount on the rate: 15 of 30 IOP sessions covered is $4,425 of
    // scholarship against 15 sessions still billed at the full $295, not 30
    // sessions repriced to $147.50.
    const requested = byUnits ? entered * (rate ?? 0) : entered
    const scholarship = Math.min(Math.max(requested, 0), programCost)
    const coveredUnits = rate ? scholarship / rate : 0
    // Only a costed line has units on either side of the split: a level of
    // care outside the sequence is not care the client is paying for.
    const paidUnits = programCost > 0 ? Math.max(0, units - coveredUnits) : 0
    const payment = programCost - scholarship

    // A scholarship larger than the line is flagged rather than silently
    // clamped away, and never spills into another line.
    const overAllocated = programCost > 0 && requested > programCost

    return {
      ...line,
      active,
      units,
      rate,
      rateMissing: active && rate === null,
      programCost,
      scholarship,
      coveredUnits,
      paidUnits,
      payment,
      clientResponsibility: payment,
      scholarshipPercent: programCost === 0 ? 0 : scholarship / programCost,
      // Whether the covered units land on whole sessions or nights. A dollar
      // figure agreed at the table often does not, and the fraction is the
      // thing worth seeing before it is quoted.
      wholeUnits: Math.abs(coveredUnits - Math.round(coveredUnits)) < 1e-9,
      overAllocated,
    }
  })

  const sum = (fn) => lines.reduce((total, l) => total + fn(l), 0)
  const grossCost = sum((l) => l.programCost)
  const totalScholarship = sum((l) => l.scholarship)
  const totalPayment = sum((l) => l.payment)

  return {
    lines,
    active: lines.some((l) => l.active),
    grossCost,
    totalPayment,
    totalScholarship,
    scholarshipPercent: grossCost === 0 ? 0 : totalScholarship / grossCost,
    // Units of care on each side of the split — the sentence a director signs
    // off on is "we are covering N sessions", not "we are charging less".
    scholarshipUnits: sum((l) => l.coveredUnits),
    paidUnits: sum((l) => l.paidUnits),
    costedUnits: sum((l) => (l.programCost > 0 ? l.units : 0)),
    finalClientResponsibility: totalPayment,
    missingRates: lines
      .filter((l) => l.rateMissing)
      .map((l) => ({ key: l.key, label: l.label, code: l.code })),
    overAllocatedLines: lines.filter((l) => l.overAllocated).map((l) => l.label),
    partialUnitLines: lines
      .filter((l) => l.scholarship > 0 && !l.wholeUnits)
      .map((l) => l.label),
  }
}

// Turn "give them 50%" into per-line scholarship entries. A percentage is how
// the award is decided; the entries it produces are units of care, so in units
// mode no line is split down the middle of a session — the units are whole, and
// the leftover fraction of the award is spent where it lands closest to the
// percentage that was asked for. That keeps a 50% award on an episode worth
// about half the episode rather than drifting up every time a one-visit line
// rounds itself a free visit.
export function applyScholarshipPercent(form, percent) {
  const pct = toNumber(percent) / 100
  if (!Number.isFinite(pct) || pct <= 0) return form
  const byUnits = (form.scholarshipMode ?? 'units') === 'units'
  const capped = Math.min(pct, 1)

  const priced = SELF_PAY_LINES.map((line) => {
    const active = line.activatedBy.some((loc) => sequenceIncludes(form.treatmentSequence, loc))
    const units = toNumber(form.units[line.key])
    const rate = selfPayRate(line, form.rateOverrides)
    return { line, units, rate, costed: active && rate !== null && rate > 0 && units > 0 }
  })

  const scholarship = { ...form.scholarship }
  for (const { line, costed } of priced) {
    if (!costed) scholarship[line.key] = ''
  }

  if (!byUnits) {
    for (const { line, units, rate, costed } of priced) {
      if (costed) scholarship[line.key] = String(round2(units * rate * capped))
    }
    return { ...form, scholarship }
  }

  const costed = priced.filter((p) => p.costed)
  const target = costed.reduce((total, p) => total + p.units * p.rate * capped, 0)
  const whole = costed.map((p) => ({ ...p, covered: Math.floor(p.units * capped) }))
  let short = target - whole.reduce((total, p) => total + p.covered * p.rate, 0)

  // Spend what is left of the award a whole unit at a time, biggest fraction
  // first, and only where the extra unit lands nearer the target than leaving
  // it off would.
  const byFraction = [...whole].sort((a, b) => {
    const fa = a.units * capped - Math.floor(a.units * capped)
    const fb = b.units * capped - Math.floor(b.units * capped)
    return fb - fa || b.rate - a.rate
  })
  for (const p of byFraction) {
    if (p.covered >= p.units) continue
    if (short >= p.rate / 2) {
      p.covered += 1
      short -= p.rate
    }
  }

  for (const p of whole) scholarship[p.line.key] = String(p.covered)
  return { ...form, scholarship }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

export function selfPayBlockers(form) {
  const blockers = []
  if (!form.treatmentSequence) blockers.push('Select a treatment sequence')
  return blockers
}
