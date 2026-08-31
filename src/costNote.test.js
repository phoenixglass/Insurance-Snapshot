// The Snapshot outputs, checked against the numbers that were typed into the
// form.
//
// Three properties matter here, and each has its own section below:
//
//   1. Every price the note quotes is a price somebody entered, or arithmetic
//      on prices somebody entered. The note never invents a number.
//   2. Every price somebody entered reaches the note. A copay captured on a
//      verification call and then dropped is worse than no note at all.
//   3. The cost note, the staff detail and the client explanation are generated
//      from the same resolved benefits, so they cannot quote different numbers.
//
// The sweeps at the bottom check all three across the whole form space rather
// than at hand-picked points, because the failures worth catching are the ones
// nobody thought to write a case for.

import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'

import { BUNDLING, LOC_OPTIONS, RESPONSIBILITY, computeCalc, resolveBenefit } from './benefits.js'
import { generateCostNote } from './costNote.js'
import { generateSnapshot } from './summary.js'

// ── Form builders ────────────────────────────────────────────────────────────

function benefit(loc, o = {}) {
  return {
    id: loc,
    loc,
    deductibleApplies: o.ded ?? 'No',
    copayAmount: o.copay ?? '',
    copayNa: o.copayNa ?? o.copay === undefined,
    copayBasis: o.basis ?? '',
    coinsurancePercent: o.coins ?? '',
    coinsuranceNa: o.coinsNa ?? o.coins === undefined,
    contractRate: o.rate ?? '',
    telehealthCovered: o.tele ?? true,
    confirmed: true,
  }
}

function form(over = {}) {
  return {
    network: 'OON',
    deductibleTotal: '2000',
    deductibleMet: '0',
    noDeductible: false,
    oopMaxTotal: '8000',
    oopMet: '0',
    noOopMax: false,
    deductibleOopStructure: 'Combined',
    currentStatus: 'Not yet admitted',
    currentLoc: 'None',
    verifiedLoc: 'IOP',
    locBenefits: [benefit('IOP', { copay: '75' })],
    bundlingModel: '',
    separateServiceBenefit: '',
    financialActivities: [],
    hasCurrentBalance: 'No',
    balanceAmount: '',
    balanceType: '',
    ...over,
  }
}

const dollarsIn = (text) =>
  new Set([...text.matchAll(/\$([\d,]+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1].replace(/,/g, ''))))

// ── 1. The note quotes what was entered ──────────────────────────────────────

describe('a price reaches the note as entered', () => {
  test('a plain copay', () => {
    const note = generateCostNote(form())
    assert.equal(note.split('\n')[0], 'IOP: $75 copay.')
  })

  test('cents are kept, whole dollars are not padded', () => {
    const note = generateCostNote(form({ locBenefits: [benefit('IOP', { copay: '123.45' })] }))
    assert.match(note, /\$123\.45 copay/)
    assert.doesNotMatch(generateCostNote(form()), /\$75\.00/)
  })

  test('coinsurance against a contracted rate is the product, not the percentage', () => {
    const note = generateCostNote(
      form({ locBenefits: [benefit('IOP', { coins: '20', rate: '300' })] })
    )
    assert.match(note, /\$60 per visit/, '20% of $300')
  })

  test('coinsurance with no rate quotes the percentage rather than guessing', () => {
    const note = generateCostNote(form({ locBenefits: [benefit('IOP', { coins: '20' })] }))
    assert.match(note, /20% of the contracted rate/)
    assert.equal(dollarsIn(note).size, 0, 'no dollar figure can be honestly given')
  })

  test('the deductible phase quotes the rate and what is left of the deductible', () => {
    const note = generateCostNote(
      form({ locBenefits: [benefit('IOP', { ded: 'Yes', rate: '300', copay: '50' })] })
    )
    assert.match(note, /\$300 per visit until the deductible is met \(\$2,000 left\)/)
    assert.match(note, /then \$50 copay/)
  })
})

// ── 2. The contracted-rate cap ───────────────────────────────────────────────

