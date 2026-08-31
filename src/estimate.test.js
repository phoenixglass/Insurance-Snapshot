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

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test, describe } from 'node:test'

import {
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
  sequenceIncludes,
} from './estimate.js'
import { RATE_CORRECTIONS } from './data/rateCorrections.js'

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
    units: Object.fromEntries(Object.entries(f.units).map(([k, v]) => [k, String(v)])),
    rateOverrides: {},
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
      opGroups: 20,
      individual: 10,
      psychEval: 1,
      psychFollowUp: 2,
      family: 3,
    })
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
  const form = (over) => ({ ...INITIAL_ESTIMATE_STATE, carrier: 'UHC', ...over })

  test('a contracted schedule outranks the carrier table in network', () => {
    // UHC is INN, so the Connecticut contract applies.
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
