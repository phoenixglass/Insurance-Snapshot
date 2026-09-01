// Hardship allocation, against the workbook's rule and the estimator's totals.
//
// The workbook's panel is a waterfall: what the client can afford is allocated
// in listed service order, and everything it does not reach is the award. The
// tests here hold that rule, and hold the one thing the port changes on
// purpose — the allocation runs against the deposit an insured client is asked
// for, not against a self-pay program cost they are never billed.

import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { INITIAL_ESTIMATE_STATE, computeEstimate, estimateBlockers } from './estimate.js'
import { computeHardship, hardshipBlockers } from './hardship.js'

// The workbook's own saved insurance scenario: Aetna out of network, six detox
// nights and thirty-five residential, $10,000 of deductible left and 10%
// coinsurance. Its I1 is $17,075.50, which the estimator matches to the cent.
const AETNA = {
  ...INITIAL_ESTIMATE_STATE,
  carrier: 'Aetna -',
  treatmentSequence: 'Detox > Residential',
  deductibleRemaining: '10000',
  oopmRemaining: '25000',
  deductibleInOopm: 'Yes',
  coinsurancePercent: '10',
  admissionFeeInOopm: 'Yes',
  nights: { detox: '6', residential: '35' },
}

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: got ${a}, want ${b}`)
const withHardship = (form) => computeHardship(computeEstimate(form), form)

describe('hardship is off until it is turned on', () => {
  test('nothing is allocated and the deposit stands', () => {
    const r = computeEstimate(AETNA)
    const h = computeHardship(r, AETNA)
    assert.equal(h.active, false)
    assert.deepEqual(h.rows, [])
    assert.equal(h.scholarship, 0)
    assert.equal(h.clientPays, r.grandTotal, 'the client owes the whole deposit')
  })

  test('an affordability entered while hardship is off changes nothing', () => {
    const h = withHardship({ ...AETNA, clientCanAfford: '6000' })
    assert.equal(h.active, false)
    assert.equal(h.scholarship, 0)
  })
})

describe('the allocation runs in listed order', () => {
  const h = withHardship({ ...AETNA, hardship: 'Yes', clientCanAfford: '6000' })

  test('the deposit it splits is the deposit the estimator computed', () => {
    near(h.deposit, 17075.5, 'deposit')
    near(h.clientPays + h.scholarship, h.deposit, 'the split accounts for every dollar')
  })

  test('the client pays what they can afford and hardship carries the rest', () => {
    near(h.clientPays, 6000, 'client pays')
    near(h.scholarship, 11075.5, 'hardship award')
    near(h.scholarshipPercent, 11075.5 / 17075.5, 'award %')
  })

  test('the earliest level of care is filled first, and it is the one that splits', () => {
    const [detox, residential] = h.rows
    assert.equal(detox.label, 'Detox')
    // Detox carries the whole deductible plus coinsurance on what is left of it.
    near(detox.responsibility, 10233, 'detox responsibility')
    near(detox.clientPays, 6000, 'detox takes what it can')
    near(detox.scholarship, 4233, 'and hardship covers the remainder of the line')
    assert.ok(detox.split, 'this is the line the money runs out on')

    assert.equal(residential.label, 'Residential')
    near(residential.clientPays, 0, 'nothing is left for residential')
    near(residential.scholarship, 6842.5, 'so hardship carries all of it')
    assert.equal(residential.split, false)
  })

  test('per-line responsibility sums to the deposit', () => {
    near(
      h.rows.reduce((sum, r) => sum + r.responsibility, 0),
      h.deposit,
      'responsibility'
    )
  })

  test('coverage is stated as a share of the line, never as a rate per night', () => {
    const detox = h.rows[0]
    near(detox.paidUnits + detox.coveredUnits, detox.units, 'nights are all on one side or other')
    // 4233 of 10233 is 41.4% of the line, which is 2.48 of its 6 nights.
    near(detox.coveredUnits, (4233 / 10233) * 6, 'covered nights')
    assert.equal(detox.rate, 2055, 'the allowed rate is untouched')
  })
})

describe('the edges of the award', () => {
  test('a client who can afford nothing is carried entirely', () => {
    const h = withHardship({ ...AETNA, hardship: 'Yes', clientCanAfford: '' })
    near(h.clientPays, 0, 'client pays')
    near(h.scholarship, h.deposit, 'hardship covers the deposit')
    assert.ok(h.rows.every((r) => !r.split), 'no line is split when nothing is paid')
  })

  test('a client who can afford the deposit needs no award', () => {
    const h = withHardship({ ...AETNA, hardship: 'Yes', clientCanAfford: '17075.50' })
    near(h.scholarship, 0, 'award')
    assert.equal(h.surplus, 0)
    assert.ok(h.rows.every((r) => r.covered))
  })

  test('affordability beyond the deposit is reported as surplus, not as a credit', () => {
    const h = withHardship({ ...AETNA, hardship: 'Yes', clientCanAfford: '20000' })
    near(h.clientPays, 17075.5, 'the client is never asked for more than the deposit')
    near(h.surplus, 2924.5, 'surplus')
    near(h.scholarship, 0, 'award')
  })

  test('a blank affordability blocks the quote rather than awarding the whole deposit', () => {
    // The compute above still shows the full-award case, because that is what a
    // blank field means arithmetically. Quoting it is the part that is stopped:
    // "hardship covers everything" is too large a claim to read off an empty
    // cell, while a typed zero is somebody's decision.
    assert.deepEqual(hardshipBlockers({ ...AETNA, hardship: 'Yes', clientCanAfford: '' }), [
      'Enter what the client can afford',
    ])
    assert.deepEqual(hardshipBlockers({ ...AETNA, hardship: 'Yes', clientCanAfford: '0' }), [])
    assert.deepEqual(hardshipBlockers({ ...AETNA, hardship: 'Yes', clientCanAfford: '-5' }), [
      'Enter what the client can afford',
    ])
    assert.deepEqual(hardshipBlockers({ ...AETNA, hardship: 'No' }), [])
  })
})

describe('an outpatient episode', () => {
  const IOP = {
    ...INITIAL_ESTIMATE_STATE,
    carrier: 'Aetna -',
    treatmentSequence: 'IOP',
    deductibleRemaining: '1000',
    oopmRemaining: '25000',
    deductibleInOopm: 'Yes',
    coinsurancePercent: '20',
    hardship: 'Yes',
    clientCanAfford: '500',
  }

  test('services are allocated in the order the estimator lists them', () => {
    const h = withHardship(IOP)
    const labels = h.rows.map((r) => r.label)
    assert.deepEqual(labels.slice(0, 2), ['Initial Assessment', 'IOP Services'])
    near(h.clientPays, 500, 'client pays')
    near(
      h.rows.reduce((sum, r) => sum + r.responsibility, 0),
      h.deposit,
      'responsibility sums to the deposit'
    )
    assert.equal(h.rows.filter((r) => r.split).length, 1, 'exactly one line splits')
  })

  test('the deductible lands on the earliest services, so they cost the client most', () => {
    const h = withHardship({ ...IOP, clientCanAfford: '0' })
    const assessment = h.rows.find((r) => r.label === 'Initial Assessment')
    const iop = h.rows.find((r) => r.label === 'IOP Services')
    // The assessment is the first service, so the deductible pays for all of it
    // at 100%, while IOP services fall to the 20% coinsurance.
    near(assessment.responsibility, 345, 'assessment is deductible in full')
    near(iop.responsibility, (30 * 585 - 655) * 0.2 + 655, 'IOP takes the rest of the deductible')
  })
})

describe('a prior balance', () => {
  const withBalance = {
    ...AETNA,
    hardship: 'Yes',
    previousBalance: '2000',
    clientCanAfford: '25000',
  }

  test('it is allocated last, so affordability covers this admission first', () => {
    const h = withHardship(withBalance)
    assert.equal(h.rows[h.rows.length - 1].label, 'Previous outstanding balance')
    near(h.deposit, 19075.5, 'deposit includes the balance')
    near(h.clientPays, 19075.5, 'this client can cover all of it')
    assert.equal(h.coversPreviousBalance, 0)
  })

  test('an award reaching the old balance is reported on its own', () => {
    const h = withHardship({ ...withBalance, clientCanAfford: '6000' })
    near(h.coversPreviousBalance, 2000, 'the award forgives the whole balance')
    near(h.scholarship, 13075.5, 'total award')
  })
})

describe('the estimate underneath is unchanged', () => {
  test('turning hardship on does not move the deposit or the revenue', () => {
    const off = computeEstimate(AETNA)
    const on = computeEstimate({ ...AETNA, hardship: 'Yes', clientCanAfford: '6000' })
    near(on.grandTotal, off.grandTotal, 'deposit')
    near(on.totalRevenue, off.totalRevenue, 'revenue')
    assert.deepEqual(estimateBlockers({ ...AETNA, hardship: 'Yes' }), estimateBlockers(AETNA))
  })
})
