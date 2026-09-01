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
  COPAY_TREATMENT,
  INITIAL_ESTIMATE_STATE,
  billingLevels,
  computeEstimate,
  estimateBlockers,
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

// ─────────────────────────────────────────────────────────────────────────────
// The case this whole mechanism exists for.
//
// An in-network IOP course is billed against the deductible and coinsured on
// the contracted rate. The psychiatry delivered alongside it is outpatient
// care: a flat copay per visit that never touches the deductible and feeds
// only the out-of-pocket maximum. One plan, two levels of care, and answers
// that contradict each other if either is applied to the whole episode.
describe('an IOP course coinsured beside an OP copay', () => {
  const PLAN = {
    ...BASE,
    treatmentSequence: 'IOP',
    deductibleRemaining: '3000',
    oopmRemaining: '9000',
    coinsurancePercent: '20',
    // Nothing plan-wide: the copay belongs to OP, and OP alone.
    copayAmount: '',
    copayBasis: COPAY_BASIS.NA,
    copayTreatment: COPAY_TREATMENT.NA,
    levelRules: {
      OP: {
        deductibleApplies: 'No',
        copayAmount: '20',
        copayBasis: COPAY_BASIS.PER_UNIT,
        copayTreatment: COPAY_TREATMENT.REPLACE,
        copayAppliesToDeductible: 'No',
        copayAppliesToOop: 'Yes',
      },
    },
    // A rate to do arithmetic against by hand, and an episode of nothing but
    // the IOP course and the psychiatry delivered during it.
    rateOverrides: { H0015: '305' },
    units: { iop: '30', assessment: '0', individual: '0', family: '0', mats: '0' },
  }

  test('the psychiatric visits are billed at the OP level, not the IOP one', () => {
    const r = computeEstimate(PLAN)
    assert.equal(lineFor(r, 'psychEval').loc, 'OP', 'the evaluation bills as outpatient care')
    assert.equal(lineFor(r, 'psychFollowUp').loc, 'OP', 'so do the follow-ups')
    assert.equal(lineFor(r, 'iop').loc, 'IOP', 'the IOP course is IOP')
    assert.ok(levelFor(r, 'OP'), 'the OP level is in force without the sequence naming it')
  })

  test('the IOP course pays the contracted rate to the deductible, then coinsurance', () => {
    const r = computeEstimate(PLAN)
    const iop = levelFor(r, 'IOP')
    near(iop.allowed, 30 * 305, '30 sessions at the contracted rate')
    near(iop.deductible, 3000, 'the deductible comes out of the IOP course first')
    near(iop.coinsurance, (30 * 305 - 3000) * 0.2, '20% of what the deductible did not absorb')
    near(iop.copay, 0, 'IOP collects no copay')
  })

  test('the OP copay is charged per visit and displaces nothing in IOP', () => {
    const r = computeEstimate(PLAN)
    const op = levelFor(r, 'OP')
    const visits = op.lines.reduce((sum, l) => sum + l.units, 0)
    near(op.copay, visits * 20, 'a copay per psychiatric visit')
    near(op.deductible, 0, 'the OP copay does not spend the deductible')
    // The whole point: the OP copay replaces OP's coinsurance and leaves the
    // IOP course's coinsurance exactly where it was.
    near(
      r.outpatient.coinsuranceDue,
      levelFor(r, 'IOP').coinsurance,
      'IOP keeps its coinsurance'
    )
    near(r.outpatient.copay, visits * 20, 'and the copay is the OP charge alone')
  })

  test('the deposit is the IOP waterfall plus the copays, and nothing else', () => {
    const r = computeEstimate(PLAN)
    const iop = levelFor(r, 'IOP')
    const visits = levelFor(r, 'OP').lines.reduce((sum, l) => sum + l.units, 0)
    near(
      r.outpatient.deposit,
      3000 + (iop.allowed - 3000) * 0.2 + visits * 20,
      'deductible, coinsurance on the rest, and a copay a visit'
    )
  })

  test('the copay still stops at the out-of-pocket maximum', () => {
    // A maximum small enough that the IOP course alone reaches it: the copay
    // counts toward that maximum, so nothing is collected past it.
    const r = computeEstimate({ ...PLAN, oopmRemaining: '4000' })
    near(r.outpatient.deposit, 4000, 'the cap holds the whole outpatient block')
  })
})