describe('a copay is never collected above the contracted rate', () => {
  test('a rate below the copay prices the level of care’s own service apart', () => {
    const note = generateCostNote(
      form({ verifiedLoc: 'OP', locBenefits: [benefit('OP', { copay: '50', rate: '40' })] })
    )
    assert.match(note, /OP: Groups \$40 copay\./)
    assert.match(note, /All other services during OP: \$50 copay\./)
    assert.match(note, /Note: The plan lists a \$50 OP copay/)
  })

  test('a rate at or above the copay changes nothing', () => {
    const note = generateCostNote(
      form({ verifiedLoc: 'OP', locBenefits: [benefit('OP', { copay: '40', rate: '50' })] })
    )
    assert.equal(note.split('\n')[0], 'OP: $40 copay.')
    assert.doesNotMatch(note, /Groups/, 'nothing prices groups apart from the benefit')
    assert.doesNotMatch(note, /Note:/)
  })

  test('the cap applies to the LOC’s own service only, not to therapy under it', () => {
    const calc = computeCalc(form())
    const data = form({ verifiedLoc: 'OP', locBenefits: [benefit('OP', { copay: '50', rate: '40' })] })
    assert.equal(resolveBenefit(data, calc, 'LOC_SERVICE', 'OP').amount, 40)
    assert.equal(resolveBenefit(data, calc, 'IT', 'OP').amount, 50, 'individual therapy keeps the copay')
  })
})

// ── 3. Per-admission copays ──────────────────────────────────────────────────

describe('a per-admission copay is one charge, not one per day', () => {
  test('the note says so where it is quoted', () => {
    const note = generateCostNote(
      form({
        verifiedLoc: 'Detox/Resi',
        locBenefits: [benefit('Detox/Resi', { copay: '500', basis: 'Per admission' })],
      })
    )
    assert.match(note, /\$500 copay per admission/)
    assert.match(note, /covers the whole stay/)
  })

  test('a per-day copay is quoted per day', () => {
    const note = generateCostNote(
      form({ verifiedLoc: 'Detox', locBenefits: [benefit('Detox', { copay: '500', basis: 'Per day' })] })
    )
    assert.match(note, /\$500 copay per day/)
    assert.doesNotMatch(note, /whole stay/)
  })

  test('a per-day rate does not cap a charge covering the whole admission', () => {
    const data = form({
      verifiedLoc: 'Detox/Resi',
      locBenefits: [benefit('Detox/Resi', { copay: '500', basis: 'Per admission', rate: '400' })],
    })
    const r = resolveBenefit(data, computeCalc(data), 'LOC_SERVICE')
    assert.equal(r.amount, 500, 'a $400 nightly rate is not a ceiling on a $500 stay copay')
  })
})

// ── 4. Accumulators ──────────────────────────────────────────────────────────

describe('accumulators drive what is quoted', () => {
  test('a met out-of-pocket max makes everything free and says why', () => {
    const note = generateCostNote(form({ oopMet: '8000' }))
    assert.match(note, /no cost — out-of-pocket max already met/)
  })

  test('episode activity counts toward the maximum', () => {
    const calc = computeCalc(
      form({
        financialActivities: [
          {
            id: 'a',
            countsTowardOop: 'Yes',
            countsTowardDeductible: 'Yes',
            clientPaymentApplied: '3000',
            financialAssistanceApplied: '500',
          },
        ],
      })
    )
    assert.equal(calc.totalEpisodeActivityToOop, 3500)
    assert.equal(calc.calculatedOopRemaining, 4500)
    assert.equal(calc.deductibleRemaining, 0, '$3,500 covers a $2,000 deductible')
  })

  test('activity that counts toward neither accumulator moves nothing', () => {
    const calc = computeCalc(
      form({
        financialActivities: [
          {
            id: 'a',
            countsTowardOop: 'No',
            countsTowardDeductible: 'No',
            clientPaymentApplied: '3000',
            financialAssistanceApplied: '',
          },
        ],
      })
    )
    assert.equal(calc.calculatedOopRemaining, 8000)
    assert.equal(calc.deductibleRemaining, 2000)
  })

  test('an amount met above the total clamps rather than going negative', () => {
    const calc = computeCalc(form({ deductibleMet: '5000', oopMet: '99999' }))
    assert.equal(calc.deductibleRemaining, 0)
    assert.equal(calc.calculatedOopRemaining, 0)
  })

  test('a plan with no accumulators is not the same as one already met', () => {
    const calc = computeCalc(
      form({ noDeductible: true, deductibleTotal: '', noOopMax: true, oopMaxTotal: '' })
    )
    assert.equal(calc.deductibleRemaining, 0)
    assert.equal(calc.calculatedOopRemaining, null)
    assert.equal(calc.oopSatisfied, false, 'no maximum is not a satisfied maximum')
  })
})

