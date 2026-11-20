// Optum PHP outside Canaan: charged as self-pay at $442 a day, with the plan's
// deductible, coinsurance, copay and out-of-pocket maximum disregarded for it.
// See `data/siteSelfPay.js`.

import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import {
  COPAY_BASIS,
  COPAY_TREATMENT,
  INITIAL_ESTIMATE_STATE,
  computeEstimate,
  estimateBlockers,
} from './estimate.js'
import { generateEstimateOutput } from './estimateOutput.js'
import { computeHardship } from './hardship.js'

const near = (a, b) => Math.abs(a - b) < 0.005

// A plan with every cost-share lever pulled, so that anything leaking into PHP
// would move the number.
const form = (over) => ({
  ...INITIAL_ESTIMATE_STATE,
  treatmentSequence: 'PHP',
  coinsurancePercent: '20',
  deductibleRemaining: '1500',
  oopmRemaining: '4000',
  copayAmount: '50',
  copayBasis: COPAY_BASIS.PER_UNIT,
  copayTreatment: COPAY_TREATMENT.ADD,
  copayAppliesToDeductible: 'Yes',
  copayAppliesToOop: 'Yes',
  ...over,
})

const OPTUM_AWAY = ['Optum Wilton', 'Optum Chappaqua', 'Optum NYC', 'Optum Huntington', 'Optum Ramsey']
const AWAY_SITES = ['wilton', 'ramsey', 'nyc', 'chappaqua', 'huntington', 'mass-virtual']

