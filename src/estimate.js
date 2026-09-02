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
import { correctedRate } from './data/rateCorrections.js'
import {
  UNCONTRACTED_CODES,
  getSchedule,
  scheduleForLocation,
  scheduleRate,
} from './data/contractRates.js'
import {
  OTHER_CARRIER,
  SUPPLEMENTAL_CARRIERS,
  payerGroupFor,
  reimbursementRate,
} from './data/reimbursement.js'
import { percentOfChargePayer, percentOfChargeRate } from './data/percentOfCharge.js'

// ── Copay handling ───────────────────────────────────────────────────────────
// The workbook asks three separate questions about a copay, and each one moves
// money on its own: how it is counted (basis), whether it displaces coinsurance
// (treatment), and which accumulators it feeds.
//
// A fourth question the workbook never asks: where the copay stops. A detox or
// residential benefit is often written "$200 a day up to $2,000" — a per-unit
// copay with a ceiling on what it can add up to. The amount says what one unit
// costs; the maximum says when the meter stops. See `copayLedger` below.

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

// The rate table's carriers, the payers only the claims data knows about, and
// the explicit "not listed" option — which is the only thing that draws on the
// Misc claims bucket.
//
// Alphabetical, not sheet order. The workbook's list is alphabetical down to
// the point where new carriers started being appended to the bottom, so the
// twenty-odd most recently added plans are exactly the ones nobody can find.
// `numeric` keeps "BCBS - Other 2" after "BCBS - Other 10" from ever mattering,
// and `base` sensitivity means a stray capital does not sort a name away from
// its neighbours. "Other — not listed" is not a carrier and stays at the end.
const byName = (a, b) =>
  a.value.localeCompare(b.value, 'en', { numeric: true, sensitivity: 'base' })

export const CARRIER_OPTIONS = [
  ...[
    ...CARRIERS.map((c) => ({ value: c.name, label: `${c.name} — ${c.network}` })),
    ...SUPPLEMENTAL_CARRIERS.map((name) => ({
      value: name,
      label: `${name} — network not on file`,
    })),
  ].sort(byName),
  { value: OTHER_CARRIER, label: `${OTHER_CARRIER} — Misc claims average` },
]

export function isOtherCarrier(carrier) {
  return carrier === OTHER_CARRIER
}

// A carrier with no network recorded anywhere. The estimator asks rather than
// defaulting, because INN and OON are not interchangeable in any downstream
// question — bundling, contracted rates, or what the client is told.
export function needsNetworkChoice(carrier) {
  return Boolean(carrier) && !carrierNetwork(carrier)
}

// The plan's network: the carrier's own status, or the one stated by hand for a
// carrier that has none on file.
export function effectiveNetwork(form) {
  return needsNetworkChoice(form.carrier) ? form.networkOverride || '' : carrierNetwork(form.carrier)
}

// A contracted rate schedule is an in-network agreement. Out of network there
// is no contract with the payer, so the allowed amount is whatever that plan
// allows — the schedule must not price anything, however the location is set.
export function scheduleInEffect(form) {
  if (effectiveNetwork(form) !== 'INN') return null
  return getSchedule(scheduleForLocation(form.location))
}

export function codeDescription(code) {
  const found = CODE_BY_ID.get(String(code))
  return found ? found.description : ''
}