// ── 5. What must not be quoted ───────────────────────────────────────────────

describe('an unestablished price is escalated, never guessed', () => {
  test('a custom bundling model withholds the services it governs', () => {
    const note = generateCostNote(
      form({ network: 'INN', bundlingModel: BUNDLING.CUSTOM })
    )
    assert.match(note, /⚠ Do not quote a price for/)
    assert.match(note, /individual therapy/)
  })

  test('a copay and coinsurance together is not a price', () => {
    const data = form({ locBenefits: [benefit('IOP', { copay: '50', coins: '20' })] })
    const r = resolveBenefit(data, computeCalc(data), 'LOC_SERVICE')
    assert.equal(r.responsibilityType, RESPONSIBILITY.COPAY_AND_COINSURANCE)
    assert.ok(r.notes.some((n) => n.includes('confirm which applies')))
  })

  test('a copay-and-coinsurance benefit is escalated everywhere, not quoted anywhere', () => {
    const data = form({ locBenefits: [benefit('IOP', { copay: '50', coins: '20' })] })
    const note = generateCostNote(data)
    assert.match(note, /⚠ Do not quote a price for IOP/)
    assert.ok(!dollarsIn(note).has(50), 'the copay must not appear as a price')
  })

  test('an uncaptured benefit is never described as "all other services"', () => {
    // With no OP benefit stored, psych has no price, so grouping the three
    // therapy services under "all other services" would quote a psych visit
    // nobody priced.
    const note = generateCostNote(form({ network: 'INN', bundlingModel: BUNDLING.SEPARATE }))
    assert.doesNotMatch(note, /all other services/i)
  })
})

// ── 6. Telehealth ────────────────────────────────────────────────────────────

describe('telehealth is named only where it is excluded', () => {
  test('an excluded service is called out by name', () => {
    const note = generateCostNote(
      form({ verifiedLoc: 'OP', locBenefits: [benefit('OP', { copay: '50', tele: false })] })
    )
    assert.match(note, /Groups are not covered over telehealth/)
  })

  test('a covered service adds no line', () => {
    const note = generateCostNote(form())
    assert.doesNotMatch(note, /telehealth/i)
  })
})

// ── 7. Sweeps across the whole form space ────────────────────────────────────

const COPAY_SHAPES = [
  { copay: '50' },
  { copay: '50', rate: '40' },
  { copay: '40', rate: '50' },
  { copay: '500', basis: 'Per admission' },
  { copay: '500', basis: 'Per day' },
  { coins: '20' },
  { coins: '20', rate: '300' },
  { ded: 'Yes', rate: '300' },
  { ded: 'Yes' },
  { copay: '50', coins: '20' },
  { copay: '123.45', rate: '200' },
  { copay: '75', tele: false },
]

