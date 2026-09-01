// Levels of care that do not share the plan's terms.
//
// A plan can waive the deductible for IOP and charge it in OP, or attach a
// different copay to each level, inside one `IOP > OP` sequence. The workbook
// cannot express that — its plan terms are single cells applied to the whole
// episode — so these tests hold two things at once: that an estimate with no
// overrides is still exactly the workbook's estimate, and that an override
// moves only what it should.

import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  COPAY_BASIS,
  INITIAL_ESTIMATE_STATE,
  computeEstimate,
  hasLevelOverrides,
  levelRule,
} from './estimate.js'

const BASE = {
  ...INITIAL_ESTIMATE_STATE,
  carrier: 'Aetna -',
  treatmentSequence: 'IOP > OP',
  deductibleRemaining: '5000',
  oopmRemaining: '25000',
  deductibleInOopm: 'Yes',
  coinsurancePercent: '20',
}

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: got ${a}, want ${b}`)
const lineFor = (r, key) => r.outpatient.lines.find((l) => l.key === key)
const levelFor = (r, loc) => r.outpatient.levels.find((l) => l.loc === loc)

describe('nothing overridden is the plan-wide estimate', () => {
  test('every level reads the plan terms', () => {
    const rule = levelRule(BASE, 'IOP')
    assert.equal(rule.deductibleApplies, true)
    assert.equal(rule.copayAmount, 0)
    assert.equal(rule.copayBasis, COPAY_BASIS.NA)
    assert.equal(hasLevelOverrides(BASE), false)
  })

  test('the whole deductible is spent across the episode in order', () => {
    const r = computeEstimate(BASE)
    near(r.outpatient.deductibleApplied, 5000, 'deductible')
    near(
      r.outpatient.coinsurance,
      (r.outpatient.totalAllowed - 5000) * 0.2,
      'coinsurance on the rest'
    )
  })
})

describe('a level that waives the deductible', () => {
  // The case this exists for: in IOP the deductible does not apply, in OP it
  // does, quoted as one IOP > OP sequence.
  const waived = { ...BASE, levelRules: { IOP: { deductibleApplies: 'No' } } }

  test('it takes none of the deductible and passes the whole pool on', () => {
    const r = computeEstimate(waived)
    const iop = levelFor(r, 'IOP')
    const op = levelFor(r, 'OP')
    near(iop.deductible, 0, 'IOP takes no deductible')
    near(op.deductible, Math.min(5000, op.allowed), 'OP takes all of it')
    near(r.outpatient.deductibleApplied, op.deductible, 'the block total is OP alone')
  })

  test('the waived level is charged coinsurance on its whole allowed cost', () => {
    const r = computeEstimate(waived)
    const iop = levelFor(r, 'IOP')
    near(iop.coinsurance, iop.allowed * 0.2, 'coinsurance on everything')
  })

  test('the client owes less where the later level cannot absorb the deductible', () => {
    // A deductible bigger than the OP course: with IOP waived, part of it is
    // never spent, and the client pays coinsurance on that care instead.
    const big = { deductibleRemaining: '20000', oopmRemaining: '50000' }
    const uniform = computeEstimate({ ...BASE, ...big })
    const mixed = computeEstimate({ ...waived, ...big })
    assert.ok(
      mixed.grandTotal < uniform.grandTotal,
      `waiving a deductible has to lower the deposit: ${mixed.grandTotal} vs ${uniform.grandTotal}`
    )
    // The difference is exactly the deductible that turned into coinsurance.
    const moved = uniform.outpatient.deductibleApplied - mixed.outpatient.deductibleApplied
    assert.ok(moved > 0, 'some deductible went unspent')
    near(uniform.grandTotal - mixed.grandTotal, moved * (1 - 0.2), 'the difference')
  })

  test('the level rule is named on the lines it applied to', () => {
    const r = computeEstimate(waived)
    assert.ok(lineFor(r, 'iop').deductibleWaived, 'the IOP row says the deductible was waived')
    assert.equal(lineFor(r, 'opGroups').deductibleWaived, false, 'the OP row does not')
    assert.equal(hasLevelOverrides(waived), true)
  })
})

describe('a copay that differs by level', () => {
  const perLevel = {
    ...BASE,
    copayAmount: '0',
    copayBasis: COPAY_BASIS.NA,
    copayAppliesToOop: 'Yes',
    levelRules: {
      IOP: { copayAmount: '50', copayBasis: COPAY_BASIS.PER_UNIT },
      OP: { copayAmount: '25', copayBasis: COPAY_BASIS.PER_UNIT },
    },
  }

  test('each level collects its own copay on its own units', () => {
    const r = computeEstimate(perLevel)
    const iopUnits = levelFor(r, 'IOP').lines.reduce((sum, l) => sum + l.units, 0)
    const opUnits = levelFor(r, 'OP').lines.reduce((sum, l) => sum + l.units, 0)
    near(levelFor(r, 'IOP').copay, iopUnits * 50, 'IOP copay')
    near(levelFor(r, 'OP').copay, opUnits * 25, 'OP copay')
    near(r.outpatient.copay, iopUnits * 50 + opUnits * 25, 'block copay')
  })

  test('a level left alone stays on the plan copay', () => {
    const r = computeEstimate({
      ...perLevel,
      copayAmount: '10',
      copayBasis: COPAY_BASIS.PER_UNIT,
      levelRules: { IOP: { copayAmount: '50' } },
    })
    const opUnits = levelFor(r, 'OP').lines.reduce((sum, l) => sum + l.units, 0)
    near(levelFor(r, 'OP').copay, opUnits * 10, 'OP is on the plan amount')
  })

  test('a manual total stays one charge for the block while levels share it', () => {
    const manual = {
      ...BASE,
      copayAmount: '500',
      copayBasis: COPAY_BASIS.MANUAL,
      copayAppliesToOop: 'Yes',
    }
    near(computeEstimate(manual).outpatient.copay, 500, 'charged once, not once per level')
  })

  test('a level with its own manual total is charged beside the plan-wide one', () => {
    const manual = {
      ...BASE,
      copayAmount: '500',
      copayBasis: COPAY_BASIS.MANUAL,
      copayAppliesToOop: 'Yes',
      levelRules: { IOP: { copayAmount: '300' } },
    }
    // IOP charges its own 300; OP is still on the plan's 500.
    near(computeEstimate(manual).outpatient.copay, 800, 'block copay')
  })
})

describe('services shared between two levels', () => {
  test('they split into a row per level when both levels are in the sequence', () => {
    const r = computeEstimate(BASE)
    const iop = lineFor(r, 'individual:IOP')
    const op = lineFor(r, 'individual:OP')
    assert.ok(iop && op, 'individual therapy is priced in each level')
    assert.equal(iop.label, 'Individual Therapy (IOP)')
    near(iop.units, 9, 'the IOP course')
    near(op.units, 10, 'the OP course')
  })

  test('one level in the sequence leaves the service as a single row', () => {
    const r = computeEstimate({ ...BASE, treatmentSequence: 'IOP' })
    assert.ok(lineFor(r, 'individual'), 'no level suffix')
    assert.equal(lineFor(r, 'individual').units, 9)
  })

  test('a count typed against the whole service is divided by the default ratio', () => {
    const r = computeEstimate({ ...BASE, units: { individual: '19' } })
    near(lineFor(r, 'individual:IOP').units, 9, 'IOP share')
    near(lineFor(r, 'individual:OP').units, 10, 'OP share')
  })

  test('and an edited total keeps its total', () => {
    const r = computeEstimate({ ...BASE, units: { individual: '8' } })
    const total =
      lineFor(r, 'individual:IOP').units + lineFor(r, 'individual:OP').units
    near(total, 8, 'the number the user typed is the number priced')
  })

  test('a per-level count overrides the split for that level', () => {
    const r = computeEstimate({ ...BASE, units: { 'individual:IOP': '4' } })
    near(lineFor(r, 'individual:IOP').units, 4, 'the entered level')
    near(lineFor(r, 'individual:OP').units, 10, 'the other level keeps its default')
  })

  test('the admission services stay one row, on the level admitted to', () => {
    const r = computeEstimate(BASE)
    const assessment = lineFor(r, 'assessment')
    assert.ok(assessment, 'the intake is not split in two')
    assert.equal(assessment.loc, 'IOP', 'it belongs to the level the client came in at')
    near(assessment.units, 1, 'and it is one assessment for the episode')
  })
})

describe('mixed rules and the deposit', () => {
  test('a waived deductible in IOP moves the money to OP, not out of the estimate', () => {
    const uniform = computeEstimate({ ...BASE, deductibleRemaining: '500' })
    const mixed = computeEstimate({
      ...BASE,
      deductibleRemaining: '500',
      levelRules: { IOP: { deductibleApplies: 'No' } },
    })
    // A deductible small enough for OP to absorb entirely is still spent in
    // full — it just lands later in the episode.
    near(mixed.outpatient.deductibleApplied, 500, 'the whole deductible is still spent')
    near(uniform.outpatient.deductibleApplied, 500, 'as it is without the override')
    near(mixed.grandTotal, uniform.grandTotal, 'so the deposit does not move')
  })

  test('an inpatient level can waive it too', () => {
    const r = computeEstimate({
      ...BASE,
      treatmentSequence: 'Detox > Residential',
      nights: { detox: '6', residential: '14' },
      levelRules: { Detox: { deductibleApplies: 'No' } },
    })
    const detox = r.inpatient.lines.find((l) => l.key === 'detox')
    const resi = r.inpatient.lines.find((l) => l.key === 'residential')
    near(detox.deductibleApplied, 0, 'detox takes none')
    near(resi.deductibleApplied, 5000, 'residential takes the whole pool')
  })
})
