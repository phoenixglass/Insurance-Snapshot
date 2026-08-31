// ─────────────────────────────────────────────────────────────────────────────
// Deposit estimator
//
// Ports the workbook's `Insurance Calculator_v2` sheet. The workbook runs two
// separate cost-share waterfalls — an inpatient one (detox and residential,
// billed per night) and an outpatient one (OPWM, PHP, IOP, OP and the
// professional services delivered alongside them) — and the inpatient one runs
// first, because it consumes the deductible and out-of-pocket room the
// outpatient one then works against.
//
// Both waterfalls have the same shape:
//
//   allowed cost → deductible → coinsurance → copay → OOP cap → deposit
//
// Every step below names the workbook cell it came from, so a formula change in
// the workbook can be traced to the line here that has to move with it.
// ─────────────────────────────────────────────────────────────────────────────

import { BENCHMARK_RATES, CARRIERS, CODES, RATES } from './data/rates.js'
import { UNCONTRACTED_CODES, getSchedule, scheduleRate } from './data/contractRates.js'

// ── Copay handling ───────────────────────────────────────────────────────────
// The workbook asks three separate questions about a copay, and each one moves
// money on its own: how it is counted (basis), whether it displaces coinsurance
// (treatment), and which accumulators it feeds.

export const COPAY_BASIS = {
  NA: 'Not Applicable',
  PER_UNIT: 'Per Service Unit',
  PROFESSIONAL_ONLY: 'Professional Visit Only',
  MANUAL: 'Manual Total',
}

export const COPAY_TREATMENT = {
  NA: 'Not Applicable',
  ADD: 'Add to Coinsurance',
  REPLACE: 'Replace Coinsurance',
}

export const YES_NO_NA = ['Not Applicable', 'Yes', 'No']

// ── Levels of care as the sequence names them ────────────────────────────────
// The workbook's treatment sequences are written as " > "-joined level names,
// and every activation test is a substring search against that string. The
// names here are the sequence's spelling, which is not the snapshot form's
// spelling ("Residential", not "Resi").

export const SEQ_LOC = {
  DETOX: 'Detox',
  RESIDENTIAL: 'Residential',
  OPWM: 'OPWM',
  PHP: 'PHP',
  IOP: 'IOP',
  OP: 'OP',
}

const OUTPATIENT_LOCS = [SEQ_LOC.OPWM, SEQ_LOC.PHP, SEQ_LOC.IOP, SEQ_LOC.OP]

// `=ISNUMBER(SEARCH(" > Detox > "," > "&$C$22&" > "))` — a level of care is part
// of the estimate only when the selected sequence names it.
export function sequenceIncludes(sequence, loc) {
  if (!sequence || !loc) return false
  return ` > ${sequence} > `.includes(` > ${loc} > `)
}

export function sequenceLocs(sequence) {
  if (!sequence) return []
  return sequence.split('>').map((s) => s.trim()).filter(Boolean)
}

// ── Rate lookup ──────────────────────────────────────────────────────────────

const CARRIER_BY_NAME = new Map(CARRIERS.map((c) => [c.name, c]))
const CODE_BY_ID = new Map(CODES.map((c) => [c.code, c]))

export function carrierNetwork(carrier) {
  const found = CARRIER_BY_NAME.get(carrier)
  return found ? found.network : ''
}

export function codeDescription(code) {
  const found = CODE_BY_ID.get(String(code))
  return found ? found.description : ''
}

// The workbook's `INDEX(...MATCH(carrier)...MATCH(code)...)`. A blank cell there
// is an amber "estimate from a similar plan", not a zero, so this returns null
// and every caller has to decide what to say about a rate that does not exist.
export function lookupRate(carrier, code) {
  const row = RATES[carrier]
  if (!row) return null
  const rate = row[String(code)]
  return typeof rate === 'number' ? rate : null
}

// The cross-carrier average for the same code — shown beside a missing rate as
// a starting point for the estimate, never folded into a quote on its own.
export function benchmarkRate(code) {
  const rate = BENCHMARK_RATES[String(code)]
  return typeof rate === 'number' ? rate : null
}