function* everyForm() {
  for (const loc of LOC_OPTIONS) {
    for (const network of ['INN', 'OON']) {
      for (const bundling of ['', BUNDLING.STANDARD, BUNDLING.SEPARATE, BUNDLING.CUSTOM]) {
        for (const shape of COPAY_SHAPES) {
          const locBenefits = [benefit(loc, shape)]
          if (loc !== 'OP') locBenefits.push(benefit('OP', { copay: '35', rate: '80' }))
          yield {
            name: `${loc}/${network}/${bundling || 'no bundling'}/${JSON.stringify(shape)}`,
            data: form({
              network,
              verifiedLoc: loc,
              locBenefits,
              bundlingModel: bundling,
              separateServiceBenefit: bundling === BUNDLING.SEPARATE ? 'OP benefit' : '',
            }),
          }
        }
      }
    }
  }
}

// Every dollar figure the outputs may contain, derived from the form alone.
function permittedAmounts(data) {
  const calc = computeCalc(data)
  const set = new Set([0])
  if (calc.deductibleRemaining !== null) set.add(calc.deductibleRemaining)
  if (calc.calculatedOopRemaining !== null) set.add(calc.calculatedOopRemaining)
  if (data.balanceAmount) set.add(parseFloat(data.balanceAmount))
  for (const b of data.locBenefits) {
    const copay = b.copayNa ? null : parseFloat(b.copayAmount)
    const rate = b.contractRate === '' ? null : parseFloat(b.contractRate)
    const coins = b.coinsuranceNa ? null : parseFloat(b.coinsurancePercent)
    for (const v of [copay, rate]) if (Number.isFinite(v)) set.add(v)
    if (Number.isFinite(copay) && Number.isFinite(rate)) set.add(Math.min(copay, rate))
    if (Number.isFinite(rate) && Number.isFinite(coins)) set.add(Math.round(rate * coins) / 100)
    if (Number.isFinite(rate) && calc.deductibleRemaining !== null) {
      set.add(Math.min(rate, calc.deductibleRemaining))
    }
  }
  return set
}

describe('across every form shape', () => {
  test('the outputs always generate', () => {
    let n = 0
    for (const { name, data } of everyForm()) {
      const snap = generateSnapshot(data)
      for (const key of ['costNote', 'staffSummary', 'clientExplanation']) {
        assert.equal(typeof snap[key], 'string', `${name}: ${key}`)
        assert.ok(snap[key].length > 0, `${name}: ${key} is empty`)
        for (const junk of ['undefined', 'NaN', '[object Object]']) {
          assert.ok(!snap[key].includes(junk), `${name}: ${key} contains "${junk}"`)
        }
      }
      n += 1
    }
    assert.ok(n > 500, `expected a broad sweep, got ${n}`)
  })

  test('no output invents a number', () => {
    for (const { name, data } of everyForm()) {
      const permitted = permittedAmounts(data)
      for (const value of dollarsIn(generateCostNote(data))) {
        assert.ok(
          permitted.has(value),
          `${name}: cost note quotes $${value}, which is not in the form`
        )
      }
    }
  })

  test('the price of the verified level of care always reaches the note', () => {
    for (const { name, data } of everyForm()) {
      const primary = resolveBenefit(data, computeCalc(data), 'LOC_SERVICE')
      const quotable =
        primary.amountKnown &&
        primary.responsibilityType !== RESPONSIBILITY.NONE &&
        primary.responsibilityType !== RESPONSIBILITY.BUNDLED &&
        // A plan listing both a copay and coinsurance has not said which one it
        // charges. The engine records the copay it would collect as working
        // state; nothing is allowed to quote it. See the escalation test below.
        primary.responsibilityType !== RESPONSIBILITY.COPAY_AND_COINSURANCE
      if (!quotable) continue
      assert.ok(
        dollarsIn(generateCostNote(data)).has(primary.amount),
        `${name}: $${primary.amount} was entered but is absent from the note`
      )
    }
  })

  test('the cost note and the staff detail cannot disagree', () => {
    for (const { name, data } of everyForm()) {
      const snap = generateSnapshot(data)
      const staff = dollarsIn(snap.staffSummary)
      for (const value of dollarsIn(snap.costNote)) {
        if (value === 0) continue
        assert.ok(
          staff.has(value),
          `${name}: the note quotes $${value}, the staff detail never mentions it`
        )
      }
    }
  })
})