describe('Optum PHP outside Canaan is self-pay at $442 a day', () => {
  test('20 days is $8,840 at every Optum site but Canaan, whatever the plan says', () => {
    for (const carrier of OPTUM_AWAY) {
      const r = computeEstimate(form({ carrier }))
      assert.ok(near(r.grandTotal, 8840), `${carrier}: ${r.grandTotal}`)
      assert.ok(near(r.selfPay, 8840), carrier)
      assert.equal(r.outpatient.deductibleApplied, 0, carrier)
      assert.equal(r.outpatient.coinsurance, 0, carrier)
      assert.equal(r.outpatient.copay, 0, carrier)
    }
  })

  test('the total moves only with the day count', () => {
    const r = computeEstimate(form({ carrier: 'Optum Wilton', units: { php: '15' } }))
    assert.ok(near(r.grandTotal, 15 * 442))
    // Plan terms that would otherwise change everything change nothing.
    for (const over of [
      { deductibleRemaining: '0' },
      { oopmRemaining: '0' },
      { coinsurancePercent: '0' },
      { copayAmount: '0', copayBasis: COPAY_BASIS.NA },
      { oopmRemaining: '100', deductibleInOopm: 'No' },
    ]) {
      assert.ok(near(computeEstimate(form({ carrier: 'Optum Wilton', ...over })).grandTotal, 8840), JSON.stringify(over))
    }
  })

  test('Optum as the dropdown offers it: the location decides', () => {
    for (const location of AWAY_SITES) {
      const r = computeEstimate(form({ carrier: 'Optum', location }))
      assert.ok(near(r.grandTotal, 8840), `${location}: ${r.grandTotal}`)
    }
    const canaan = computeEstimate(form({ carrier: 'Optum', location: 'canaan' }))
    assert.equal(canaan.selfPay, 0)
    assert.ok(near(canaan.grandTotal, (1500 - 1000) + 7340 * 0.2 + 1000), String(canaan.grandTotal))
    // No location: no rule, and the quote is blocked for want of one.
    const none = form({ carrier: 'Optum' })
    assert.equal(computeEstimate(none).selfPay, 0)
    assert.ok(estimateBlockers(none).some((b) => b.includes('location')))
  })

  test('every site other than Canaan, by the location selected', () => {
    for (const location of AWAY_SITES) {
      const r = computeEstimate(form({ carrier: 'Optum Canaan', location }))
      assert.ok(near(r.grandTotal, 8840), location)
    }
  })

  test('at Canaan, Optum PHP is still priced through the plan', () => {
    const r = computeEstimate(form({ carrier: 'Optum Canaan', location: 'canaan' }))
    assert.equal(r.selfPay, 0)
    // 1,500 deductible, 20% of the remaining 7,340, plus a $50 copay on 20 days
    // — which is credited to the deductible, so 1,000 of it is not collected twice.
    assert.ok(near(r.grandTotal, (1500 - 1000) + 7340 * 0.2 + 1000), String(r.grandTotal))
    // With no location, Optum Canaan reads as Canaan.
    assert.ok(near(computeEstimate(form({ carrier: 'Optum Canaan' })).grandTotal, r.grandTotal))
  })

  test('the selected location outranks the site in the carrier name', () => {
    assert.ok(near(computeEstimate(form({ carrier: 'Optum Canaan', location: 'wilton' })).grandTotal, 8840))
    assert.equal(computeEstimate(form({ carrier: 'Optum Wilton', location: 'canaan' })).selfPay, 0)
  })

  test('Optum-administered plans without a site row are not affected', () => {
    for (const carrier of ['UMR (Optum)', 'Emblem (Optum)', 'UBH-HP (Optum)', 'Surest (Optum)']) {
      const r = computeEstimate(form({ carrier, location: 'wilton' }))
      assert.equal(r.selfPay, 0, carrier)
    }
  })

  test('a PHP admission fee that covers the level still has to be entered', () => {
    const f = {
      ...INITIAL_ESTIMATE_STATE,
      carrier: 'Optum',
      location: 'wilton',
      treatmentSequence: 'PHP',
      levelRules: { PHP: { admissionFeeCovers: 'Yes' } },
    }
    assert.ok(estimateBlockers(f).some((b) => b.startsWith('PHP: the admission fee covers the level')))
    const paid = { ...f, admissionFees: { ...f.admissionFees, php: '3000' } }
    assert.deepEqual(estimateBlockers(paid), [])
    assert.ok(near(computeEstimate(paid).grandTotal, 3000), 'the fee replaces the flat charge')
  })

  test('a typed H0035 rate does not move the self-pay rate', () => {
    const r = computeEstimate(form({ carrier: 'Optum Wilton', rateOverrides: { H0035: '999' } }))
    assert.ok(near(r.grandTotal, 8840))
  })

  test('PHP passes the deductible and out-of-pocket room through untouched', () => {
    // Detox before PHP and IOP after it: the IOP course has to see exactly what
    // detox left, as if PHP were not in the plan's waterfall at all.
    const seq = { treatmentSequence: 'Detox > PHP > IOP', location: 'wilton' }
    const withPhp = computeEstimate(form({ carrier: 'Optum Wilton', ...seq }))
    const noPhp = computeEstimate(form({ carrier: 'Optum Wilton', ...seq, units: { php: '0' } }))
    assert.ok(near(withPhp.grandTotal - noPhp.grandTotal, 8840))
    assert.ok(near(withPhp.outpatient.deductibleApplied, noPhp.outpatient.deductibleApplied))
    assert.ok(near(withPhp.outpatient.afterCap, noPhp.outpatient.afterCap))
    assert.ok(near(withPhp.inpatient.deposit, noPhp.inpatient.deposit))
  })

  test('nothing is flagged as estimated or missing for self-pay PHP', () => {
    // Optum Chappaqua has no PHP rate of its own; before this it priced from
    // claims history and the quote said so.
    const r = computeEstimate(form({ carrier: 'Optum Chappaqua' }))
    assert.deepEqual(r.estimatedRates, [])
    assert.deepEqual(r.missingRates, [])
  })

  test('a PHP-only quote does not ask for plan terms it does not use', () => {
    const bare = {
      ...INITIAL_ESTIMATE_STATE,
      carrier: 'Optum Wilton',
      treatmentSequence: 'PHP',
    }
    assert.deepEqual(estimateBlockers(bare), [])
    assert.ok(near(computeEstimate(bare).grandTotal, 8840))
    // With another level of care in the sequence, the plan prices it, and the
    // terms are required again.
    const blockers = estimateBlockers({ ...bare, treatmentSequence: 'PHP > IOP' })
    assert.ok(blockers.some((b) => b.includes('coinsurance')))
    assert.ok(blockers.some((b) => b.includes('deductible')))
  })

  test('the cost note and the staff detail say it is self-pay, and why', () => {
    const f = form({ carrier: 'Optum Wilton' })
    const r = computeEstimate(f)
    const out = generateEstimateOutput(f, r, estimateBlockers(f))
    assert.match(out.costNote, /Deposit: \$8,840\./)
    assert.match(out.costNote, /PHP, 20 days at \$442 a day, self-pay: \$8,840/)
    assert.doesNotMatch(out.costNote, /Deductible:|Coinsurance,|Copay:/)
    assert.doesNotMatch(out.costNote, /plan’s cost share/, 'the plan is not paying for any of it')
    assert.match(out.staffDetail, /PHP priced outside the plan: self-pay at \$442\.00 a day/)
    assert.match(out.staffDetail, /Self-pay, outside the plan and the cap: \$8,840\.00/)
    assert.match(out.clientExplanation, /not billed for PHP, 20 days at \$442 a day/)
    assert.doesNotMatch(out.clientExplanation, /in network with your plan/)
  })

  test('hardship allocates the self-pay charge as itself, not scaled with the plan', () => {
    const f = form({
      carrier: 'Optum Wilton',
      treatmentSequence: 'PHP > IOP',
      hardship: 'Yes',
      clientCanAfford: '1000',
    })
    const r = computeEstimate(f)
    const h = computeHardship(r, f)
    const php = h.rows.find((row) => row.key === 'php')
    assert.ok(near(php.responsibility, 8840))
    const total = h.rows.reduce((sum, row) => sum + row.responsibility, 0)
    assert.ok(near(total, r.grandTotal))
  })
})