describe('what a client pays for one more unit', () => {
  // The rate column is the plan's allowed amount. What the client hands over is
  // a different number wherever a copay replaces coinsurance, and the screen
  // reads that off the level's rules rather than the rate.
  const copayLevel = {
    ...BASE,
    treatmentSequence: 'OP',
    levelRules: {
      OP: {
        copayAmount: '20',
        copayBasis: COPAY_BASIS.PER_UNIT,
        copayTreatment: COPAY_TREATMENT.REPLACE,
        copayAppliesToOop: 'Yes',
      },
    },
  }

  test('a copay that replaces coinsurance is what the client pays, not a share of the rate', () => {
    const r = computeEstimate(copayLevel)
    const groups = lineFor(r, 'opGroups')
    assert.ok(groups.rate > 20, 'the allowed rate is still the contracted amount')
    near(groups.clientPerUnit, 20, 'but the client pays the copay')
  })

  test('coinsurance on the allowed rate where no copay displaces it', () => {
    const r = computeEstimate({ ...BASE, treatmentSequence: 'OP' })
    const groups = lineFor(r, 'opGroups')
    near(groups.clientPerUnit, groups.rate * 0.2, 'a share of the allowed rate')
  })

  test('a copay added to coinsurance is charged on top of it', () => {
    const r = computeEstimate({
      ...copayLevel,
      levelRules: {
        OP: {
          copayAmount: '20',
          copayBasis: COPAY_BASIS.PER_UNIT,
          copayTreatment: COPAY_TREATMENT.ADD,
          copayAppliesToOop: 'Yes',
        },
      },
    })
    const groups = lineFor(r, 'opGroups')
    near(groups.clientPerUnit, groups.rate * 0.2 + 20, 'both')
  })
})

describe('psychiatry is outpatient care wherever it is delivered', () => {
  test('OP is a level of the estimate in a sequence that never names it', () => {
    const levels = billingLevels({ ...BASE, treatmentSequence: 'IOP' }).map((l) => l.loc)
    assert.deepEqual(levels, ['IOP', 'OP'], 'IOP for the course, OP for the psychiatry')
  })

  test('a sequence with no psychiatric service does not conjure an OP level', () => {
    const levels = billingLevels({ ...BASE, treatmentSequence: 'Detox > Residential' }).map(
      (l) => l.loc
    )
    assert.deepEqual(levels, ['Detox', 'Residential'])
  })

  test('the row says where it is billed when that is not where it is delivered', () => {
    const r = computeEstimate({ ...BASE, treatmentSequence: 'IOP' })
    assert.equal(lineFor(r, 'psychEval').billedElsewhere, true)
    const opOnly = computeEstimate({ ...BASE, treatmentSequence: 'OP' })
    assert.equal(
      lineFor(opOnly, 'psychEval').billedElsewhere,
      false,
      'an OP course bills it where it is delivered'
    )
  })

  test('the intake stays with the level the client was admitted to', () => {
    const r = computeEstimate({ ...BASE, treatmentSequence: 'IOP' })
    assert.equal(lineFor(r, 'assessment').loc, 'IOP', 'the intake is not psychiatry')
  })
})

