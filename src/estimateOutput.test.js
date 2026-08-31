// The estimator's outputs, checked against the estimate they were built from.
//
// These tests exist for one failure: an output that says something the form
// does not. A quote is read out loud and acted on, so every number in it has to
// be the number the estimator computed, and anything the estimate cannot stand
// behind — an unpriced code, a half-entered plan — has to be visible rather
// than rounded into the total.

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

// A complete, quotable estimate: both waterfalls active, and every field a
// blocker asks for filled in.
const BASE = {
  ...INITIAL_ESTIMATE_STATE,
  carrier: 'Cigna',
  treatmentSequence: 'Detox > Residential > IOP',
  coinsurancePercent: '20',
  deductibleRemaining: '1500',
  oopmRemaining: '40000',
  copayAmount: '',
  copayBasis: COPAY_BASIS.NA,
}

const outputFor = (overrides = {}) => {
  const form = { ...BASE, ...overrides }
  const result = computeEstimate(form)
  return {
    form,
    result,
    ...generateEstimateOutput(form, result, estimateBlockers(form)),
  }
}

describe('the cost note quotes the estimate', () => {
  test('the deposit it states is the deposit that was computed', () => {
    const { costNote, result } = outputFor()
    assert.ok(result.grandTotal > 0, 'the fixture has to price something')
    const stated = costNote.match(/Deposit before care begins: \$([\d,]+)\./)
    assert.ok(stated, `no deposit line in:\n${costNote}`)
    assert.equal(
      Number(stated[1].replace(/,/g, '')),
      Math.round(result.grandTotal),
      'the quoted deposit must be the computed one'
    )
  })

  test('it names the carrier, the network and the sequence', () => {
    const { costNote } = outputFor()
    assert.match(costNote, /Cigna/)
    assert.match(costNote, /out of network/)
    assert.match(costNote, /Detox > Residential > IOP/)
  })

  test('the pieces it lists add up to the deposit', () => {
    const { costNote, result } = outputFor({ previousBalance: '300' })
    const amounts = [...costNote.matchAll(/^ {2}(?:Deductible|Coinsurance|Copay|Admission fee)[^$]*\$([\d,]+)/gm)]
      .map((m) => Number(m[1].replace(/,/g, '')))
    const capped = costNote.match(/Less the out-of-pocket maximum[^$]*\$([\d,]+)/)
    const sum =
      amounts.reduce((a, b) => a + b, 0) - (capped ? Number(capped[1].replace(/,/g, '')) : 0)
    assert.equal(
      sum,
      Math.round(result.inpatient.deposit + result.outpatient.deposit),
      `the breakdown must reconcile to the deposit:\n${costNote}`
    )
  })

  test('a previous balance is named rather than folded in silently', () => {
    const { costNote } = outputFor({ previousBalance: '300' })
    assert.match(costNote, /Balance already owed: \$300\./)
  })

  test('money that did not move is not named', () => {
    // No copay, no admission fee, no prior balance.
    const { costNote } = outputFor()
    assert.doesNotMatch(costNote, /Copay/)
    assert.doesNotMatch(costNote, /Admission fee/)
    assert.doesNotMatch(costNote, /Balance already owed/)
  })

  test('a copay is quoted with what it is charged on', () => {
    const { costNote } = outputFor({
      copayAmount: '50',
      copayBasis: COPAY_BASIS.PROFESSIONAL_ONLY,
      copayTreatment: COPAY_TREATMENT.ADD,
      copayAppliesToDeductible: 'No',
      copayAppliesToOop: 'Yes',
    })
    assert.match(costNote, /Copay: \$[\d,]+ — \$50 per visit, on \d+ visits\./)
  })

  test('a copay that replaces coinsurance is not quoted alongside coinsurance', () => {
    const { costNote } = outputFor({
      treatmentSequence: 'OP',
      deductibleRemaining: '0',
      copayAmount: '40',
      copayBasis: COPAY_BASIS.PER_UNIT,
      copayTreatment: COPAY_TREATMENT.REPLACE,
      copayAppliesToDeductible: 'No',
      copayAppliesToOop: 'Yes',
    })
    assert.match(costNote, /charged instead of coinsurance/)
    assert.doesNotMatch(costNote, /^ {2}Coinsurance/m)
  })
})

