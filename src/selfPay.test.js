// Self-pay and scholarship, checked against the workbook's saved state.
//
// The `Self Pay Calc` sheet shipped with one scenario already filled in — a
// Detox > Residential > PHP episode with $81,200 of program cost and $49,900
// of it scholarshipped. The sheet recorded that as the client's payment; the
// app records it as the award, which is how it is actually granted. Same
// arithmetic, same totals to the cent, stated the way it is decided.

import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  INITIAL_SELF_PAY_STATE,
  SELF_PAY_LINES,
  applyScholarshipPercent,
  computeSelfPay,
  convertScholarshipMode,
  selfPayBlockers,
} from './selfPay.js'

const noScholarship = Object.fromEntries(SELF_PAY_LINES.map((l) => [l.key, '0']))

// The workbook's own saved scenario, entered as the dollar award it was.
const WORKBOOK = {
  ...INITIAL_SELF_PAY_STATE,
  treatmentSequence: 'Detox > Residential > PHP',
  scholarshipMode: 'amount',
  units: { ...INITIAL_SELF_PAY_STATE.units, residential: '36' },
  scholarship: { ...noScholarship, detox: '6300', residential: '28600', php: '15000' },
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
    near(r.finalClientResponsibility, 31300, 'final client responsibility')
  })

  test('the detox line matches cell for cell', () => {
    const detox = r.lines.find((l) => l.key === 'detox')
    near(detox.programCost, 12600, 'program cost')
    near(detox.scholarship, 6300, 'scholarship')
    near(detox.payment, 6300, 'client payment')
    near(detox.scholarshipPercent, 0.5, 'scholarship %')
    near(detox.coveredUnits, 3, 'scholarship nights')
    near(detox.paidUnits, 3, 'nights the client pays for')
  })

  test('the residential line matches cell for cell', () => {
    const resi = r.lines.find((l) => l.key === 'residential')
    near(resi.programCost, 48600, 'program cost')
    near(resi.scholarship, 28600, 'scholarship')
    near(resi.payment, 20000, 'client payment')
    near(resi.scholarshipPercent, 0.588477366255144, 'scholarship %')
    near(resi.coveredUnits, 21.185185185185187, 'scholarship nights')
  })

  test('every unit of care is on one side of the split or the other', () => {
    near(r.paidUnits + r.scholarshipUnits, r.costedUnits, 'units')
    near(r.totalPayment + r.totalScholarship, r.grossCost, 'dollars')
  })
})

describe('a scholarship covers units, it does not cut the rate', () => {
  const iopEpisode = {
    ...INITIAL_SELF_PAY_STATE,
    treatmentSequence: 'IOP',
    scholarship: { ...noScholarship, iop: '15' },
  }

  test('half of a 30-unit IOP course is 15 units at the full rate', () => {
    const iop = computeSelfPay(iopEpisode).lines.find((l) => l.key === 'iop')
    assert.equal(iop.rate, 295, 'the sheet rate is untouched')
    assert.equal(iop.programCost, 8850)
    assert.equal(iop.coveredUnits, 15)
    assert.equal(iop.paidUnits, 15)
    assert.equal(iop.scholarship, 4425)
    assert.equal(iop.payment, 4425)
    // The point of the whole exercise: the client is billed 15 × $295, not
    // 30 × $147.50.
    assert.equal(iop.payment / iop.paidUnits, 295)
  })

  test('the same award entered in dollars lands on the same units', () => {
    const iop = computeSelfPay({
      ...iopEpisode,
      scholarshipMode: 'amount',
      scholarship: { ...noScholarship, iop: '4425' },
    }).lines.find((l) => l.key === 'iop')
    assert.equal(iop.coveredUnits, 15)
    assert.equal(iop.payment, 4425)
  })

  test('a dollar award that does not land on a whole unit is named', () => {
    const r = computeSelfPay({
      ...iopEpisode,
      scholarshipMode: 'amount',
      scholarship: { ...noScholarship, iop: '4000' },
    })
    const iop = r.lines.find((l) => l.key === 'iop')
    assert.equal(iop.wholeUnits, false)
    assert.deepEqual(r.partialUnitLines, ['IOP Services'])
  })
})

