// Copay start timing: deductible-first benefits and crossover services.
import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'
import { COPAY_BASIS, COPAY_TIMING, COPAY_TREATMENT, INITIAL_ESTIMATE_STATE, computeEstimate, estimateBlockers } from './estimate.js'

const base = {
  ...INITIAL_ESTIMATE_STATE,
  carrier: 'Aetna -',
  treatmentSequence: 'PHP',
  deductibleRemaining: '8889.44',
  oopmRemaining: '30000',
  deductibleInOopm: 'Yes',
  coinsurancePercent: '0',
  copayAmount: '70',
  copayBasis: COPAY_BASIS.PER_UNIT,
  copayTreatment: COPAY_TREATMENT.REPLACE,
  copayAppliesToDeductible: 'No',
  copayAppliesToOop: 'Yes',
  copayTiming: COPAY_TIMING.NEXT,
  // Exactly 20 PHP days at $855, no other billed services.
  units: { assessment: '0', individual: '0', family: '0', psychEval: '0', psychFollowUp: '0', mats: '0', php: '20' },
  rateOverrides: { H0035: '855' },
}
const close = (actual, expected) => assert.ok(Math.abs(actual-expected) < 0.005, `expected ${expected}, received ${actual}`)

describe('copay start timing', () => {
  test('PHP deductible first, nine copay days after the threshold day', () => {
    const r = computeEstimate(base)
    close(r.outpatient.deductibleApplied, 8889.44)
    close(r.outpatient.copay, 630)
    close(r.outpatient.deposit, 9519.44)
  })
  test('meeting service included when benefit says so', () => {
    const r = computeEstimate({ ...base, copayTiming: COPAY_TIMING.CROSSOVER })
    close(r.outpatient.copay, 700)
    close(r.outpatient.deposit, 9589.44)
  })
  test('default behavior still charges all service units', () => {
    const r = computeEstimate({ ...base, copayTiming: COPAY_TIMING.IMMEDIATE })
    close(r.outpatient.copay, 1400)
    close(r.outpatient.deposit, 10289.44)
  })
  test('unmet deductible means no after-deductible copay', () => {
    const r = computeEstimate({ ...base, deductibleRemaining: '20000' })
    close(r.outpatient.copay, 0)
    close(r.outpatient.deposit, 17100)
  })
  test('deductible met at entry means all units have copay', () => {
    const r = computeEstimate({ ...base, deductibleRemaining: '0' })
    close(r.outpatient.copay, 1400)
    close(r.outpatient.deposit, 1400)
  })
  test('out-of-pocket cap is still respected', () => {
    const r = computeEstimate({ ...base, oopmRemaining: '9100' })
    close(r.outpatient.deposit, 9100)
  })
  test('level-specific copay timing overrides the plan', () => {
    const r = computeEstimate({ ...base, copayTiming: COPAY_TIMING.IMMEDIATE, levelRules: { PHP: { copayTiming: COPAY_TIMING.NEXT } } })
    close(r.outpatient.copay, 630)
  })
  test('waived deductible on the level starts copays immediately', () => {
    const r = computeEstimate({ ...base, levelRules: { PHP: { deductibleApplies: 'No' } } })
    close(r.outpatient.deductibleApplied, 0)
    close(r.outpatient.copay, 1400)
  })
  test('manual total cannot silently masquerade as a per-unit post-deductible copay', () => {
    const form = { ...base, copayBasis: COPAY_BASIS.MANUAL }
    assert.ok(estimateBlockers(form).some(x => x.includes('per-unit')))
  })
  test('copay credited to deductible conflicts with post-deductible timing', () => {
    const form = { ...base, copayAppliesToDeductible: 'Yes' }
    assert.ok(estimateBlockers(form).some(x => x.includes('cannot also be credited')))
  })
})
