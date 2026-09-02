// The deposit estimator, checked against the workbook it was ported from.
//
// `__fixtures__/workbook-cases.json` holds 60 scenarios captured from a literal
// transcription of the workbook's own cell formulas, chosen to cover every
// branch of the copay, accumulator and admission-fee logic. Each one carries
// all 21 intermediate cells, not just the total, so a regression is located
// rather than merely detected.
//
// The fixtures deliberately use only carriers whose rate table prices every
// code: the workbook treats a blank rate as zero and the app falls back to
// observed claims, so mixing them in would test rate sourcing rather than the
// waterfall arithmetic these cases exist to pin down.
//
// Eleven cases were captured against a carrier the 2026 revision of the
// workbook dropped, and carry `capturedAs` naming it. Each now runs against a
// surviving carrier whose rates are identical on every code the case prices,
// so the captured cell values are exactly as valid as when they were taken —
// the carrier in a case is a rate source, not part of the arithmetic under
// test. Three of them price the residential night, which the site schedule
// carries at 1,045 rather than the 1,052 they were captured at, so those pin
// it back with `rates` rather than quietly changing what the case measures.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test, describe } from 'node:test'

import {
  CARRIER_OPTIONS,
  COPAY_BASIS,
  INITIAL_ESTIMATE_STATE,
  SERVICE_LINES,
  computeEstimate,
  defaultUnitsFor,
  effectiveNetwork,
  estimateBlockers,
  lookupRate,
  scheduleInEffect,
  resolveRate,
  searchCodes,
  sequenceIncludes,
} from './estimate.js'
import { RATE_CORRECTIONS } from './data/rateCorrections.js'
import { chargeMasterRate, percentOfChargeRate } from './data/percentOfCharge.js'
import { OTHER_CARRIER } from './data/reimbursement.js'

const CASES = JSON.parse(
  readFileSync(new URL('./__fixtures__/workbook-cases.json', import.meta.url))
)

const near = (a, b) => Math.abs(a - b) < 0.005

function formFor(f) {
  return {
    ...INITIAL_ESTIMATE_STATE,
    carrier: f.carrier,
    treatmentSequence: f.seq,
    coinsurancePercent: String(f.coins * 100),
    copayAmount: String(f.copay),
    copayBasis: f.basis,
    copayTreatment: f.treat,
    copayAppliesToDeductible: f.copayDed,
    copayAppliesToOop: f.copayOop,
    deductibleRemaining: String(f.ded),
    oopmRemaining: String(f.oop),
    deductibleInOopm: f.dedInOopm,
    admissionFeeInOopm: f.feeInOopm,
    bundledInnIop: f.bundled,
    previousBalance: String(f.prevBal),
    admissionFees: Object.fromEntries(Object.entries(f.fees).map(([k, v]) => [k, String(v)])),
    nights: { detox: String(f.nights.detox), residential: String(f.nights.resi) },
    // Every line is pinned, not just the ones a case names: the workbook these
    // cases were transcribed from has no OP specialty group row, so that line
    // is held at zero rather than left to pick up the app's own default.
    units: {
      ...Object.fromEntries(SERVICE_LINES.map((l) => [l.key, '0'])),
      ...Object.fromEntries(Object.entries(f.units).map(([k, v]) => [k, String(v)])),
    },
    rateOverrides: Object.fromEntries(
      Object.entries(f.rates || {}).map(([code, rate]) => [code, String(rate)])
    ),
  }
}

describe('deposit estimator vs. the workbook', () => {
  for (const [i, { input, expected }] of CASES.entries()) {
    test(`case ${i}: ${input.carrier} — ${input.seq}`, () => {
      const r = computeEstimate(formFor(input))
      const cells = {
        H8: r.inpatient.totalAllowed,
        H9: r.inpatient.admissionFees,
        H10: r.inpatient.deductibleApplied,
        H11: r.inpatient.coinsurance,
        H12: r.inpatient.copay,
        H13: r.inpatient.beforeCap,
        H14: r.inpatient.afterCap,
        H15: r.inpatient.revenue,
        H16: r.inpatient.deposit,
        J31: r.outpatient.totalAllowed,
        J32: r.outpatient.deductibleAtEntry,
        J33: r.outpatient.oopAtEntry,
        J34: r.outpatient.admissionFees,
        J35: r.outpatient.deductibleApplied,
        J36: r.outpatient.coinsurance,
        J37: r.outpatient.copay,
        J38: r.outpatient.beforeCap,
        J39: r.outpatient.afterCap,
        J40: r.outpatient.revenue,
        J41: r.outpatient.deposit,
        I1: r.grandTotal,
      }
      for (const [cell, got] of Object.entries(cells)) {
        assert.ok(
          near(got, expected[cell]),
          `${cell}: got ${got}, workbook says ${expected[cell]}`
        )
      }
    })
  }
})