describe('switching how the award is expressed', () => {
  const iopEpisode = {
    ...INITIAL_SELF_PAY_STATE,
    treatmentSequence: 'IOP',
    scholarship: { ...noScholarship, iop: '15' },
  }

  test('units become the dollars those units cost', () => {
    const converted = convertScholarshipMode(iopEpisode, 'amount')
    assert.equal(converted.scholarshipMode, 'amount')
    assert.equal(converted.scholarship.iop, '4425')
    assert.equal(computeSelfPay(converted).totalScholarship, 4425)
  })

  test('dollars become the units of care they buy', () => {
    const converted = convertScholarshipMode(
      { ...iopEpisode, scholarshipMode: 'amount', scholarship: { ...noScholarship, iop: '4425' } },
      'units',
    )
    assert.equal(converted.scholarship.iop, '15')
    assert.equal(computeSelfPay(converted).totalScholarship, 4425)
  })

  test('an award that lands mid-session survives the round trip to the cent', () => {
    const agreed = {
      ...iopEpisode,
      scholarshipMode: 'amount',
      scholarship: { ...noScholarship, iop: '4000' },
    }
    const inUnits = convertScholarshipMode(agreed, 'units')
    assert.equal(computeSelfPay(inUnits).totalScholarship, 4000, 'the award is unchanged')
    assert.deepEqual(computeSelfPay(inUnits).partialUnitLines, ['IOP Services'], 'and says it is a fraction')
    assert.equal(convertScholarshipMode(inUnits, 'amount').scholarship.iop, '4000')
  })

  test('switching to the mode already in use changes nothing', () => {
    assert.equal(convertScholarshipMode(iopEpisode, 'units'), iopEpisode)
  })

  test('an empty entry stays empty, and one with no rate to convert through is cleared', () => {
    const converted = convertScholarshipMode(
      {
        ...INITIAL_SELF_PAY_STATE,
        treatmentSequence: 'IOP',
        scholarship: { ...INITIAL_SELF_PAY_STATE.scholarship, iop: '15', mats: '2' },
        rateOverrides: { mats: '0' },
      },
      'amount',
    )
    assert.equal(converted.scholarship.opGroups, '')
    assert.equal(converted.scholarship.mats, '', 'no rate, nothing to restate')
    assert.equal(converted.scholarship.iop, '4425')
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

describe('award allocation', () => {
  test('an unscholarshipped line is paid in full by the client', () => {
    const r = computeSelfPay({ ...WORKBOOK, scholarship: { ...noScholarship } })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.scholarship, 0)
    assert.equal(detox.payment, detox.programCost)
    assert.equal(detox.paidUnits, 6)
  })

  test('a fully covered line leaves the client nothing to pay', () => {
    const r = computeSelfPay({
      ...WORKBOOK,
      scholarship: { ...noScholarship, detox: '12600' },
    })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.payment, 0)
    assert.equal(detox.coveredUnits, 6)
    assert.equal(detox.overAllocated, false)
  })

  test('an award larger than the line is flagged rather than spilling over', () => {
    const r = computeSelfPay({
      ...WORKBOOK,
      scholarship: { ...noScholarship, detox: '20000' },
    })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.scholarship, 12600, 'a scholarship never exceeds the line')
    assert.equal(detox.payment, 0, 'and never turns into a refund')
    assert.ok(detox.overAllocated)
    assert.deepEqual(r.overAllocatedLines, ['Detox'])
    // The surplus does not cover residential nights.
    const resi = r.lines.find((l) => l.key === 'residential')
    assert.equal(resi.scholarship, 0)
  })

  test('more units than the line has is capped at the line', () => {
    const r = computeSelfPay({
      ...WORKBOOK,
      scholarshipMode: 'units',
      scholarship: { ...noScholarship, detox: '9' },
    })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.coveredUnits, 6)
    assert.equal(detox.paidUnits, 0)
    assert.ok(detox.overAllocated)
  })
})

describe('filling from a percentage', () => {
  const iopEpisode = { ...INITIAL_SELF_PAY_STATE, treatmentSequence: 'IOP' }

  test('50% splits the IOP course down the middle in whole sessions', () => {
    const filled = applyScholarshipPercent(iopEpisode, '50')
    assert.equal(filled.scholarship.iop, '15')
    const iop = computeSelfPay(filled).lines.find((l) => l.key === 'iop')
    assert.equal(iop.scholarship, 4425)
    assert.equal(iop.payment, 4425)
  })

  test('the fill lands near the percentage asked for, not above it', () => {
    // Rounding every line up on its own would turn a 50% award on an IOP
    // episode into 55% by covering each one-visit line outright.
    const r = computeSelfPay(applyScholarshipPercent(iopEpisode, '50'))
    assert.ok(
      Math.abs(r.scholarshipPercent - 0.5) < 0.02,
      `50% award came out at ${(r.scholarshipPercent * 100).toFixed(1)}%`,
    )
    // And it is still whole sessions and nights on every line.
    assert.deepEqual(r.partialUnitLines, [])
  })

  test('lines outside the sequence are left uncovered', () => {
    const filled = applyScholarshipPercent(iopEpisode, '50')
    assert.equal(filled.scholarship.opGroups, '')
    assert.equal(computeSelfPay(filled).lines.find((l) => l.key === 'opGroups').scholarship, 0)
  })

  test('in dollar mode the percentage is taken off each line exactly', () => {
    const filled = applyScholarshipPercent({ ...iopEpisode, scholarshipMode: 'amount' }, '40')
    assert.equal(filled.scholarship.iop, '3540')
    const iop = computeSelfPay(filled).lines.find((l) => l.key === 'iop')
    assert.equal(iop.scholarship, 3540)
    assert.equal(iop.coveredUnits, 12)
  })

  test('a percentage over 100 covers the program, not more', () => {
    const filled = applyScholarshipPercent(iopEpisode, '150')
    const r = computeSelfPay(filled)
    assert.equal(r.totalPayment, 0)
    assert.equal(r.totalScholarship, r.grossCost)
  })

  test('an empty percentage leaves the entries alone', () => {
    const filled = applyScholarshipPercent(
      { ...iopEpisode, scholarship: { ...noScholarship, iop: '15' } },
      '',
    )
    assert.equal(filled.scholarship.iop, '15')
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

  test('an override replaces the sheet rate on both sides of the split', () => {
    const r = computeSelfPay({
      ...WORKBOOK,
      scholarship: { ...noScholarship, detox: '3' },
      scholarshipMode: 'units',
      rateOverrides: { detox: '999' },
    })
    const detox = r.lines.find((l) => l.key === 'detox')
    assert.equal(detox.rate, 999)
    assert.equal(detox.programCost, 999 * 6)
    assert.equal(detox.scholarship, 999 * 3)
    assert.equal(detox.payment, 999 * 3)
  })
})