// ── Service lines ────────────────────────────────────────────────────────────
// The outpatient block's ten rows.
//
// `activatedBy` lists the levels of care that put the line in the estimate.
// The workbook gates the shared professional services (assessment, individual
// therapy, psych, family, MATs) on IOP alone in a few cells and on IOP-or-OP in
// others; its own notes in E42/E43 and the whole Self Pay sheet treat them as
// IOP-or-OP, so that is what this implements — otherwise an OP-only sequence
// silently prices a client's assessment and psychiatry at nothing.
//
// `defaultUnits` is keyed by level of care, because a typical episode is not
// one schedule — an IOP course and an OP course carry different numbers of the
// same service. A sequence covering both gets the sum, which is what stepping
// down from IOP into OP actually looks like. Every count is editable; these are
// only the starting point.
//
// `professional` marks the lines the "Professional Visit Only" copay basis
// counts: the individually billed visits, not the program day.
//
// `bundledOutInnIop` marks what an INN bundled IOP agreement folds into the
// program rate. A bundled agreement charges for IOP and not for individual or
// family therapy, so those two are the lines it zeroes.

export const SERVICE_LINES = [
  { key: 'opwm', label: 'OPWM', code: 'H0014', defaultUnits: { OPWM: 5 }, activatedBy: [SEQ_LOC.OPWM], professional: false, bundledOutInnIop: false },
  { key: 'php', label: 'PHP', code: 'H0035', defaultUnits: { PHP: 20 }, activatedBy: [SEQ_LOC.PHP], professional: false, bundledOutInnIop: false },
  { key: 'assessment', label: 'Initial Assessment', code: '90791', defaultUnits: { IOP: 1, OP: 0 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: false },
  { key: 'iop', label: 'IOP Services', code: 'H0015', defaultUnits: { IOP: 30 }, activatedBy: [SEQ_LOC.IOP], professional: false, bundledOutInnIop: false },
  { key: 'opGroups', label: 'OP Groups', code: '90853', defaultUnits: { OP: 10 }, activatedBy: [SEQ_LOC.OP], professional: false, bundledOutInnIop: false },
  { key: 'individual', label: 'Individual Therapy', code: '90837', defaultUnits: { IOP: 9, OP: 10 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: true },
  { key: 'psychEval', label: 'Psychiatric Evaluation', code: '90792', defaultUnits: { IOP: 1, OP: 0 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: false },
  { key: 'psychFollowUp', label: 'Psychiatric Follow Up', code: '99214', defaultUnits: { IOP: 2, OP: 0 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: false },
  { key: 'family', label: 'Family Therapy', code: '90847', defaultUnits: { IOP: 0, OP: 0 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: true },
  { key: 'mats', label: 'MATs Injection', code: '96372', defaultUnits: { IOP: 0, OP: 0 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: false },
]

// The starting unit count for a line under a given sequence: the sum of the
// per-level defaults for every level the sequence actually names.
export function defaultUnitsFor(line, sequence) {
  return line.activatedBy.reduce(
    (total, loc) => total + (sequenceIncludes(sequence, loc) ? (line.defaultUnits[loc] || 0) : 0),
    0
  )
}

// What a line will be costed at: the user's entry when they made one, the
// sequence default otherwise.
export function unitsFor(line, form) {
  const entered = form.units?.[line.key]
  if (entered !== undefined && entered !== '') return toNumber(entered)
  return defaultUnitsFor(line, form.treatmentSequence)
}

export const INPATIENT_LINES = [
  { key: 'detox', label: 'Detox', code: 'H0010', nights: 6, loc: SEQ_LOC.DETOX },
  { key: 'residential', label: 'Residential', code: 'H0018', nights: 14, loc: SEQ_LOC.RESIDENTIAL },
]

export const ADMISSION_FEE_LOCS = [
  { key: 'detox', label: 'Detox', loc: SEQ_LOC.DETOX },
  { key: 'residential', label: 'Residential', loc: SEQ_LOC.RESIDENTIAL },
  { key: 'opwm', label: 'OPWM', loc: SEQ_LOC.OPWM },
  { key: 'php', label: 'PHP', loc: SEQ_LOC.PHP },
  { key: 'iop', label: 'IOP', loc: SEQ_LOC.IOP },
  { key: 'op', label: 'OP', loc: SEQ_LOC.OP },
]

// ── Numeric helpers ──────────────────────────────────────────────────────────

export function toNumber(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

const clampAtZero = (n) => (n > 0 ? n : 0)

export function formatMoney(value, { decimals = 2 } = {}) {
  const n = toNumber(value)
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

export function formatPercent(fraction, decimals = 1) {
  return `${(toNumber(fraction) * 100).toFixed(decimals)}%`
}

// ── Default form state ───────────────────────────────────────────────────────

export const INITIAL_ESTIMATE_STATE = {
  carrier: '',
  bundledInnIop: 'No',
  deductibleRemaining: '',
  oopmRemaining: '',
  deductibleInOopm: 'Yes',
  coinsurancePercent: '',
  copayAmount: '',
  copayBasis: COPAY_BASIS.NA,
  copayTreatment: COPAY_TREATMENT.NA,
  copayAppliesToDeductible: 'Not Applicable',
  copayAppliesToOop: 'Not Applicable',
  admissionFees: { detox: '', residential: '', opwm: '', php: '', iop: '', op: '' },
  admissionFeeInOopm: 'No',
  treatmentSequence: '',
  previousBalance: '',
  nights: { detox: String(INPATIENT_LINES[0].nights), residential: String(INPATIENT_LINES[1].nights) },
  // Only what the user typed. A blank falls back to the sequence's own default,
  // so changing the pathway re-bases every count that was never overridden.
  contractSchedule: '',
  units: {},
  // Rates are looked up from the carrier table, but a verification call can
  // establish a number the table does not have. An override here is the user's
  // rate; a blank falls back to the table.
  rateOverrides: {},
}

// ── Rate resolution ──────────────────────────────────────────────────────────
// Three sources, in descending authority:
//
//   1. an override the user typed — they are looking at the contract
//   2. the selected in-network contract schedule — a signed rate for this site
//   3. the carrier table — what this payer has been observed to allow
//
// A code none of them covers stays null rather than becoming zero, and the
// caller has to say so.

export function resolveRate(form, code) {
  const override = form.rateOverrides?.[code]
  if (override !== undefined && override !== '') {
    const n = parseFloat(override)
    if (Number.isFinite(n)) return { rate: n, source: 'override' }
  }
  const contracted = scheduleRate(form.contractSchedule, code)
  if (contracted !== null) return { rate: contracted, source: 'contract' }

  const carrier = lookupRate(form.carrier, code)
  if (carrier !== null) return { rate: carrier, source: 'carrier' }

  // A code the schedule lists with no contracted rate is uncontracted at this
  // location, which is a different problem from one nobody has priced.
  return {
    rate: null,
    source: getSchedule(form.contractSchedule) && UNCONTRACTED_CODES.includes(String(code))
      ? 'uncontracted'
      : 'missing',
  }
}

// ── The cost-share waterfall ─────────────────────────────────────────────────
// Cells H13/H14 and J38/J39 are the same expression written twice against
// different inputs, so it lives here once.
//
//   deductible   — reduced by the copay when the copay is credited to it
//   coinsurance  — dropped entirely when the copay replaces it
//   copay        — always collected; only its accumulator treatment varies
//
// The OOP maximum caps only the portion of that total the plan actually counts
// toward it. Anything the plan does not count keeps being collected after the
// maximum is reached, which is why those pieces sit outside the MIN().

function applyCostShare({
  deductibleApplied,
  coinsurance,
  copay,
  oopRemaining,
  deductibleInOopm,
  copayReplacesCoinsurance,
  copayToDeductible,
  copayToOop,
  extraInsideCap = 0,
}) {
  // A copay credited to the deductible is not collected a second time as
  // deductible, so it comes off the deductible amount.
  const deductibleCredit = copayToDeductible ? Math.min(copay, deductibleApplied) : 0
  const netDeductible = clampAtZero(deductibleApplied - deductibleCredit)
  const coinsuranceDue = copayReplacesCoinsurance ? 0 : coinsurance

  const beforeCap = netDeductible + coinsuranceDue + copay

  // "Applies to OOP" is three states, not two, and the third one is not a
  // synonym for "No": a copay whose accumulator treatment was never
  // established goes into neither side of the cap, so it drops out of the
  // deposit entirely. That is the workbook's behavior, and it is why a copay
  // with an unanswered OOP question is a submit blocker rather than a default.
  const copayInsideCap = copayToOop === 'Yes' ? copay : 0
  const copayOutsideCap = copayToOop === 'No' ? copay : 0

  const insideCap =
    (deductibleInOopm ? netDeductible : 0) + coinsuranceDue + copayInsideCap + extraInsideCap
  const outsideCap = (deductibleInOopm ? 0 : netDeductible) + copayOutsideCap

  return {
    netDeductible,
    coinsuranceDue,
    copay,
    beforeCap,
    // What the plan counts toward the maximum, after the maximum caps it.
    cappedInsideCap: Math.min(oopRemaining, insideCap),
    outsideCap,
    afterCap: outsideCap + Math.min(oopRemaining, insideCap),
    // How much of the maximum this waterfall consumed, for the next one.
    oopConsumed: Math.min(oopRemaining, insideCap),
  }
}

// ── Inpatient waterfall (rows 5–16) ──────────────────────────────────────────

function computeInpatient(form, ctx) {
  const { sequence, coins, copayAmount, basis, deductibleRemaining, oopmRemaining } = ctx

  const lines = INPATIENT_LINES.map((line) => {
    const active = sequenceIncludes(sequence, line.loc)
    const nights = toNumber(form.nights[line.key])
    const rate = ctx.rateFor(line.code)
    const allowed = active && rate !== null ? nights * rate : 0
    return { ...line, active, nights, rate, allowed, rateMissing: active && rate === null }
  })

  const totalAllowed = lines.reduce((sum, l) => sum + l.allowed, 0)

  // F10 / G10 — the deductible is consumed in sequence order: detox takes what
  // it can, residential takes what detox left.
  let deductiblePool = deductibleRemaining
  lines.forEach((line) => {
    const applied = line.active ? Math.min(deductiblePool, line.allowed) : 0
    line.deductibleApplied = applied
    deductiblePool = clampAtZero(deductiblePool - applied)
  })
  const deductibleApplied = lines.reduce((sum, l) => sum + l.deductibleApplied, 0)

  // F11 / G11 — coinsurance is charged on what the deductible did not absorb.
  lines.forEach((line) => {
    line.coinsurance = clampAtZero(line.allowed - line.deductibleApplied) * coins
  })
  const coinsurance = lines.reduce((sum, l) => sum + l.coinsurance, 0)

  // F12 / G12 — a manual-total copay is one charge across the whole inpatient
  // stay, so residential only carries it when detox is not in the sequence.
  let copay = 0
  if (basis === COPAY_BASIS.MANUAL) {
    copay = lines.some((l) => l.active) ? copayAmount : 0
  } else if (basis === COPAY_BASIS.PER_UNIT) {
    copay = lines.reduce((sum, l) => sum + (l.active ? l.nights * copayAmount : 0), 0)
  }
  // "Professional Visit Only" prices individually billed visits. A per diem
  // night is not one, so the inpatient block collects no copay under it.

  const admissionFees = lines.reduce(
    (sum, l) => sum + (l.active ? toNumber(form.admissionFees[l.key]) : 0),
    0
  )

  const share = applyCostShare({
    deductibleApplied,
    coinsurance,
    copay,
    oopRemaining: oopmRemaining,
    deductibleInOopm: ctx.deductibleInOopm,
    copayReplacesCoinsurance: ctx.copayReplacesCoinsurance,
    copayToDeductible: ctx.copayToDeductible,
    copayToOop: ctx.copayToOop,
  })

  // H16 — an admission fee that counts toward the maximum is capped with
  // everything else; one that does not is simply added on top of the capped
  // responsibility.
  const withFee = ctx.admissionFeeInOopm
    ? applyCostShare({
        deductibleApplied,
        coinsurance,
        copay,
        oopRemaining: oopmRemaining,
        deductibleInOopm: ctx.deductibleInOopm,
        copayReplacesCoinsurance: ctx.copayReplacesCoinsurance,
        copayToDeductible: ctx.copayToDeductible,
        copayToOop: ctx.copayToOop,
        extraInsideCap: admissionFees,
      }).afterCap
    : share.afterCap + admissionFees

  return {
    lines,
    active: lines.some((l) => l.active),
    totalNights: lines.reduce((sum, l) => sum + (l.active ? l.nights : 0), 0),
    totalAllowed,
    admissionFees,
    deductibleApplied,
    coinsurance,
    copay,
    beforeCap: share.beforeCap,
    afterCap: share.afterCap,
    // J32 / J33 read these to know what the outpatient block inherits.
    oopConsumed: ctx.admissionFeeInOopm
      ? Math.min(
          oopmRemaining,
          (ctx.deductibleInOopm ? share.netDeductible : 0) +
            share.coinsuranceDue +
            (ctx.copayToOop === 'Yes' ? copay : 0) +
            admissionFees
        )
      : share.oopConsumed,
    revenue: clampAtZero(totalAllowed - share.afterCap),
    deposit: withFee,
  }
}

// ── Outpatient waterfall (rows 20–41) ────────────────────────────────────────

function computeOutpatient(form, ctx, inpatient) {
  const { sequence, coins, copayAmount, basis } = ctx
  const bundled = ctx.network === 'INN' && form.bundledInnIop === 'Yes'

  const lines = SERVICE_LINES.map((line) => {
    const inSequence = line.activatedBy.some((loc) => sequenceIncludes(sequence, loc))
    const bundledOut = bundled && line.bundledOutInnIop && sequenceIncludes(sequence, SEQ_LOC.IOP)
    const active = inSequence && !bundledOut
    const units = unitsFor(line, form)
    const rate = ctx.rateFor(line.code)
    return {
      ...line,
      inSequence,
      bundledOut,
      active,
      units,
      rate,
      afterDeductibleRate: rate === null ? null : rate * coins,
      allowed: active && rate !== null ? units * rate : 0,
      rateMissing: active && rate === null,
    }
  })

  const totalAllowed = lines.reduce((sum, l) => sum + l.allowed, 0)
  const anyActive = OUTPATIENT_LOCS.some((loc) => sequenceIncludes(sequence, loc))

  // J32 / J33 — the outpatient block starts from what the inpatient block left.
  const deductibleAtEntry = clampAtZero(ctx.deductibleRemaining - inpatient.deductibleApplied)
  const oopAtEntry = clampAtZero(ctx.oopmRemaining - inpatient.oopConsumed)

  const admissionFees = anyActive
    ? ADMISSION_FEE_LOCS.filter((l) => OUTPATIENT_LOCS.includes(l.loc))
        .reduce(
          (sum, l) => sum + (sequenceIncludes(sequence, l.loc) ? toNumber(form.admissionFees[l.key]) : 0),
          0
        )
    : 0

  const deductibleApplied = anyActive ? Math.min(deductibleAtEntry, totalAllowed) : 0
  const coinsurance = anyActive ? clampAtZero(totalAllowed - deductibleApplied) * coins : 0

  // J37 — how many units the copay is charged against.
  let copayUnits = 0
  if (basis === COPAY_BASIS.PER_UNIT) {
    copayUnits = lines.reduce((sum, l) => sum + (l.active ? l.units : 0), 0)
  } else if (basis === COPAY_BASIS.PROFESSIONAL_ONLY) {
    copayUnits = lines.reduce((sum, l) => sum + (l.active && l.professional ? l.units : 0), 0)
  }
  let copay = 0
  if (anyActive) {
    copay = basis === COPAY_BASIS.MANUAL ? copayAmount : copayUnits * copayAmount
  }

  const share = applyCostShare({
    deductibleApplied,
    coinsurance,
    copay,
    oopRemaining: oopAtEntry,
    deductibleInOopm: ctx.deductibleInOopm,
    copayReplacesCoinsurance: ctx.copayReplacesCoinsurance,
    copayToDeductible: ctx.copayToDeductible,
    copayToOop: ctx.copayToOop,
  })

  const withFee = ctx.admissionFeeInOopm
    ? applyCostShare({
        deductibleApplied,
        coinsurance,
        copay,
        oopRemaining: oopAtEntry,
        deductibleInOopm: ctx.deductibleInOopm,
        copayReplacesCoinsurance: ctx.copayReplacesCoinsurance,
        copayToDeductible: ctx.copayToDeductible,
        copayToOop: ctx.copayToOop,
        extraInsideCap: admissionFees,
      }).afterCap
    : share.afterCap + admissionFees

  return {
    lines,
    active: anyActive,
    bundled,
    totalAllowed,
    deductibleAtEntry,
    oopAtEntry,
    admissionFees,
    deductibleApplied,
    coinsurance,
    copay,
    copayUnits,
    beforeCap: share.beforeCap,
    afterCap: share.afterCap,
    revenue: clampAtZero(totalAllowed - share.afterCap),
    deposit: withFee,
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

export function computeEstimate(form) {
  const network = carrierNetwork(form.carrier)
  const sequence = form.treatmentSequence
  const coins = toNumber(form.coinsurancePercent) / 100

  const rateFor = (code) => resolveRate(form, code).rate

  const ctx = {
    sequence,
    network,
    coins,
    rateFor,
    copayAmount: toNumber(form.copayAmount),
    basis: form.copayBasis,
    deductibleRemaining: toNumber(form.deductibleRemaining),
    oopmRemaining: toNumber(form.oopmRemaining),
    deductibleInOopm: form.deductibleInOopm === 'Yes',
    admissionFeeInOopm: form.admissionFeeInOopm === 'Yes',
    copayReplacesCoinsurance: form.copayTreatment === COPAY_TREATMENT.REPLACE,
    copayToDeductible: form.copayAppliesToDeductible === 'Yes',
    copayToOop: form.copayAppliesToOop,
  }

  const inpatient = computeInpatient(form, ctx)
  const outpatient = computeOutpatient(form, ctx, inpatient)
  const previousBalance = toNumber(form.previousBalance)

  // Every active line whose carrier rate is missing. The workbook leaves those
  // cells amber; here they are named, because a total assembled over a missing
  // rate is understating the cost by a number nobody can see.
  const missingRates = [...inpatient.lines, ...outpatient.lines]
    .filter((l) => l.rateMissing && (l.units ?? l.nights) > 0)
    .map((l) => ({
      key: l.key,
      label: l.label,
      code: l.code,
      benchmark: benchmarkRate(l.code),
      // "Uncontracted here" and "nobody has priced this" need different
      // answers, so the warning does not merge them.
      uncontracted: resolveRate(form, l.code).source === 'uncontracted',
    }))

  return {
    network,
    inpatient,
    outpatient,
    previousBalance,
    missingRates,
    schedule: getSchedule(form.contractSchedule),
    totalAllowed: inpatient.totalAllowed + outpatient.totalAllowed,
    totalRevenue: inpatient.revenue + outpatient.revenue,
    // I1 — the number the client is quoted.
    grandTotal: inpatient.deposit + outpatient.deposit + previousBalance,
  }
}

// Blockers that make a quote wrong rather than merely incomplete. A deposit
// read to a client off a half-entered estimate is the failure this prevents.
export function estimateBlockers(form) {
  const blockers = []
  if (!form.carrier) blockers.push('Select an insurance carrier')
  if (!form.treatmentSequence) blockers.push('Select a treatment sequence')
  if (form.coinsurancePercent === '') {
    blockers.push('Enter the coinsurance percentage (enter 0 if the plan has none)')
  }
  if (form.deductibleRemaining === '') blockers.push('Enter the deductible remaining')
  if (form.oopmRemaining === '') blockers.push('Enter the out-of-pocket maximum remaining')
  if (form.copayBasis !== COPAY_BASIS.NA && toNumber(form.copayAmount) <= 0) {
    blockers.push('A copay basis is selected but no copay amount is entered')
  }
  if (toNumber(form.copayAmount) > 0 && form.copayBasis === COPAY_BASIS.NA) {
    blockers.push('A copay amount is entered but its basis is "Not Applicable" — it will not be collected')
  }
  if (toNumber(form.copayAmount) > 0) {
    if (form.copayAppliesToDeductible === 'Not Applicable') {
      blockers.push('State whether the copay applies to the deductible')
    }
    if (form.copayAppliesToOop === 'Not Applicable') {
      blockers.push('State whether the copay applies to the out-of-pocket maximum')
    }
  }
  return blockers
}

// ── Rate lookup search ───────────────────────────────────────────────────────
// The workbook's CPT lookup makes you choose up front whether you are searching
// by code or by description, because a spreadsheet dropdown cannot do both.
// That constraint does not exist here, so one query matches either.

export function searchCodes(query, carrier, { limit = 40 } = {}) {
  const q = String(query || '').trim().toLowerCase()
  const scored = []

  for (const entry of CODES) {
    const code = entry.code.toLowerCase()
    const description = entry.description.toLowerCase()
    let score = -1
    if (!q) score = 0
    else if (code === q) score = 100
    else if (code.startsWith(q)) score = 90
    else if (description.startsWith(q)) score = 80
    else if (description.includes(q)) score = 60
    else if (code.includes(q)) score = 40
    if (score < 0) continue

    const rate = lookupRate(carrier, entry.code)
    scored.push({
      code: entry.code,
      description: entry.description,
      rate,
      benchmark: benchmarkRate(entry.code),
      // A carrier with no rate on file is the workbook's amber cell: estimate
      // from a similar plan rather than treating the service as free.
      onFile: rate !== null,
      score,
    })
  }

  // A rate the carrier actually has outranks one it does not, so a search never
  // leads with a row that cannot answer the question being asked.
  scored.sort((a, b) => b.score - a.score || Number(b.onFile) - Number(a.onFile) || a.code.localeCompare(b.code))
  return scored.slice(0, limit)
}

// Every carrier that does have a rate for this code — the "similar plan" the
// workbook tells you to estimate from, without leaving the app to find one.
export function carriersWithRate(code, { limit = 8 } = {}) {
  return CARRIERS.map((c) => ({ ...c, rate: lookupRate(c.name, code) }))
    .filter((c) => c.rate !== null)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, limit)
}