describe('a bundled in-network IOP agreement', () => {
  const bundledPlan = {
    ...BASE,
    carrier: 'Oxford',
    treatmentSequence: 'IOP > OP',
    bundledInnIop: 'Yes',
  }

  test('it folds in the intake, individual therapy and family therapy', () => {
    const r = computeEstimate(bundledPlan)
    assert.equal(lineFor(r, 'assessment').bundledOut, true, 'the intake is in the bundle')
    assert.equal(lineFor(r, 'individual:IOP').bundledOut, true)
    assert.equal(lineFor(r, 'family:IOP').bundledOut, true)
    near(lineFor(r, 'individual:IOP').allowed, 0, 'a bundled line costs nothing of its own')
  })

  test('it does not reach the therapy delivered after the step-down', () => {
    // The bundle is an IOP agreement. OP therapy is billed like any other OP
    // service — there is no bundle covering it.
    const r = computeEstimate(bundledPlan)
    assert.equal(lineFor(r, 'individual:OP').bundledOut, false)
    assert.ok(lineFor(r, 'individual:OP').allowed > 0, 'the OP course is still billed')
    assert.ok(lineFor(r, 'family:OP').allowed > 0)
  })

  test('psychiatry is never in the bundle', () => {
    const r = computeEstimate(bundledPlan)
    assert.equal(lineFor(r, 'psychEval').bundledOut, false)
    assert.ok(lineFor(r, 'psychEval').allowed > 0, 'it is billed at the OP level')
  })

  test('an out-of-network plan has no bundle to apply', () => {
    const r = computeEstimate({ ...bundledPlan, carrier: 'BCBS - Anthem NY' })
    assert.equal(r.outpatient.bundled, false)
    assert.equal(lineFor(r, 'assessment').bundledOut, false)
  })
})