describe('sequence gating', () => {
  test('a level of care is priced only when the sequence names it', () => {
    assert.equal(sequenceIncludes('Detox > Residential > IOP', 'IOP'), true)
    assert.equal(sequenceIncludes('Detox > Residential > IOP', 'OP'), false)
    // "OP" must not match inside "IOP".
    assert.equal(sequenceIncludes('IOP', 'OP'), false)
    assert.equal(sequenceIncludes('OPWM > OP', 'OP'), true)
  })

  test('nothing is costed without a sequence', () => {
    const r = computeEstimate({ ...INITIAL_ESTIMATE_STATE, carrier: 'BCBS - Anthem NY' })
    assert.equal(r.totalAllowed, 0)
    assert.equal(r.grandTotal, 0)
  })
})

describe('unit defaults', () => {
  const units = (seq) =>
    Object.fromEntries(
      SERVICE_LINES.map((l) => [l.key, defaultUnitsFor(l, seq)]).filter(([, n]) => n > 0)
    )

  test('an IOP course', () => {
    assert.deepEqual(units('IOP'), {
      assessment: 1,
      iop: 30,
      individual: 9,
      psychEval: 1,
      psychFollowUp: 2,
    })
  })

  test('an OP course', () => {
    assert.deepEqual(units('OP'), {
      assessment: 1,
      opGroups: 10,
      opSpecialtyGroup: 10,
      individual: 10,
      psychEval: 1,
      psychFollowUp: 2,
      family: 3,
    })
  })

  // The two 90853 rows resolve to one rate, so where the twenty OP groups sit
  // is a scheduling fact, not a pricing one. Splitting the workbook's single
  // row of 20 into 10 routine and 10 specialty has to leave the estimate where
  // it was — if it ever moves, the two rows have stopped sharing a rate.
  test('splitting the OP groups across the two 90853 rows does not move the estimate', () => {
    const base = {
      ...INITIAL_ESTIMATE_STATE,
      carrier: 'United Healthcare Shared Services (Optum)',
      treatmentSequence: 'OP',
      coinsurancePercent: '20',
      deductibleRemaining: '1000',
      oopmRemaining: '4000',
    }
    const split = computeEstimate(base)
    const onOneRow = computeEstimate({
      ...base,
      units: { ...base.units, opGroups: '20', opSpecialtyGroup: '0' },
    })
    assert.ok(split.outpatient.totalAllowed > 0, 'the OP block is priced at all')
    assert.ok(near(split.outpatient.totalAllowed, onOneRow.outpatient.totalAllowed))
    assert.ok(near(split.grandTotal, onOneRow.grandTotal))
  })

  test('a step-down accumulates therapy but not the psychiatric course', () => {
    const both = units('IOP > OP')
    assert.equal(both.individual, 19, 'individual therapy is 9 + 10')
    assert.equal(both.assessment, 1, 'one intake for the admission, not two')
    assert.equal(both.psychEval, 1, 'one psychiatric evaluation, not two')
    assert.equal(both.psychFollowUp, 2, 'one course of follow-ups, not two')
  })
})