// The workbook's `INDEX(...MATCH(carrier)...MATCH(code)...)`, with the hand
// corrections in `rateCorrections.js` laid over it. A blank cell there is an
// amber "estimate from a similar plan", not a zero, so this returns null and
// every caller has to decide what to say about a rate that does not exist.
export function lookupRate(carrier, code) {
  const corrected = correctedRate(carrier, code)
  if (corrected !== null) return corrected
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
// The outpatient block's eleven rows.
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
// same service. `oncePerEpisode` marks the ones a step-down does not repeat;
// see defaultUnitsFor below. Every count is editable, and these are only the
// starting point.
//
// `professional` marks the lines the "Professional Visit Only" copay basis
// counts: the individually billed visits, not the program day.
//
// `bundledOutInnIop` marks what an INN bundled IOP agreement folds into the
// program rate: the intake, individual therapy and family therapy. The bundle
// is an IOP agreement, so it zeroes those lines only where they are delivered
// in IOP — an `IOP > OP` client's OP therapy is billed, because no bundle
// covers it — and psychiatry is never in it.
//
// `billedAt` names the level of care a service is billed at when that is not
// the level it is delivered in. Psychiatry — the evaluation, the follow-ups and
// the MATs injections — is outpatient care wherever the client is: a
// psychiatric visit during an IOP course is an OP visit, and it takes OP's
// terms — its copay, and whether that copay touches the deductible — rather
// than the IOP course's. It is the one case where a level of care is in force
// without the sequence naming it.
//
// `deliveredAcrossLevels` marks a service that is one course for the admission
// but delivered through every level the client passes: the psychiatric
// follow-ups continue after a step-down. It splits into a row per level like a
// therapy does, except that what is divided between them is the episode's own
// total rather than the sum of two courses — so the counts do not change, only
// what can be said about where the visits happen. That matters wherever a level
// of care is charged as a whole, an all-inclusive admission fee above all.
//
// The OP specialty group bills the same code as the routine OP group, 90853,
// and against insurance that is the whole story: the plan allows one amount per
// group and does not distinguish the curriculum, so the two lines resolve to
// one rate and editing either rate cell moves both. It is a separate row only
// because the counts differ — the specialty track and the routine groups are
// each scheduled their own share of the OP week. (Self-pay is the one place
// the two prices part company; see `fixedRate` in selfPay.js.) An OP course
// starts at ten of each: the same twenty groups the workbook carried on a
// single row, split across the two rows the schedule actually runs, so an OP
// episode still prices identically at the default counts.

export const SERVICE_LINES = [
  { key: 'opwm', label: 'OPWM', code: 'H0014', defaultUnits: { OPWM: 5 }, activatedBy: [SEQ_LOC.OPWM], professional: false, bundledOutInnIop: false },
  { key: 'php', label: 'PHP', code: 'H0035', defaultUnits: { PHP: 20 }, activatedBy: [SEQ_LOC.PHP], professional: false, bundledOutInnIop: false },
  { key: 'assessment', label: 'Initial Assessment', code: '90791', defaultUnits: { IOP: 1, OP: 1 }, oncePerEpisode: true, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: true },
  { key: 'iop', label: 'IOP Services', code: 'H0015', defaultUnits: { IOP: 30 }, activatedBy: [SEQ_LOC.IOP], professional: false, bundledOutInnIop: false },
  { key: 'opGroups', label: 'OP Groups', code: '90853', defaultUnits: { OP: 10 }, activatedBy: [SEQ_LOC.OP], professional: false, bundledOutInnIop: false },
  { key: 'opSpecialtyGroup', label: 'OP Specialty Group', code: '90853', defaultUnits: { OP: 10 }, activatedBy: [SEQ_LOC.OP], professional: false, bundledOutInnIop: false },
  { key: 'individual', label: 'Individual Therapy', code: '90837', defaultUnits: { IOP: 9, OP: 10 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: true },
  { key: 'psychEval', label: 'Psychiatric Evaluation', code: '90792', defaultUnits: { IOP: 1, OP: 1 }, oncePerEpisode: true, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: false, billedAt: SEQ_LOC.OP },
  { key: 'psychFollowUp', label: 'Psychiatric Follow Up', code: '99214', defaultUnits: { IOP: 2, OP: 2 }, oncePerEpisode: true, deliveredAcrossLevels: true, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: false, billedAt: SEQ_LOC.OP },
  { key: 'family', label: 'Family Therapy', code: '90847', defaultUnits: { IOP: 0, OP: 3 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: true },
  { key: 'mats', label: 'MATs Injection', code: '96372', defaultUnits: { IOP: 0, OP: 0 }, activatedBy: [SEQ_LOC.IOP, SEQ_LOC.OP], professional: true, bundledOutInnIop: false, billedAt: SEQ_LOC.OP },
]

// The starting unit count for a line under a given sequence.
//
// Therapy and group counts accumulate across the levels of care in a pathway —
// an IOP course and the OP course a client steps down into each carry their
// own sessions. The psychiatric services do not: the intake, the evaluation
// and the follow-ups are one course for the admission, so a step-down takes
// the larger of the two rather than starting a second course.
export function defaultUnitsFor(line, sequence) {
  const counts = line.activatedBy
    .filter((loc) => sequenceIncludes(sequence, loc))
    .map((loc) => line.defaultUnits[loc] || 0)
  if (counts.length === 0) return 0
  return line.oncePerEpisode ? Math.max(...counts) : counts.reduce((a, b) => a + b, 0)
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

// A count of nights, sessions or visits. Whole where it is whole — a fraction
// appears only when the number really is one, which is the case worth seeing.
export function formatUnits(value) {
  const n = toNumber(value)
  return Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1)
}

// "1 session", not "1 sessions" — these strings are read by clients.
export function unitNoun(count, noun) {
  return Math.abs(toNumber(count) - 1) < 1e-9 ? noun.replace(/s$/, '') : noun
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
  networkOverride: '',
  copayBasis: COPAY_BASIS.NA,
  // Blank is no ceiling, which is not the same as a ceiling of nothing: a plan
  // that never stated one does not stop collecting.
  copayMax: '',
  copayTreatment: COPAY_TREATMENT.NA,
  copayAppliesToDeductible: 'Not Applicable',
  copayAppliesToOop: 'Not Applicable',
  // Per level of care, only where a plan departs from its own terms:
  // { IOP: { deductibleApplies: 'No', copayAmount: '50', copayBasis: '…' } }
  levelRules: {},
  admissionFees: { detox: '', residential: '', opwm: '', php: '', iop: '', op: '' },
  admissionFeeInOopm: 'No',
  treatmentSequence: '',
  previousBalance: '',
  // Hardship is off until someone turns it on: a deposit estimate is the same
  // estimate whether or not the client can pay it, and the panel that splits it
  // stays out of the way until it is asked for.
  hardship: 'No',
  clientCanAfford: '',
  nights: { detox: String(INPATIENT_LINES[0].nights), residential: String(INPATIENT_LINES[1].nights) },
  // Only what the user typed. A blank falls back to the sequence's own default,
  // so changing the pathway re-bases every count that was never overridden.
  location: '',
  units: {},
  // Rates are looked up from the carrier table, but a verification call can
  // establish a number the table does not have. An override here is the user's
  // rate; a blank falls back to the table.
  rateOverrides: {},
}

// ── Rate resolution ──────────────────────────────────────────────────────────
// Five sources, in descending authority:
//
//   1. an override the user typed — they are looking at the contract
//   2. the location's contract schedule, in network only — a signed rate
//   3. the carrier table — this plan's stated allowed amount
//   4. a percentage of our billed charge, for a payer that processes that way
//   5. the payer group's average reimbursement — what claims like this got paid
//
// The last two are derived rather than stated, so each is reported with its own
// source and never presented as a contracted number. A code none of the five
// covers stays null rather than becoming zero.

export function resolveRate(form, code) {
  const override = form.rateOverrides?.[code]
  if (override !== undefined && override !== '') {
    const n = parseFloat(override)
    if (Number.isFinite(n)) return { rate: n, source: 'override' }
  }
  const schedule = scheduleInEffect(form)
  if (schedule) {
    const contracted = scheduleRate(schedule.id, code)
    if (contracted !== null) return { rate: contracted, source: 'contract' }
  }

  const carrier = lookupRate(form.carrier, code)
  if (carrier !== null) return { rate: carrier, source: 'carrier' }

  // A plan with no allowed amounts of its own, whose claims come back at a
  // known percentage of what we billed. Arithmetic on our charge master rather
  // than anything the plan has stated, so it ranks under the carrier table and
  // carries the percentage with it.
  const ofCharge = percentOfChargeRate(form.carrier, code)
  if (ofCharge !== null) {
    return { rate: ofCharge.rate, source: 'percent-of-charge', percent: ofCharge.percent, billed: ofCharge.billed }
  }

  // Nothing has this code priced for the plan itself. An average over the
  // payer group's own paid claims beats leaving the service at $0, as long as
  // it is never mistaken for the real thing — hence a source of its own, and a
  // weaker one still when the carrier only reaches a group through the `Misc`
  // reporting bucket.
  const observed = reimbursementRate(form.carrier, code)
  if (observed !== null) {
    return { rate: observed, source: 'payer-average', group: payerGroupFor(form.carrier)?.group }
  }

  // A code the schedule lists with no contracted rate is uncontracted at this
  // location, which is a different problem from one nobody has priced.
  return {
    rate: null,
    source: schedule && UNCONTRACTED_CODES.includes(String(code)) ? 'uncontracted' : 'missing',
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
// The workbook asks those three questions once for the whole episode. A plan
// does not always answer them once: an IOP course can be billed against the
// deductible and coinsured on the contracted rate while the psychiatry
// delivered alongside it is an outpatient copay that never touches the
// deductible and only feeds the out-of-pocket maximum. One plan-wide answer
// cannot hold both — a copay that replaces coinsurance in OP would wipe out
// the coinsurance IOP is charging.
//
// So each level of care states what it charges and how the plan counts it, and
// the block adds those contributions up. Where every level is on the plan's
// terms each sum collapses to the workbook's single expression, which is why an
// estimate with nothing overridden is still the workbook's estimate.
//
// The OOP maximum caps only the portion of that total the plan actually counts
// toward it. Anything the plan does not count keeps being collected after the
// maximum is reached, which is why those pieces sit outside the MIN().

// What one level of care contributes, sorted by how the plan counts it.
function levelShare(rule, { deductible = 0, coinsurance = 0, copay = 0 }) {
  return {
    deductible,
    coinsurance,
    copay,
    // A copay credited to the deductible is not collected a second time as
    // deductible. The credit is settled against the block's whole deductible
    // rather than this level's, because a copay paid in one level of care
    // counts toward the deductible the next one spends.
    creditableCopay: rule.copayToDeductible ? copay : 0,
    coinsuranceDue: rule.copayReplacesCoinsurance ? 0 : coinsurance,
    // "Applies to OOP" is three states, not two, and the third one is not a
    // synonym for "No": a copay whose accumulator treatment was never
    // established goes into neither side of the cap, so it drops out of the
    // deposit entirely. That is the workbook's behavior, and it is why a copay
    // with an unanswered OOP question is a submit blocker rather than a default.
    copayInsideCap: rule.copayToOop === 'Yes' ? copay : 0,
    copayOutsideCap: rule.copayToOop === 'No' ? copay : 0,
  }
}

function applyCostShare(shares, { oopRemaining, deductibleInOopm, extraInsideCap = 0 }) {
  const sum = (key) => shares.reduce((total, share) => total + share[key], 0)

  const deductibleApplied = sum('deductible')
  const deductibleCredit = Math.min(sum('creditableCopay'), deductibleApplied)
  const netDeductible = clampAtZero(deductibleApplied - deductibleCredit)
  const coinsuranceDue = sum('coinsuranceDue')
  const copay = sum('copay')

  const beforeCap = netDeductible + coinsuranceDue + copay

  const insideCap =
    (deductibleInOopm ? netDeductible : 0) + coinsuranceDue + sum('copayInsideCap') + extraInsideCap
  const outsideCap = (deductibleInOopm ? 0 : netDeductible) + sum('copayOutsideCap')

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

// ── Level-of-care rules ──────────────────────────────────────────────────────
// The workbook states the plan's terms once and applies them to the whole
// episode. Real benefit checks are not always that tidy: a plan can waive the
// deductible for IOP and charge it in OP, or attach a different copay to each
// level of care, inside one `IOP > OP` sequence.
//
// So the plan terms are the default and a level may override them. Only what a
// verification call actually established is entered; every level left alone
// reads the plan-wide answer, which is why an estimate with no overrides is the
// same estimate the workbook computes.

export const LEVEL_RULE_LOCS = [
  { loc: SEQ_LOC.DETOX, label: 'Detox' },
  { loc: SEQ_LOC.RESIDENTIAL, label: 'Residential' },
  { loc: SEQ_LOC.OPWM, label: 'OPWM' },
  { loc: SEQ_LOC.PHP, label: 'PHP' },
  { loc: SEQ_LOC.IOP, label: 'IOP' },
  { loc: SEQ_LOC.OP, label: 'OP' },
]

// The plan's own terms, in the shape a level of care states its terms in. Every
// level reads these until it says otherwise.
export function planRule(form) {
  return {
    loc: null,
    deductibleApplies: true,
    copayAmount: toNumber(form.copayAmount),
    copayBasis: form.copayBasis,
    copayMax: toNumber(form.copayMax),
    copayMaxOverridden: false,
    copayTreatment: form.copayTreatment,
    copayReplacesCoinsurance: form.copayTreatment === COPAY_TREATMENT.REPLACE,
    copayToDeductibleAnswer: form.copayAppliesToDeductible,
    copayToDeductible: form.copayAppliesToDeductible === 'Yes',
    copayToOop: form.copayAppliesToOop,
  }
}

// The rules in force for one level of care: the plan's terms, with whatever
// this level overrides laid over them.
//
// All five copay questions are answerable here, not just the amount and the
// basis, because the answers that decide what a copay does to the rest of the
// bill — whether it replaces coinsurance, whether it is credited to the
// deductible, whether it feeds the out-of-pocket maximum — are exactly the ones
// a plan splits by level of care.
//
// Two flags matter downstream. `deductibleOverridden` says this level does not
// spend the deductible. `chargeOverridden` says the level states its own copay
// charge rather than the plan's: a manual-total copay is one charge for a
// block, and a level that names its own is charged separately from it, while a
// level that only answers an accumulator question differently is still on the
// plan's charge.
export function levelRule(form, loc) {
  const rule = form.levelRules?.[loc] || {}
  const plan = planRule(form)
  const deductibleOverridden = rule.deductibleApplies === 'No'
  const copayAmountSet = rule.copayAmount !== undefined && rule.copayAmount !== ''
  const copayBasisSet = Boolean(rule.copayBasis)
  const copayMaxSet = rule.copayMax !== undefined && rule.copayMax !== ''
  const feeCovers = rule.admissionFeeCovers === 'Yes'
  const treatmentSet = Boolean(rule.copayTreatment)
  const toDeductibleSet = Boolean(rule.copayAppliesToDeductible)
  const toOopSet = Boolean(rule.copayAppliesToOop)
  const copayTreatment = treatmentSet ? rule.copayTreatment : plan.copayTreatment
  const chargeOverridden = copayAmountSet || copayBasisSet
  return {
    loc,
    deductibleApplies: !deductibleOverridden,
    deductibleOverridden,
    // An admission fee that covers the level is the client's whole cost share
    // for it: nothing delivered there is charged a deductible, coinsurance or a
    // copay, and the deductible pool passes through to the next level untouched.
    admissionFeeCovers: feeCovers,
    chargeOverridden,
    copayOverridden: chargeOverridden || copayMaxSet || treatmentSet || toDeductibleSet || toOopSet,
    ownTerms:
      deductibleOverridden ||
      feeCovers ||
      chargeOverridden ||
      copayMaxSet ||
      treatmentSet ||
      toDeductibleSet ||
      toOopSet,
    copayAmount: copayAmountSet ? toNumber(rule.copayAmount) : plan.copayAmount,
    copayBasis: copayBasisSet ? rule.copayBasis : plan.copayBasis,
    // A ceiling this level states is this level's own; one it reads from the
    // plan is a share of the plan's, which is what `copayLedger` keys on.
    copayMax: copayMaxSet ? toNumber(rule.copayMax) : plan.copayMax,
    copayMaxOverridden: copayMaxSet,
    copayTreatment,
    copayReplacesCoinsurance: copayTreatment === COPAY_TREATMENT.REPLACE,
    copayToDeductibleAnswer: toDeductibleSet
      ? rule.copayAppliesToDeductible
      : plan.copayToDeductibleAnswer,
    copayToDeductible: toDeductibleSet
      ? rule.copayAppliesToDeductible === 'Yes'
      : plan.copayToDeductible,
    copayToOop: toOopSet ? rule.copayAppliesToOop : plan.copayToOop,
  }
}

// The levels of care this estimate actually bills at, in the order care is
// delivered through them. That is the sequence's own levels, plus outpatient
// where a service billed at the OP level is delivered inside a higher one —
// psychiatry during IOP is billed as outpatient care, so OP's terms are in
// force even in a sequence that never names it.
export function billingLevels(form) {
  return LEVEL_RULE_LOCS.filter(
    ({ loc }) =>
      sequenceIncludes(form.treatmentSequence, loc) ||
      SERVICE_LINES.some(
        (line) =>
          line.billedAt === loc &&
          line.activatedBy.some((a) => sequenceIncludes(form.treatmentSequence, a))
      )
  )
}

// Whether any level of care this estimate bills at departs from the plan's
// terms. The screen and the written output both say so when it does: a deposit
// computed under mixed rules is not something to discover from a number alone.
export function hasLevelOverrides(form) {
  return billingLevels(form).some(({ loc }) => levelRule(form, loc).ownTerms)
}

export function levelOverrideSummary(form) {
  return billingLevels(form)
    .map(({ loc, label }) => ({ label, ...levelRule(form, loc) }))
    .filter((r) => r.ownTerms)
}

// The admission fee entered for a level of care, which is what an all-inclusive
// level charges instead of everything else.
export function admissionFeeFor(form, loc) {
  const fee = ADMISSION_FEE_LOCS.find((f) => f.loc === loc)
  return fee ? toNumber(form.admissionFees?.[fee.key]) : 0
}

// The copay a level collects, given the units inside it. The basis decides what
// it is charged against; a manual total is not charged here because it is one
// charge for a block rather than a per-unit one, and blockCopay settles it.
function levelUnitCopay(rule, locLines) {
  if (rule.copayAmount <= 0 || rule.copayBasis === COPAY_BASIS.NA) return { copay: 0, units: 0 }
  if (rule.copayBasis === COPAY_BASIS.PER_UNIT) {
    const units = locLines.reduce((sum, l) => sum + (l.units ?? l.nights ?? 0), 0)
    return { copay: units * rule.copayAmount, units }
  }
  if (rule.copayBasis === COPAY_BASIS.PROFESSIONAL_ONLY) {
    const units = locLines.reduce((sum, l) => sum + (l.professional ? l.units ?? 0 : 0), 0)
    return { copay: units * rule.copayAmount, units }
  }
  return { copay: 0, units: 0 }
}

// A manual-total copay is one charge for a block, not one per level — that is
// what the workbook collects, and it stays true while every level reads the
// plan's amount. A level that states its own manual copay is its own block and
// is charged separately, under its own answers about what that charge counts
// toward.
function levelManualCopay(rule) {
  return rule.copayBasis === COPAY_BASIS.MANUAL && rule.chargeOverridden && rule.copayAmount > 0
    ? rule.copayAmount
    : 0
}

// The plan's own manual total, charged once for the block and only while some
// level of care is still reading it.
function planManualCopay(form, rules) {
  const onPlan = rules.some(
    (r) => !r.chargeOverridden && r.copayBasis === COPAY_BASIS.MANUAL && r.copayAmount > 0
  )
  return onPlan ? toNumber(form.copayAmount) : 0
}

// ── The copay maximum ────────────────────────────────────────────────────────
// "$200 a day up to $2,000." The ceiling is not a second copay question about
// one charge — it is a running total across everything charged under it, so it
// cannot be settled line by line the way the amount and the basis can. This
// keeps that total for one estimate.
//
// What shares a ceiling is what reads the same one. A maximum entered on the
// plan is one ceiling for the episode: the detox nights are charged in the
// order they are stayed, and a ceiling detox fills leaves nothing for the
// residential days after it — and nothing for the outpatient block either,
// which starts from what the inpatient block left exactly as the deductible and
// the out-of-pocket room do. A maximum entered on a level of care is that
// level's own ceiling and stops that level alone.
//
// The cap is applied before the accumulators, not after, because a copay the
// plan never collects is not credited to the deductible and does not spend
// out-of-pocket room. Everything downstream sees the charge as collected.
const PLAN_CEILING = Symbol('plan copay maximum')

function copayLedger() {
  const spent = new Map()
  return {
    charge(rule, copay) {
      if (!(rule.copayMax > 0) || copay <= 0) return copay
      const key = rule.copayMaxOverridden ? rule.loc : PLAN_CEILING
      const used = spent.get(key) || 0
      const charged = Math.min(copay, clampAtZero(rule.copayMax - used))
      spent.set(key, used + charged)
      return charged
    },
  }
}

// ── Inpatient waterfall (rows 5–16) ──────────────────────────────────────────

function computeInpatient(form, ctx) {
  const { sequence, coins, deductibleRemaining, oopmRemaining } = ctx

  const lines = INPATIENT_LINES.map((line) => {
    const active = sequenceIncludes(sequence, line.loc)
    const nights = toNumber(form.nights[line.key])
    const rate = ctx.rateFor(line.code)
    const allowed = active && rate !== null ? nights * rate : 0
    return { ...line, active, nights, rate, allowed, rateMissing: active && rate === null }
  })

  const totalAllowed = lines.reduce((sum, l) => sum + l.allowed, 0)
  const rules = lines
    .filter((l) => l.active && !levelRule(form, l.loc).admissionFeeCovers)
    .map((l) => levelRule(form, l.loc))

  // F10 / G10 — the deductible is consumed in sequence order: detox takes what
  // it can, residential takes what detox left. A level the plan does not apply
  // the deductible to takes none of it and passes the whole pool on.
  let deductiblePool = deductibleRemaining
  lines.forEach((line) => {
    const rule = levelRule(form, line.loc)
    line.coveredByFee = line.active && rule.admissionFeeCovers
    const charges = line.active && !line.coveredByFee
    const applied = charges && rule.deductibleApplies ? Math.min(deductiblePool, line.allowed) : 0
    line.deductibleApplied = applied
    line.deductibleWaived = charges && !rule.deductibleApplies
    deductiblePool = clampAtZero(deductiblePool - applied)
  })
  const deductibleApplied = lines.reduce((sum, l) => sum + l.deductibleApplied, 0)

  // F11 / G11 — coinsurance is charged on what the deductible did not absorb,
  // and on nothing an admission fee has already covered.
  lines.forEach((line) => {
    line.coinsurance = line.coveredByFee
      ? 0
      : clampAtZero(line.allowed - line.deductibleApplied) * coins
  })
  const coinsurance = lines.reduce((sum, l) => sum + l.coinsurance, 0)

  // F12 / G12 — a per-night copay is charged level by level under that level's
  // own terms; a manual total is one charge for the stay. Each level's charge
  // is kept with the rules that decide what it counts toward, because those
  // are the level's answers and not necessarily the plan's.
  let copayUnits = 0
  let copayBeforeMax = 0
  const shares = []
  lines.forEach((line) => {
    if (!line.active || line.coveredByFee) {
      line.copay = 0
      return
    }
    const rule = levelRule(form, line.loc)
    const { copay: lineCopay, units } = levelUnitCopay(rule, [line])
    const uncapped = lineCopay + levelManualCopay(rule)
    // The nights are charged in the order they are stayed, so a ceiling the
    // detox stay fills leaves nothing for the residential days after it.
    line.copay = ctx.copayCap.charge(rule, uncapped)
    line.copayMaxReached = line.copay < uncapped - 0.005
    copayBeforeMax += uncapped
    copayUnits += units
    shares.push(
      levelShare(rule, {
        deductible: line.deductibleApplied,
        coinsurance: line.coinsurance,
        copay: line.copay,
      })
    )
  })
  // "Professional Visit Only" prices individually billed visits. A per diem
  // night is not one, so the inpatient block collects no copay under it.

  const planCopayUncapped = planManualCopay(form, rules)
  const planCopay = ctx.copayCap.charge(planRule(form), planCopayUncapped)
  if (planCopay > 0) shares.push(levelShare(planRule(form), { copay: planCopay }))
  const copay = lines.reduce((sum, l) => sum + (l.active ? l.copay : 0), 0) + planCopay
  copayBeforeMax += planCopayUncapped

  const admissionFees = lines.reduce(
    (sum, l) => sum + (l.active ? toNumber(form.admissionFees[l.key]) : 0),
    0
  )

  const capInputs = { oopRemaining: oopmRemaining, deductibleInOopm: ctx.deductibleInOopm }
  const share = applyCostShare(shares, capInputs)

  // H16 — an admission fee that counts toward the maximum is capped with
  // everything else; one that does not is simply added on top of the capped
  // responsibility.
  const withFee = applyCostShare(shares, { ...capInputs, extraInsideCap: admissionFees })
  const deposit = ctx.admissionFeeInOopm ? withFee.afterCap : share.afterCap + admissionFees

  return {
    lines,
    active: lines.some((l) => l.active),
    totalNights: lines.reduce((sum, l) => sum + (l.active ? l.nights : 0), 0),
    totalAllowed,
    admissionFees,
    deductibleApplied,
    coinsurance,
    copay,
    copayUnits,
    // What the copay came to before its ceiling stopped it. The result panel
    // and the staff detail quote the difference rather than showing a total
    // nobody can reconcile against the nights it was charged on.
    copayBeforeMax,
    // What the waterfall actually charged, as against what it was handed: a
    // copay credited to the deductible is not collected twice, and a copay that
    // replaces coinsurance leaves no coinsurance behind it. The outputs quote
    // these, because they are what the client is asked for.
    netDeductible: share.netDeductible,
    coinsuranceDue: share.coinsuranceDue,
    beforeCap: share.beforeCap,
    afterCap: share.afterCap,
    // J32 / J33 read these to know what the outpatient block inherits. An
    // admission fee that counts toward the maximum consumed room here too.
    oopConsumed: ctx.admissionFeeInOopm ? withFee.oopConsumed : share.oopConsumed,
    revenue: clampAtZero(totalAllowed - share.afterCap),
    deposit,
  }
}

// What one more unit of a service costs the client once the deductible is met,
// under the rules of the level it is billed at. The rate beside it is the
// plan's allowed amount — what the plan is billed, not what the client hands
// over — and the two part company wherever a copay replaces coinsurance: there
// the client pays the copay and the allowed amount is between us and the payer.
function clientUnitCost(line, rule, rate, coins) {
  if (rate === null) return null
  const perUnit =
    rule.copayBasis === COPAY_BASIS.PER_UNIT ||
    (rule.copayBasis === COPAY_BASIS.PROFESSIONAL_ONLY && line.professional)
      ? rule.copayAmount
      : 0
  return rule.copayReplacesCoinsurance ? perUnit : rate * coins + perUnit
}

// ── Outpatient service rows ──────────────────────────────────────────────────
// A service shared between IOP and OP is one row while only one of them is in
// the sequence, and one row per level when both are — because two levels can
// carry different rules, and "nineteen individual sessions" cannot be split
// between them after the fact. The counts were always defined per level of
// care; this is where that becomes visible.
//
// A count typed against the whole service (which is what the row was before it
// split, and what a saved estimate carries) is divided between the levels in
// the proportion their defaults describe, so the total the user entered is the
// total that gets priced.
function splitUnits(line, locs, form) {
  const explicit = {}
  let anyExplicit = false
  for (const loc of locs) {
    const entered = form.units?.[`${line.key}:${loc}`]
    if (entered !== undefined && entered !== '') {
      explicit[loc] = toNumber(entered)
      anyExplicit = true
    }
  }

  const defaults = Object.fromEntries(locs.map((loc) => [loc, line.defaultUnits[loc] || 0]))
  const defaultTotal = locs.reduce((sum, loc) => sum + defaults[loc], 0)

  // What a level falls back to when nothing was typed against it: its share of
  // a total entered for the whole service, or its own default.
  // A service that is one course for the admission does not have an episode
  // total equal to the sum of its per-level counts — it is the larger of them
  // (see defaultUnitsFor). Where such a service is delivered across levels,
  // that single total is what gets divided between them.
  const total = form.units?.[line.key]
  const typedTotal = total !== undefined && total !== ''
  const fallback = {}
  if (typedTotal || line.oncePerEpisode) {
    const entered = typedTotal
      ? toNumber(total)
      : defaultUnitsFor(line, form.treatmentSequence)
    let assigned = 0
    locs.forEach((loc, i) => {
      if (i === locs.length - 1) {
        // The last level takes the remainder, so the split is exact rather than
        // a rounding of the number somebody typed.
        fallback[loc] = entered - assigned
        return
      }
      const portion = defaultTotal > 0 ? (defaults[loc] / defaultTotal) * entered : 0
      fallback[loc] = portion
      assigned += portion
    })
  } else {
    for (const loc of locs) fallback[loc] = defaults[loc]
  }

  if (!anyExplicit) return fallback
  return Object.fromEntries(locs.map((loc) => [loc, explicit[loc] ?? fallback[loc]]))
}

function outpatientLines(form, ctx) {
  const { sequence } = ctx
  const bundled = ctx.network === 'INN' && form.bundledInnIop === 'Yes'
  const activeLocs = OUTPATIENT_LOCS.filter((loc) => sequenceIncludes(sequence, loc))

  const row = (line, deliveredIn, units, { inSequence, split }) => {
    // Where the service is billed, which is where it is delivered unless the
    // line says otherwise. The bundle is an IOP agreement, so it only folds in
    // what IOP delivers.
    const loc = inSequence && line.billedAt ? line.billedAt : deliveredIn
    const bundledOut = bundled && line.bundledOutInnIop && deliveredIn === SEQ_LOC.IOP
    const active = inSequence && !bundledOut
    const rate = ctx.rateFor(line.code)
    const rule = loc === null ? planRule(form) : levelRule(form, loc)
    const coveredByFee =
      active && deliveredIn !== null && levelRule(form, deliveredIn).admissionFeeCovers
    return {
      ...line,
      key: split ? `${line.key}:${deliveredIn}` : line.key,
      lineKey: line.key,
      label: split ? `${line.label} (${deliveredIn})` : line.label,
      loc,
      // Where the client was when it happened, which is what an all-inclusive
      // admission fee covers — a psychiatric visit during IOP is billed at the
      // OP level and still covered by the fee the IOP course charged.
      deliveredIn,
      coveredByFee,
      // A service billed somewhere other than the level it is delivered in says
      // so, because its copay and deductible come from there and not from the
      // level of care the client is in.
      billedElsewhere: inSequence && Boolean(line.billedAt) && deliveredIn !== line.billedAt,
      split,
      inSequence,
      bundledOut,
      active,
      units,
      rate,
      // Nothing more is charged for one more unit of care the fee already covers.
      clientPerUnit: coveredByFee ? 0 : clientUnitCost(line, rule, rate, ctx.coins),
      allowed: active && rate !== null ? units * rate : 0,
      rateMissing: active && rate === null,
    }
  }

  const rows = []
  for (const line of SERVICE_LINES) {
    const locs = line.activatedBy.filter((loc) => activeLocs.includes(loc))
    if (locs.length === 0) {
      rows.push(row(line, null, unitsFor(line, form), { inSequence: false, split: false }))
      continue
    }
    // The intake and the evaluation are one course for the admission rather than
    // one per level, so they stay a single row and belong to the level the
    // client was admitted to. The follow-ups are one course too, but a course
    // delivered through every level the client passes through.
    if (locs.length === 1 || (line.oncePerEpisode && !line.deliveredAcrossLevels)) {
      rows.push(row(line, locs[0], unitsFor(line, form), { inSequence: true, split: false }))
      continue
    }
    const share = splitUnits(line, locs, form)
    for (const loc of locs) {
      rows.push(row(line, loc, share[loc], { inSequence: true, split: true }))
    }
  }
  return rows
}

// ── Outpatient waterfall (rows 20–41) ────────────────────────────────────────

function computeOutpatient(form, ctx, inpatient) {
  const { sequence, coins } = ctx
  const bundled = ctx.network === 'INN' && form.bundledInnIop === 'Yes'
  const lines = outpatientLines(form, ctx)

  const totalAllowed = lines.reduce((sum, l) => sum + l.allowed, 0)
  // OP is a level of this estimate whenever something bills there, sequence or
  // no sequence: psychiatry during an IOP course is charged under OP's terms.
  const activeLocs = OUTPATIENT_LOCS.filter(
    (loc) => sequenceIncludes(sequence, loc) || lines.some((l) => l.active && l.loc === loc)
  )
  const anyActive = activeLocs.length > 0

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

  // J35 / J36 — the deductible is spent level by level in the order care is
  // delivered, and a level the plan waives it for passes the pool along
  // untouched. With one set of rules across the episode this is the same
  // subtraction the block did as a whole.
  const rules = activeLocs
    .map((loc) => levelRule(form, loc))
    .filter((rule) => !rule.admissionFeeCovers)
  let deductiblePool = deductibleAtEntry
  let copayUnits = 0
  let levelCopay = 0
  let copayBeforeMax = 0
  const levels = activeLocs.map((loc) => {
    const rule = levelRule(form, loc)
    // Care an admission fee already covers is not charged again here — and it
    // is covered by where it was delivered, not where it bills, so a level can
    // be charging normally while some of its rows are covered by another
    // level's fee.
    const locLines = lines.filter((l) => l.active && l.loc === loc && !l.coveredByFee)
    const allowed = locLines.reduce((sum, l) => sum + l.allowed, 0)
    const deductible = rule.deductibleApplies ? Math.min(deductiblePool, allowed) : 0
    deductiblePool = clampAtZero(deductiblePool - deductible)
    const coinsurance = clampAtZero(allowed - deductible) * coins

    // The level's deductible spread across its own rows, in the order they are
    // listed. Nothing downstream has to guess what a single line costs.
    let linePool = deductible
    locLines.forEach((l) => {
      l.deductibleApplied = Math.min(linePool, l.allowed)
      linePool = clampAtZero(linePool - l.deductibleApplied)
      l.coinsurance = clampAtZero(l.allowed - l.deductibleApplied) * coins
      l.deductibleWaived = !rule.deductibleApplies
    })

    const { copay: unitCopay, units } = levelUnitCopay(rule, locLines)
    const uncapped = unitCopay + levelManualCopay(rule)
    const copay = ctx.copayCap.charge(rule, uncapped)
    const maxReached = copay < uncapped - 0.005
    // Past the ceiling one more unit of care adds no copay to the deposit, so
    // the client-per-unit column stops quoting one — with a copay that replaces
    // coinsurance, that leaves the extra unit costing the client nothing.
    if (maxReached) {
      locLines.forEach((l) => {
        l.copayMaxReached = true
        l.clientPerUnit = clientUnitCost(l, { ...rule, copayAmount: 0 }, l.rate, coins)
      })
    }
    levelCopay += copay
    copayBeforeMax += uncapped
    copayUnits += units
    return {
      loc,
      rule,
      allowed,
      deductible,
      coinsurance,
      copay,
      copayBeforeMax: uncapped,
      copayMaxReached: maxReached,
      feeCovered: rule.admissionFeeCovers,
      fee: admissionFeeFor(form, loc),
      lines: locLines,
    }
  })

  lines.forEach((l) => {
    if (l.deductibleApplied === undefined) {
      l.deductibleApplied = 0
      l.coinsurance = 0
    }
  })

  const deductibleApplied = levels.reduce((sum, l) => sum + l.deductible, 0)
  const coinsurance = levels.reduce((sum, l) => sum + l.coinsurance, 0)

  // Each level is charged under its own answers, and the block is the sum of
  // them: a copay that replaces coinsurance in OP leaves IOP's coinsurance
  // exactly where it was.
  const shares = anyActive
    ? levels.map((l) =>
        levelShare(l.rule, { deductible: l.deductible, coinsurance: l.coinsurance, copay: l.copay })
      )
    : []
  const planCopayUncapped = anyActive ? planManualCopay(form, rules) : 0
  const planCopay = ctx.copayCap.charge(planRule(form), planCopayUncapped)
  if (planCopay > 0) shares.push(levelShare(planRule(form), { copay: planCopay }))
  const copay = anyActive ? levelCopay + planCopay : 0
  copayBeforeMax += planCopayUncapped

  const capInputs = { oopRemaining: oopAtEntry, deductibleInOopm: ctx.deductibleInOopm }
  const share = applyCostShare(shares, capInputs)

  const withFee = ctx.admissionFeeInOopm
    ? applyCostShare(shares, { ...capInputs, extraInsideCap: admissionFees }).afterCap
    : share.afterCap + admissionFees

  return {
    lines,
    levels,
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
    copayBeforeMax: anyActive ? copayBeforeMax : 0,
    netDeductible: share.netDeductible,
    coinsuranceDue: share.coinsuranceDue,
    beforeCap: share.beforeCap,
    afterCap: share.afterCap,
    revenue: clampAtZero(totalAllowed - share.afterCap),
    deposit: withFee,
  }
}

// A rate warning is about a code, not a row. Two lines can bill the same code —
// the routine and specialty OP groups both bill 90853 — and one unpriced code
// is one problem to fix, so it is named once however many lines carry it. The
// first line's label names it, which is the routine group in that pair.
function byCode(entries) {
  const seen = new Set()
  return entries.filter((e) => {
    if (seen.has(e.code)) return false
    seen.add(e.code)
    return true
  })
}

// ── Public entry point ───────────────────────────────────────────────────────

export function computeEstimate(form) {
  const network = effectiveNetwork(form)
  const sequence = form.treatmentSequence
  const coins = toNumber(form.coinsurancePercent) / 100

  const rateFor = (code) => resolveRate(form, code).rate

  // The plan's terms that are the plan's alone. The three copay questions are
  // not here: they are answered per level of care, through `levelRule`.
  const ctx = {
    sequence,
    network,
    coins,
    rateFor,
    deductibleRemaining: toNumber(form.deductibleRemaining),
    oopmRemaining: toNumber(form.oopmRemaining),
    deductibleInOopm: form.deductibleInOopm === 'Yes',
    admissionFeeInOopm: form.admissionFeeInOopm === 'Yes',
    // One running total for the whole estimate: a ceiling stated on the plan is
    // spent by the inpatient block first, and the outpatient block collects
    // only what is left of it.
    copayCap: copayLedger(),
  }

  const inpatient = computeInpatient(form, ctx)
  const outpatient = computeOutpatient(form, ctx, inpatient)
  const previousBalance = toNumber(form.previousBalance)

  // Every active line whose carrier rate is missing. The workbook leaves those
  // cells amber; here they are named, because a total assembled over a missing
  // rate is understating the cost by a number nobody can see.
  const scheduled = [...inpatient.lines, ...outpatient.lines].filter(
    (l) => l.active && (l.units ?? l.nights) > 0
  )

  // Lines whose number came from observed claims rather than a stated rate.
  // Not an error — but the deposit built on them is an estimate of an estimate,
  // and the result panel says so rather than letting the total look settled.
  const estimatedRates = byCode(
    scheduled
      .map((l) => ({ line: l, resolved: resolveRate(form, l.code) }))
      .filter((x) => x.resolved.source === 'payer-average')
      .map((x) => ({
        key: x.line.key,
        label: x.line.label,
        code: x.line.code,
        group: x.resolved.group,
      }))
  )

  // Lines priced as a percentage of our own charge rather than from anything
  // the plan has stated. Quotable — but the panel says so, the same way it does
  // for a line priced from claims history.
  const chargePercentRates = byCode(
    scheduled
      .map((l) => ({ line: l, resolved: resolveRate(form, l.code) }))
      .filter((x) => x.resolved.source === 'percent-of-charge')
      .map((x) => ({
        key: x.line.key,
        label: x.line.label,
        code: x.line.code,
        percent: x.resolved.percent,
        billed: x.resolved.billed,
      }))
  )

  const missingRates = byCode(
    [...inpatient.lines, ...outpatient.lines]
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
  )

  return {
    network,
    inpatient,
    outpatient,
    previousBalance,
    missingRates,
    estimatedRates,
    chargePercentRates,
    chargePercentPayer: percentOfChargePayer(form.carrier),
    schedule: scheduleInEffect(form),
    // A schedule the location names but the network rules out. The estimator
    // says why rather than leaving the field looking ignored.
    scheduleSuppressed:
      network !== 'INN' ? getSchedule(scheduleForLocation(form.location)) : null,
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
  if (needsNetworkChoice(form.carrier) && !form.networkOverride) {
    blockers.push('Select the network status — this carrier has none on file')
  }
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
  // A level of care that states its own copay is held to the same questions as
  // the plan-wide one: an amount with no basis collects nothing, and a copay
  // whose accumulator treatment was never established drops out of the deposit
  // silently. Neither is something to discover after quoting.
  const levels = billingLevels(form).map(({ loc, label }) => ({
    label,
    loc,
    rule: levelRule(form, loc),
  }))

  // A level charged as a whole is charged the fee and nothing else, so a fee of
  // nothing quotes that level at nothing.
  for (const { label, loc, rule } of levels) {
    if (rule.admissionFeeCovers && admissionFeeFor(form, loc) <= 0) {
      blockers.push(
        `${label}: the admission fee covers the level, but no admission fee is entered for it`
      )
    }
  }
  const levelCopays = levels.filter(
    ({ rule }) => rule.chargeOverridden && rule.copayAmount > 0
  )

  for (const { label, rule } of levelCopays) {
    if (rule.copayBasis === COPAY_BASIS.NA) {
      blockers.push(
        `${label} has a copay amount but its basis is "Not Applicable" — it will not be collected`
      )
    }
  }

  // A ceiling with nothing being collected under it stops nothing. On a level
  // of care that is the level's own entry, so the level is named; on the plan
  // it is only inert while no level of care is collecting a copay at all.
  for (const { label, rule } of levels) {
    if (
      rule.copayMaxOverridden &&
      rule.copayMax > 0 &&
      (rule.copayAmount <= 0 || rule.copayBasis === COPAY_BASIS.NA)
    ) {
      blockers.push(`${label} has a copay maximum but no copay is collected there`)
    }
  }

  // The accumulator questions are asked wherever a copay is actually collected,
  // under the answers that level reads. A level that answers for itself settles
  // them for its own copay; one still on the plan's unanswered terms does not,
  // and the plan's own fields are where that gets fixed. With no level
  // collecting yet, the plan's copay is held to the questions on its own.
  const collecting = levels.filter(
    ({ rule }) => rule.copayAmount > 0 && rule.copayBasis !== COPAY_BASIS.NA
  )
  const asked = collecting.length > 0 ? collecting.map(({ rule }) => rule) : []
  if (asked.length === 0 && toNumber(form.copayAmount) > 0) asked.push(planRule(form))

  if (collecting.length === 0 && toNumber(form.copayMax) > 0) {
    blockers.push('A copay maximum is entered but no copay is being collected under it')
  }

  if (asked.some((rule) => rule.copayToDeductibleAnswer === 'Not Applicable')) {
    blockers.push('State whether the copay applies to the deductible')
  }
  if (asked.some((rule) => rule.copayToOop === 'Not Applicable')) {
    blockers.push('State whether the copay applies to the out-of-pocket maximum')
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

    const stated = lookupRate(carrier, entry.code)
    const ofCharge = stated === null ? percentOfChargeRate(carrier, entry.code) : null
    const rate = stated !== null ? stated : (ofCharge?.rate ?? null)
    scored.push({
      code: entry.code,
      description: entry.description,
      rate,
      // Where the number came from, so the lookup can say "30% of billed"
      // rather than showing a derived figure as an allowed amount.
      source: stated !== null ? 'carrier' : ofCharge ? 'percent-of-charge' : null,
      percent: ofCharge?.percent ?? null,
      billed: ofCharge?.billed ?? null,
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