describe('a level that answers only an accumulator question', () => {
  // `chargeOverridden` is what says a level states its own copay charge. A
  // level that only says where its copay lands is still on the plan's charge,
  // and a manual total stays one charge for the block.
  const manual = {
    ...BASE,
    copayAmount: '500',
    copayBasis: COPAY_BASIS.MANUAL,
    copayAppliesToOop: 'Yes',
    levelRules: { OP: { copayAppliesToOop: 'No' } },
  }

  test('it is not charged the manual total a second time', () => {
    near(computeEstimate(manual).outpatient.copay, 500, 'charged once for the block')
  })

  test('but it still counts as running on its own terms', () => {
    assert.equal(hasLevelOverrides(manual), true)
    assert.equal(levelRule(manual, 'OP').chargeOverridden, false)
    assert.equal(levelRule(manual, 'OP').copayOverridden, true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A level of care charged as a whole.
//
// Some plans put an admission fee on IOP and include everything in it, psychiatry
// included: $200, and that is the IOP course. A step-down to OP is not covered
// by it — that level is priced under its own terms.
describe('an admission fee that covers the level', () => {
  const COVERED = {
    ...BASE,
    carrier: 'Oxford',
    treatmentSequence: 'IOP',
    deductibleRemaining: '3000',
    oopmRemaining: '9000',
    admissionFees: { ...INITIAL_ESTIMATE_STATE.admissionFees, iop: '200' },
    levelRules: { IOP: { admissionFeeCovers: 'Yes' } },
  }

  test('the fee is the whole deposit', () => {
    const r = computeEstimate(COVERED)
    near(r.outpatient.deductibleApplied, 0, 'no deductible is spent on covered care')
    near(r.outpatient.coinsurance, 0, 'and no coinsurance is charged on it')
    near(r.outpatient.copay, 0)
    near(r.outpatient.deposit, 200, 'the admission fee, and nothing else')
    near(r.grandTotal, 200)
  })

  test('the plan is still billed for the care the fee covered', () => {
    // Covered is not free: the services are delivered and billed, the client
    // just is not charged for them beyond the fee.
    const r = computeEstimate(COVERED)
    assert.ok(r.outpatient.totalAllowed > 10000, 'the episode is still priced')
    assert.ok(lineFor(r, 'iop').allowed > 0, 'the IOP line carries its allowed cost')
    assert.equal(lineFor(r, 'iop').coveredByFee, true)
  })

  test('psychiatry delivered in the covered level is covered, though it bills at OP', () => {
    const r = computeEstimate(COVERED)
    assert.equal(lineFor(r, 'psychEval').loc, 'OP', 'still billed as outpatient care')
    assert.equal(lineFor(r, 'psychEval').coveredByFee, true, 'and still covered by the IOP fee')
    near(levelFor(r, 'OP').allowed, 0, 'so the OP level has nothing left to charge')
  })

  test('an OP copay does not reach the visits the fee covered', () => {
    const r = computeEstimate({
      ...COVERED,
      levelRules: {
        ...COVERED.levelRules,
        OP: { copayAmount: '20', copayBasis: COPAY_BASIS.PER_UNIT, copayAppliesToOop: 'Yes' },
      },
    })
    near(r.outpatient.copay, 0, 'every psychiatric visit happened inside the covered level')
    near(r.outpatient.deposit, 200)
  })

  test('a step-down is priced under its own terms, with the deductible intact', () => {
    const r = computeEstimate({ ...COVERED, treatmentSequence: 'IOP > OP' })
    const op = levelFor(r, 'OP')
    assert.ok(op.allowed > 0, 'the OP course is billed')
    assert.equal(lineFor(r, 'opGroups').coveredByFee, false)
    // Nothing was collected from the client in IOP, so OP meets the deductible
    // it would have met on its own.
    near(op.deductible, Math.min(3000, op.allowed), 'the OP course spends the deductible')
    near(r.outpatient.deposit, op.deductible + (op.allowed - op.deductible) * 0.2 + 200, 'deposit')
  })

  test('the follow-ups delivered after the step-down are charged', () => {
    const r = computeEstimate({ ...COVERED, treatmentSequence: 'IOP > OP' })
    assert.equal(lineFor(r, 'psychFollowUp:IOP').coveredByFee, true, 'during the IOP course')
    assert.equal(lineFor(r, 'psychFollowUp:OP').coveredByFee, false, 'after the step-down')
  })

  test('a level charged as a whole with no fee entered is a blocker', () => {
    const blockers = estimateBlockers({
      ...COVERED,
      admissionFees: INITIAL_ESTIMATE_STATE.admissionFees,
    })
    assert.ok(
      blockers.some((b) => /IOP: the admission fee covers the level/.test(b)),
      `expected a blocker, got: ${blockers.join(' | ')}`
    )
    assert.equal(estimateBlockers(COVERED).length, 0, 'and none once the fee is entered')
  })

  test('an inpatient level can be charged as a whole too', () => {
    const r = computeEstimate({
      ...BASE,
      treatmentSequence: 'Detox > Residential',
      nights: { detox: '6', residential: '14' },
      admissionFees: { ...INITIAL_ESTIMATE_STATE.admissionFees, detox: '500' },
      levelRules: { Detox: { admissionFeeCovers: 'Yes' } },
    })
    const detox = r.inpatient.lines.find((l) => l.key === 'detox')
    const resi = r.inpatient.lines.find((l) => l.key === 'residential')
    near(detox.deductibleApplied, 0, 'detox charges its fee and nothing else')
    near(detox.coinsurance, 0)
    assert.equal(detox.coveredByFee, true)
    near(resi.deductibleApplied, 5000, 'residential still meets the whole deductible')
  })
})

describe('psychiatry through a step-down', () => {
  test('the follow-ups split across the levels without changing the course', () => {
    const r = computeEstimate(BASE)
    const iop = lineFor(r, 'psychFollowUp:IOP')
    const op = lineFor(r, 'psychFollowUp:OP')
    assert.ok(iop && op, 'a row for each level the client passes through')
    near(iop.units + op.units, 2, 'still one course of follow-ups for the admission')
    assert.equal(iop.loc, 'OP', 'both bill at the OP level')
    assert.equal(op.loc, 'OP')
  })

  test('the evaluation stays one visit at admission', () => {
    const r = computeEstimate(BASE)
    assert.ok(lineFor(r, 'psychEval'), 'not split')
    assert.equal(lineFor(r, 'psychEval').deliveredIn, 'IOP', 'delivered where the client came in')
  })

  test('MATs injections are psychiatric services and bill at OP', () => {
    const r = computeEstimate(BASE)
    assert.equal(lineFor(r, 'mats:IOP').loc, 'OP')
    assert.equal(lineFor(r, 'mats:OP').loc, 'OP')
  })
})