describe('rate resolution', () => {
  const form = (over) => ({
    ...INITIAL_ESTIMATE_STATE,
    carrier: 'United Healthcare Shared Services (Optum)',
    ...over,
  })

  test('a contracted schedule outranks the carrier table in network', () => {
    // The carrier is INN, so the Connecticut contract applies.
    assert.equal(resolveRate(form({ location: 'canaan' }), 'H0015').source, 'contract')
    assert.equal(resolveRate(form({ location: 'canaan' }), 'H0015').rate, 328)
  })

  test('a contracted schedule never prices an out-of-network plan', () => {
    // There is no agreement with a payer we are out of network with, whatever
    // site the client walks into — the allowed amount is the carrier's own.
    const oon = form({ carrier: 'BCBS - Anthem NY', location: 'canaan' })
    assert.equal(effectiveNetwork(oon), 'OON')
    assert.equal(scheduleInEffect(oon), null)
    const r = resolveRate(oon, 'H0015')
    assert.equal(r.source, 'carrier')
    assert.equal(r.rate, lookupRate('BCBS - Anthem NY', 'H0015'))
    assert.notEqual(r.rate, 328, 'the Connecticut contracted rate must not leak into an OON quote')
  })

  test('an unlisted carrier follows the network that was stated for it', () => {
    const inn = form({ carrier: 'Other — not listed', networkOverride: 'INN', location: 'canaan' })
    assert.equal(resolveRate(inn, 'H0015').source, 'contract')
    const oon = form({ carrier: 'Other — not listed', networkOverride: 'OON', location: 'canaan' })
    assert.equal(resolveRate(oon, 'H0015').source, 'payer-average')
  })

  test('the estimate reports a schedule the network ruled out', () => {
    const r = computeEstimate(
      form({
        carrier: 'BCBS - Anthem NY',
        location: 'canaan',
        treatmentSequence: 'IOP',
        coinsurancePercent: '20',
        deductibleRemaining: '0',
        oopmRemaining: '99999',
      })
    )
    assert.equal(r.schedule, null, 'nothing is contracted for this plan')
    assert.equal(r.scheduleSuppressed?.id, 'ct', 'but the location does have one, and the UI says so')
  })

  test('an override outranks everything', () => {
    const f = form({ location: 'canaan', rateOverrides: { H0015: '999' } })
    assert.deepEqual(resolveRate(f, 'H0015'), { rate: 999, source: 'override' })
  })

  test('a location with no schedule falls back to the carrier table', () => {
    const f = form({ location: 'mass-virtual' })
    assert.equal(resolveRate(f, 'H0015').source, 'carrier')
  })

  test('a listed carrier never inherits the Misc claims bucket', () => {
    // Misc is what an unlisted plan reports under; a named plan with no rate of
    // its own must come back missing rather than borrowing someone else's.
    const r = resolveRate(form({ carrier: 'Priority Health' }), 'H0010')
    assert.equal(r.rate, null)
    assert.equal(r.source, 'missing')
  })

  test('the unlisted-carrier option does draw on Misc', () => {
    const r = resolveRate(form({ carrier: 'Other — not listed' }), 'H0010')
    assert.ok(r.rate > 0)
    assert.equal(r.source, 'payer-average')
    assert.equal(r.group, 'Misc')
  })

  test('a missing rate is reported rather than silently costed at zero', () => {
    const r = computeEstimate(
      form({ carrier: 'Priority Health', treatmentSequence: 'Detox', deductibleRemaining: '0', oopmRemaining: '99999' })
    )
    assert.equal(r.inpatient.totalAllowed, 0)
    assert.ok(r.missingRates.some((m) => m.code === 'H0010'))
  })
})

describe('rate corrections', () => {
  test('a correction is laid over the generated table', () => {
    assert.equal(lookupRate('Self Pay', '90792'), 675)
  })

  test('corrections touch nothing else', () => {
    assert.equal(lookupRate('Self Pay', '90791'), 450)
    assert.equal(lookupRate('BCBS - Anthem NY', '90792'), 340)
  })

  test('every correction names what it replaced and why', () => {
    for (const c of RATE_CORRECTIONS) {
      assert.ok(c.carrier && c.code, 'a correction needs a carrier and a code')
      assert.equal(typeof c.rate, 'number')
      assert.notEqual(c.rate, c.was, 'a correction that changes nothing is dead weight')
      assert.ok(c.reason, `${c.carrier}/${c.code} needs a reason`)
      assert.ok(c.noted, `${c.carrier}/${c.code} needs a date`)
    }
  })
})

describe('submit blockers', () => {
  const ready = {
    ...INITIAL_ESTIMATE_STATE,
    carrier: 'BCBS - Anthem NY',
    treatmentSequence: 'IOP',
    coinsurancePercent: '20',
    deductibleRemaining: '0',
    oopmRemaining: '5000',
  }

  test('a complete estimate has none', () => {
    assert.deepEqual(estimateBlockers(ready), [])
  })

  test('a copay with no accumulator answers is blocked', () => {
    // Left unanswered the workbook drops the copay out of the capped
    // responsibility entirely, so it must never reach a quote.
    const blockers = estimateBlockers({
      ...ready,
      copayAmount: '50',
      copayBasis: COPAY_BASIS.PER_UNIT,
    })
    assert.ok(blockers.some((b) => b.includes('deductible')))
    assert.ok(blockers.some((b) => b.includes('out-of-pocket')))
  })

  test('a carrier with no network on file must have one stated', () => {
    const blockers = estimateBlockers({ ...ready, carrier: 'Other — not listed' })
    assert.ok(blockers.some((b) => b.includes('network status')))
    assert.deepEqual(
      estimateBlockers({ ...ready, carrier: 'Other — not listed', networkOverride: 'OON' }),
      []
    )
  })
})

