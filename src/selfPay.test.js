// Self-pay and scholarship, checked against the workbook's saved state.
//
// The `Self Pay Calc` sheet shipped with one scenario already filled in — a
// Detox > Residential > PHP episode with $31,300 of client payment against
// $81,200 of program cost. Every total it computed is asserted here to the
// cent, so the port cannot drift from the sheet it replaced.

import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { INITIAL_SELF_PAY_STATE, SELF_PAY_LINES, computeSelfPay, selfPayBlockers } from './selfPay.js'

const zeroPayments = Object.fromEntries(SELF_PAY_LINES.map((l) => [l.key, '0']))

// The workbook's own saved inputs.
const WORKBOOK = {
  ...INITIAL_SELF_PAY_STATE,
  treatmentSequence: 'Detox > Residential > PHP',
  units: { ...INITIAL_SELF_PAY_STATE.units, residential: '36' },
  payments: { ...zeroPayments, detox: '6300', residential: '20000', php: '5000' },
  rateOverrides: {},
}

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: got ${a}, want ${b}`)

describe('self-pay vs. the workbook', () => {
  const r = computeSelfPay(WORKBOOK)

  test('totals match the saved sheet', () => {
    near(r.grossCost, 81200, 'gross cost')
    near(r.totalPayment, 31300, 'client payment')
    near(r.totalScholarship, 49900, 'scholarship')
    near(r.scholarshipPercent, 0.6145320197044335, 'scholarship %')
    near(r.scholarshipUnits, 39.18518518518519, 'scholarship units')
    near(r.blendedDailyRate, 504.83870967741933, 'blended daily rate')
    near(r.finalClientResponsibility, 31300, 'final client responsibility')
  })

  test('the detox line matches cell for cell', () => {
    const detox = r.lines.find((l) => l.key === 'detox')
    near(detox.programCost, 12600, 'program cost')
    near(detox.scholarship, 6300, 'scholarship')
    near(detox.scholarshipPercent, 0.5, 'scholarship %')
    near(detox.scholarshipUnits, 3, 'scholarship nights')
    near(detox.averageDailyRate, 1050, 'ADR')
  })

  test('the residential line matches cell for cell', () => {
    const resi = r.lines.find((l) => l.key === 'residential')
    near(resi.programCost, 48600, 'program cost')
    near(resi.scholarship, 28600, 'scholarship')
    near(resi.scholarshipPercent, 0.588477366255144, 'scholarship %')
    near(resi.scholarshipUnits, 21.185185185185187, 'scholarship nights')
    near(resi.averageDailyRate, 555.5555555555555, 'ADR')
  })
})

describe('sequence gating', () => {
  test('only the levels of care in the sequence are costed', () => {
    const r = computeSelfPay(WORKBOOK)
    const costed = r.lines.filter((l) => l.programCost > 0).map((l) => l.key)
    assert.deepEqual(costed.sort(), ['detox', 'php', 'residential'])
    assert.equal(r.lines.find((l) => l.key === 'iop').programCost, 0)
    assert.equal(r.lines.find((l) => l.key === 'opGroups').programCost, 0)
  })

  test('nothing is costed without a sequence', () => {
    const r = computeSelfPay(INITIAL_SELF_PAY_STATE)
    assert.equal(r.grossCost, 0)
    assert.equal(r.active, false)
    assert.deepEqual(selfPayBlockers(INITIAL_SELF_PAY_STATE), ['Select a treatment sequence'])
  })
})

describe('payment allocation', () => {
  const priced = { ...WORKBOOK, payments: { ...zeroPayments } }

  test('an unpaid line is entirely scholarship', () => {
    const r = computeSelfPay(priced)
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.scholarship, detox.programCost)
    assert.equal(detox.scholarshipPercent, 1)
  })

  test('a fully paid line carries no scholarship', () => {
    const r = computeSelfPay({
      ...priced,
      payments: { ...zeroPayments, detox: '12600' },
    })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.scholarship, 0)
    assert.equal(detox.overpaid, false)
  })

  test('overpayment is flagged rather than spilling into other lines', () => {
    const r = computeSelfPay({
      ...priced,
      payments: { ...zeroPayments, detox: '20000' },
    })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.scholarship, 0, 'a scholarship never goes negative')
    assert.ok(detox.overpaid)
    assert.deepEqual(r.overpaidLines, ['Detox'])
    // The surplus does not reduce the residential scholarship.
    const resi = r.lines.find((l) => l.key === 'residential')
    assert.equal(resi.scholarship, resi.programCost)
  })
})

describe('rates', () => {
  test('the OP specialty group uses its own set rate, not the 90853 self-pay rate', () => {
    const r = computeSelfPay({
      ...INITIAL_SELF_PAY_STATE,
      treatmentSequence: 'OP',
      units: { ...INITIAL_SELF_PAY_STATE.units, opSpecialtyGroup: '1', opGroups: '1' },
    })
    const specialty = r.lines.find((l) => l.key === 'opSpecialtyGroup')
    const routine = r.lines.find((l) => l.key === 'opGroups')
    assert.equal(specialty.rate, 100, 'the workbook hard-codes this line at $100')
    assert.equal(routine.rate, 175, 'the routine group keeps the self-pay rate for 90853')
  })

  test('the corrected psychiatric evaluation rate is used, not the workbook value', () => {
    // rates.js is generated and would revert this on the next export, so the
    // correction lives in rateCorrections.js. This test is what notices if it
    // ever stops being applied.
    const r = computeSelfPay({
      ...INITIAL_SELF_PAY_STATE,
      treatmentSequence: 'IOP',
      units: { ...INITIAL_SELF_PAY_STATE.units, psychEval: '1' },
    })
    const psychEval = r.lines.find((l) => l.key === 'psychEval')
    assert.equal(psychEval.rate, 675, 'the workbook still says 650')
    assert.equal(psychEval.programCost, 675)
  })

  test('an override replaces the sheet rate', () => {
    const r = computeSelfPay({ ...WORKBOOK, rateOverrides: { detox: '999' } })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.rate, 999)
    assert.equal(detox.programCost, 999 * 6)
  })
})