describe('the cost note refuses to quote what it cannot stand behind', () => {
  test('an incomplete estimate produces a refusal, not a total', () => {
    const { costNote, result } = outputFor({ carrier: '', coinsurancePercent: '' })
    assert.match(costNote, /^DO NOT QUOTE/)
    assert.match(costNote, /Select an insurance carrier/)
    assert.doesNotMatch(costNote, /Deposit before care begins/)
    // The estimate itself still computes; it is the quote that is withheld.
    assert.equal(typeof result.grandTotal, 'number')
  })

  test('a service with no rate on file is named, with what it does to the total', () => {
    // GEHA-ASA prices the two inpatient codes and nothing else, so an IOP
    // sequence against it leaves several outpatient codes unpriced.
    const { costNote } = outputFor({
      carrier: 'GEHA-ASA (Optum)',
      treatmentSequence: 'IOP',
    })
    assert.match(costNote, /Do not quote yet/)
    assert.match(costNote, /no rate is on file/)
    assert.match(costNote, /higher than the figure above/)
  })
})

describe('the staff detail carries what the note leaves out', () => {
  test('it restates the plan terms as they were entered', () => {
    const { staffDetail } = outputFor({
      copayAmount: '50',
      copayBasis: COPAY_BASIS.MANUAL,
      copayTreatment: COPAY_TREATMENT.ADD,
      copayAppliesToDeductible: 'Yes',
      copayAppliesToOop: 'No',
      deductibleInOopm: 'No',
    })
    assert.match(staffDetail, /Deductible remaining: \$1,500\.00/)
    assert.match(staffDetail, /Out-of-pocket maximum remaining: \$40,000\.00/)
    assert.match(staffDetail, /Coinsurance: 20%/)
    assert.match(staffDetail, /Deductible counts toward the out-of-pocket maximum: No/)
    assert.match(staffDetail, /Basis: Manual Total/)
    assert.match(staffDetail, /Applies to deductible: Yes/)
    assert.match(staffDetail, /Applies to out-of-pocket maximum: No/)
  })

  test('every priced line appears with its units, rate and cost', () => {
    const { staffDetail, result } = outputFor()
    for (const line of result.inpatient.lines.filter((l) => l.active)) {
      assert.ok(
        staffDetail.includes(`${line.label}: ${line.nights} nights`),
        `${line.label} is missing from the detail`
      )
    }
    assert.match(staffDetail, /IOP Services: 30 units/)
  })

  test('both waterfalls are reproduced line by line', () => {
    const { staffDetail, result } = outputFor()
    assert.match(staffDetail, /INPATIENT WATERFALL/)
    assert.match(staffDetail, /OUTPATIENT WATERFALL/)
    assert.ok(
      staffDetail.includes(`Estimated total deposit: $${result.grandTotal.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`),
      'the detail must carry the same total as the note'
    )
  })

  test('a bundled INN agreement says which lines it zeroed', () => {
    const { staffDetail } = outputFor({
      carrier: 'Oxford',
      treatmentSequence: 'IOP',
      bundledInnIop: 'Yes',
    })
    assert.match(staffDetail, /Bundled INN IOP agreement/)
    assert.match(staffDetail, /Individual Therapy:.*bundled into IOP/)
  })
})

describe('the client explanation', () => {
  test('it explains each charge the client actually has', () => {
    const { clientExplanation } = outputFor({
      copayAmount: '50',
      copayBasis: COPAY_BASIS.PROFESSIONAL_ONLY,
      copayTreatment: COPAY_TREATMENT.ADD,
      copayAppliesToDeductible: 'No',
      copayAppliesToOop: 'Yes',
      admissionFees: { ...BASE.admissionFees, detox: '250' },
    })
    assert.match(clientExplanation, /deductible/)
    assert.match(clientExplanation, /Your share is 20%/)
    assert.match(clientExplanation, /copay/)
    assert.match(clientExplanation, /admission fee of \$250/)
    assert.match(clientExplanation, /out-of-pocket maximum stops at \$40,000/)
  })

  test('it does not explain a charge the client does not have', () => {
    const { clientExplanation } = outputFor()
    assert.doesNotMatch(clientExplanation, /copay/)
    assert.doesNotMatch(clientExplanation, /admission fee/)
  })

  test('it says the deposit and calls it an estimate', () => {
    const { clientExplanation, result } = outputFor()
    assert.ok(
      clientExplanation.includes(`$${Math.round(result.grandTotal).toLocaleString('en-US')} before care begins`),
      'the explanation must quote the same deposit'
    )
    assert.match(clientExplanation, /This is an estimate, not a bill/)
  })
})
