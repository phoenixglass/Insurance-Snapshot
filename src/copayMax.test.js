// A copay with a ceiling: "$200 a day up to $2,000".
//
// Detox and residential benefits are written this way often enough that a
// per-unit copay without a ceiling quotes a long stay at several times what the
// plan will actually collect. The amount and the ceiling are separate answers —
// the amount says what one night costs, the ceiling says when the meter stops —
// and the ceiling is a running total rather than a per-charge rule, which is
// what these tests are mostly about: what shares one, and in what order it is
// spent.

import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  COPAY_BASIS,
  COPAY_TREATMENT,
  INITIAL_ESTIMATE_STATE,
  computeEstimate,
  estimateBlockers,
  hasLevelOverrides,
  levelRule,
} from './estimate.js'
import { generateEstimateOutput } from './estimateOutput.js'

// Six detox nights and fourteen residential ones, at $200 a night: $4,000 of
// copay before any ceiling is applied.
const BASE = {
  ...INITIAL_ESTIMATE_STATE,
  carrier: 'Aetna -',
  treatmentSequence: 'Detox > Residential',
  deductibleRemaining: '3000',
  oopmRemaining: '50000',
  deductibleInOopm: 'Yes',
  coinsurancePercent: '20',
  copayAmount: '200',
  copayBasis: COPAY_BASIS.PER_UNIT,
  copayTreatment: COPAY_TREATMENT.ADD,
  copayAppliesToDeductible: 'No',
  copayAppliesToOop: 'Yes',
}

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: got ${a}, want ${b}`)
const nightFor = (r, key) => r.inpatient.lines.find((l) => l.key === key)

describe('no maximum stated', () => {
  test('the copay is every unit, as it always was', () => {
    const r = computeEstimate(BASE)
    near(r.inpatient.copay, 4000, 'twenty nights at $200')
    near(r.inpatient.copayBeforeMax, 4000, 'nothing was stopped')
  })

  test('a maximum nothing reaches changes no number', () => {
    const r = computeEstimate({ ...BASE, copayMax: '10000' })
    near(r.inpatient.copay, 4000, 'the ceiling is above the charge')
    near(r.inpatient.deposit, computeEstimate(BASE).inpatient.deposit, 'the same deposit')
  })

  test('a maximum is not an override — the level is still on the plan terms', () => {
    assert.equal(hasLevelOverrides({ ...BASE, copayMax: '2000' }), false)
    assert.equal(levelRule({ ...BASE, copayMax: '2000' }, 'Detox').copayMax, 2000)
  })
})

describe("the plan's ceiling is one ceiling for the episode", () => {
  const capped = { ...BASE, copayMax: '2000' }

  test('it stops the copay at the maximum', () => {
    const r = computeEstimate(capped)
    near(r.inpatient.copay, 2000, 'the ceiling')
    near(r.inpatient.copayBeforeMax, 4000, 'what it would have been')
  })

  test('it is spent in the order care is delivered', () => {
    const r = computeEstimate(capped)
    // Detox is stayed first, so its six nights fill $1,200 of the ceiling and
    // the fourteen residential nights collect only the $800 left.
    near(nightFor(r, 'detox').copay, 1200, 'detox takes what it can')
    near(nightFor(r, 'residential').copay, 800, 'residential takes the rest')
    assert.equal(nightFor(r, 'detox').copayMaxReached, false)
    assert.equal(nightFor(r, 'residential').copayMaxReached, true)
  })

  test('a ceiling the inpatient stay fills leaves nothing for the outpatient block', () => {
    const r = computeEstimate({ ...BASE, treatmentSequence: 'Detox > IOP', copayMax: '1000' })
    near(r.inpatient.copay, 1000, 'the detox nights fill it')
    near(r.outpatient.copay, 0, 'and the IOP course collects no copay')
    assert.ok(r.outpatient.copayBeforeMax > 0, 'the IOP course would otherwise have collected one')
  })

  test('past the ceiling one more unit of care carries no copay', () => {
    const r = computeEstimate({ ...BASE, treatmentSequence: 'IOP', copayMax: '100' })
    const line = r.outpatient.lines.find((l) => l.active && l.loc === 'IOP')
    assert.equal(line.copayMaxReached, true)
    near(line.clientPerUnit, line.rate * 0.2, 'coinsurance alone, with the copay spent')
  })
})

describe("a level of care's own ceiling", () => {
  test('it stops that level and nothing else', () => {
    const r = computeEstimate({ ...BASE, levelRules: { Detox: { copayMax: '600' } } })
    near(nightFor(r, 'detox').copay, 600, "detox's own ceiling")
    near(nightFor(r, 'residential').copay, 2800, 'residential is uncapped')
  })

  test('it does not consume the plan ceiling the other levels read', () => {
    const r = computeEstimate({
      ...BASE,
      copayMax: '2000',
      levelRules: { Detox: { copayMax: '600' } },
    })
    near(nightFor(r, 'detox').copay, 600, 'its own $600')
    near(nightFor(r, 'residential').copay, 2000, "the plan's whole $2,000, untouched by detox")
  })

  test('stating one is stating own terms', () => {
    const form = { ...BASE, levelRules: { Detox: { copayMax: '600' } } }
    assert.equal(levelRule(form, 'Detox').ownTerms, true)
    assert.equal(levelRule(form, 'Detox').copayMaxOverridden, true)
    assert.equal(levelRule(form, 'Residential').copayMaxOverridden, false)
    assert.equal(hasLevelOverrides(form), true)
  })
})

describe('the ceiling is applied before the accumulators', () => {
  // A copay the plan never collects cannot be credited to the deductible or
  // spend out-of-pocket room, so the cap has to bind before the waterfall
  // counts it — not after.
  const credited = { ...BASE, copayAppliesToDeductible: 'Yes' }

  test('only the copay actually collected is credited to the deductible', () => {
    const uncapped = computeEstimate(credited)
    near(uncapped.inpatient.netDeductible, 0, '$4,000 of copay covers the $3,000 deductible')

    const r = computeEstimate({ ...credited, copayMax: '2000' })
    near(r.inpatient.copay, 2000, 'the ceiling')
    near(r.inpatient.netDeductible, 1000, 'and only $2,000 of the deductible is met by it')
  })

  test('only the copay actually collected spends out-of-pocket room', () => {
    const r = computeEstimate({ ...BASE, oopmRemaining: '2500', copayMax: '2000' })
    near(r.inpatient.afterCap, 2500, 'the maximum caps what the ceiling left')
  })
})

describe('what the estimate refuses to quote over', () => {
  test('a maximum with no copay under it', () => {
    const blockers = estimateBlockers({
      ...BASE,
      copayAmount: '',
      copayBasis: COPAY_BASIS.NA,
      copayMax: '2000',
    })
    assert.ok(
      blockers.some((b) => b.includes('copay maximum is entered but no copay')),
      blockers.join(' | ')
    )
  })

  test("a level's own maximum where that level collects nothing", () => {
    const blockers = estimateBlockers({
      ...BASE,
      levelRules: { Detox: { copayMax: '600', copayBasis: COPAY_BASIS.NA } },
    })
    assert.ok(
      blockers.some((b) => b === 'Detox has a copay maximum but no copay is collected there'),
      blockers.join(' | ')
    )
  })

  test('a level reading the plan ceiling is not blocked for reading it', () => {
    assert.deepEqual(estimateBlockers({ ...BASE, copayMax: '2000' }), [])
  })
})

describe('what the output says about it', () => {
  const form = { ...BASE, copayMax: '2000' }

  test('the copay is quoted with its ceiling, not just its rate', () => {
    const out = generateEstimateOutput(form, computeEstimate(form))
    // The client note rounds to whole dollars; the ceiling is stated the same way.
    assert.ok(out.costNote.includes('$200 per service unit, up to $2,000'), out.costNote)
  })

  test('the staff detail says what the ceiling stopped', () => {
    const out = generateEstimateOutput(form, computeEstimate(form))
    assert.ok(out.staffDetail.includes('Maximum: $2,000.00 for the episode'), 'plan terms')
    assert.ok(
      out.staffDetail.includes('Copay: $2,000.00 (a maximum stopped $2,000.00 of it)'),
      'the waterfall row'
    )
  })

  test('no ceiling is said to be none rather than nothing', () => {
    const out = generateEstimateOutput(BASE, computeEstimate(BASE))
    assert.ok(out.staffDetail.includes('Maximum: none stated'), 'plan terms')
    assert.ok(!out.costNote.includes('up to'), 'and the client note does not mention one')
  })
})