// The carrier list is what everyone touches first, and the workbook's own order
// stopped being alphabetical the day somebody appended a carrier to the bottom
// of the sheet rather than inserting it.
describe('the carrier dropdown', () => {
  test('it reads in alphabetical order', () => {
    const carriers = CARRIER_OPTIONS.filter((o) => o.value !== OTHER_CARRIER).map((o) => o.value)
    const sorted = [...carriers].sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
    )
    assert.deepEqual(carriers, sorted)
  })

  test('"not listed" stays at the end, where a fallback belongs', () => {
    assert.equal(CARRIER_OPTIONS.at(-1).value, OTHER_CARRIER)
    assert.equal(CARRIER_OPTIONS.filter((o) => o.value === OTHER_CARRIER).length, 1)
  })

  test('every option is selectable exactly once', () => {
    const values = CARRIER_OPTIONS.map((o) => o.value)
    assert.equal(new Set(values).size, values.length)
  })
})

// A plan with no allowed amounts of its own, whose claims come back at a known
// percentage of what we billed. The number is real enough to quote and derived
// enough that it must never look stated.
describe('a payer priced as a percentage of our charge', () => {
  const form = (over) => ({
    ...INITIAL_ESTIMATE_STATE,
    carrier: 'Diversified Group -',
    coinsurancePercent: '20',
    deductibleRemaining: '0',
    oopmRemaining: '50000',
    ...over,
  })

  test('the rate is the percentage of what we bill, rounded up to the next $5', () => {
    // 5,450 billed for a detox night, processing at 30%.
    assert.equal(chargeMasterRate('H0010'), 5450)
    assert.deepEqual(percentOfChargeRate('Diversified Group -', 'H0010'), {
      rate: 1635,
      percent: 0.3,
      billed: 5450,
    })
    // 875 × 0.3 is 262.50, and an out-of-network rate rounds up to the next $5.
    assert.equal(percentOfChargeRate('Diversified Group -', '90791').rate, 265)
  })

  test('it says where the number came from', () => {
    const r = resolveRate(form(), 'H0010')
    assert.equal(r.source, 'percent-of-charge')
    assert.equal(r.rate, 1635)
    assert.equal(r.percent, 0.3)
    assert.equal(r.billed, 5450)
  })

  test('a stated allowed amount outranks it', () => {
    // Every other carrier prices from its own table; nothing here leaks across.
    const other = resolveRate(form({ carrier: 'Aetna -' }), 'H0010')
    assert.equal(other.source, 'carrier')
    assert.equal(other.rate, lookupRate('Aetna -', 'H0010'))
    assert.equal(percentOfChargeRate('Aetna -', 'H0010'), null)
  })

  test('a code we do not have a charge for stays unpriced', () => {
    // Inventing the base would make the whole line invented.
    assert.equal(chargeMasterRate('80305'), null)
    assert.equal(percentOfChargeRate('Diversified Group -', '80305'), null)
    assert.equal(resolveRate(form(), '80305').source, 'missing')
  })

  test('the estimate names the lines it derived rather than burying them', () => {
    const r = computeEstimate(form({ treatmentSequence: 'Detox' }))
    assert.ok(r.inpatient.totalAllowed > 0, 'the detox nights are priced')
    assert.deepEqual(
      r.chargePercentRates.map((x) => x.code),
      ['H0010']
    )
    assert.equal(r.chargePercentRates[0].percent, 0.3)
    assert.equal(r.chargePercentRates[0].billed, 5450)
    assert.deepEqual(r.missingRates, [], 'a derived rate is a rate, not a gap')
    assert.equal(r.chargePercentPayer.percent, 0.3)
  })

  test('the rate lookup shows it as derived, not as an allowed amount', () => {
    const row = searchCodes('H0010', 'Diversified Group -').find((r) => r.code === 'H0010')
    assert.equal(row.rate, 1635)
    assert.equal(row.source, 'percent-of-charge')
    assert.equal(row.percent, 0.3)
    assert.equal(row.billed, 5450)

    const stated = searchCodes('H0010', 'Aetna -').find((r) => r.code === 'H0010')
    assert.equal(stated.source, 'carrier')
    assert.equal(stated.percent, null)
  })

  test('an override still wins, because someone read the number off a contract', () => {
    const r = resolveRate(form({ rateOverrides: { H0010: '1800' } }), 'H0010')
    assert.equal(r.source, 'override')
    assert.equal(r.rate, 1800)
  })
})
