// ─────────────────────────────────────────────────────────────────────────────
// Cost note — what the person on the phone with the client actually reads out.
//
// The staff summary and the client explanation exist to be complete. This
// output exists to be short. It answers exactly one question per line —
// "what does this cost?" — and says nothing about deductibles, accumulators,
// networks, or episode history unless the client owes money because of it.
//
// The target shape, which the billing team already writes by hand:
//
//   IOP: no cost.
//   Psych services during IOP: $50 copay.
//   OP LOC: Groups $40 copay. All other services $50 copay.
//
// Three compression rules produce it:
//   1. A service is only named when its price differs from the level of care
//      it is delivered in. "IOP: no cost." already covers everything bundled
//      into IOP, so nothing bundled is ever restated.
//   2. Services that cost the same are named together, and when every
//      remaining service costs the same they become "All other services".
//   3. A level of care other than the verified one gets one line, with its
//      services inline — it is reference information, not today's price.
//
// Like every other output, each line is built from a resolved benefit object,
// never from a raw form field.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RESPONSIBILITY,
  computeCalc,
  formatCurrency,
  locServiceName,
  resolveBenefit,
  resolveContextBenefits,
  serviceUnitLabel,
} from './benefits.js'

// Cents are noise in a number somebody is about to say out loud. A whole-dollar
// price reads as "$40"; anything with cents keeps them.
function dollars(value) {
  const n = parseFloat(value)
  if (Number.isNaN(n)) return `$${formatCurrency(value)}`
  return Number.isInteger(n) ? `$${n.toLocaleString('en-US')}` : `$${formatCurrency(n)}`
}

const SERVICE_NOUN = {
  IT: 'individual therapy',
  FT: 'family therapy',
  ASSESSMENT: 'assessment',
  PSYCH: 'psych services',
}

// Services that bill under a level of care's own benefit when the client is in
// that level of care. Under OP they all read from the OP benefit, so they
// collapse together unless the plan prices them differently.
const CONTEXT_SERVICES = ['IT', 'FT', 'ASSESSMENT', 'PSYCH']

// A copay stated without a unit is understood to be per encounter — which is
// how the billing team writes it, and how the client hears it. Only a unit that
// changes the arithmetic is worth the words.
const IMPLIED_UNITS = ['per visit', 'per session', 'per assessment']
const unitSuffix = (unit) => (IMPLIED_UNITS.includes(unit) ? '' : ` ${unit}`)

function joinList(names) {
  if (names.length > 2) return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  return names.join(' and ')
}

const capitalize = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`

const sentence = (s) => (s.endsWith('.') ? s : `${s}.`)

function amountOrRate(r, unit) {
  return r.amountKnown ? `${dollars(r.amount)} ${unit}` : `the full contracted rate ${unit}`
}

// The whole price of one resolved benefit, in as few words as it can honestly
// be said. Returns null when the plan has not established a price — a null is
// never quoted, it is escalated.
//
// Units are injected so the same price can be rendered against its real units
// or against a neutral one ("each") when several services that bill in
// different units turn out to cost the same. `copayUnit` is separate because a
// per diem stay can carry a single per-admission copay.
function priceText(r, calc, dedRem, unit, copayUnit) {
  switch (r.responsibilityType) {
    // Bundled and "plan covers it in full" are different facts about the plan,
    // but they are the same fact about the client's wallet, and this output is
    // only about the wallet — so they read identically and collapse together.
    case RESPONSIBILITY.BUNDLED:
    case RESPONSIBILITY.NONE:
      return calc.oopSatisfied ? 'no cost — out-of-pocket max already met' : 'no cost'

    case RESPONSIBILITY.COPAY:
      return `${dollars(r.amount)} copay${unitSuffix(copayUnit)}`

    case RESPONSIBILITY.COINSURANCE:
      return r.amountKnown
        ? `${dollars(r.amount)} ${unit}`
        : `${r.coinsurance}% of the contracted rate ${unit}`

    case RESPONSIBILITY.DEDUCTIBLE:
      return `${amountOrRate(r, unit)} until the deductible is met (${dollars(dedRem)} left), then no cost`

    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      return `${amountOrRate(r, unit)} until the deductible is met (${dollars(dedRem)} left), then ${dollars(r.postDeductibleAmount)} copay${unitSuffix(copayUnit)}`

    case RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE:
      return `${amountOrRate(r, unit)} until the deductible is met (${dollars(dedRem)} left), then ${
        r.postDeductibleAmount !== null && r.postDeductibleAmount !== undefined
          ? `${dollars(r.postDeductibleAmount)} ${unit}`
          : `${r.coinsurance}% of the contracted rate`
      }`

    // A plan listing both a copay and coinsurance has not told us which one it
    // applies, and "unknown" is unknown. Neither gets a number.
    default:
      return null
  }
}

// "Per session" and "per assessment" are two words for one encounter, so they
// neutralize when comparing prices. "Per admission" is a different denominator
// entirely — one charge covering a whole stay — and must never be treated as
// the same price as a per-encounter charge of the same size.
const comparableCopayUnit = (r) => (r.copayUnit === 'per admission' ? 'per admission' : 'each')

// A price in both renderings: `text` for display, `key` for deciding whether
// two services actually cost the same thing.
function priceOf(r, calc, dedRem) {
  const unit = serviceUnitLabel(r.service, r.contextLoc)
  const text = priceText(r, calc, dedRem, unit, r.copayUnit || unit)
  if (text === null) return null
  return { text, key: priceText(r, calc, dedRem, 'each', comparableCopayUnit(r)) }
}

// Collapse services that cost the same into one entry, keeping first-seen
// order. A group whose members bill in different units falls back to the
// neutral rendering rather than splitting apart.
function mergeByPrice(items) {
  const merged = []
  items.forEach(({ noun, price }) => {
    const existing = merged.find((m) => m.key === price.key)
    if (existing) {
      existing.nouns.push(noun)
      if (existing.text !== price.text) existing.text = price.key
    } else {
      merged.push({ key: price.key, text: price.text, nouns: [noun] })
    }
  })
  return merged
}

// Resolve every service delivered in one level of care into priced groups.
function priceServices(resolved, calc, dedRem, locPrice, onSkip, onResolved) {
  const items = []
  let priced = 0
  resolved.forEach((r) => {
    const noun = SERVICE_NOUN[r.service] || (r.serviceLabel || '').toLowerCase()
    const price = priceOf(r, calc, dedRem)
    onResolved(r)
    if (price === null) {
      onSkip(noun)
      return
    }
    priced += 1
    // Rule 1: same price as the level of care it happens in — already covered.
    if (locPrice && price.key === locPrice.key) return
    items.push({ noun, price })
  })

  // Rule 2: "all other services" is only honest when every service this app
  // models was actually priced. If psych was never captured, a group of the
  // three therapy services is three therapy services — saying "all other
  // services" there would quote a price for a visit nobody priced.
  const coversEverything = priced === CONTEXT_SERVICES.length

  return mergeByPrice(items).map(({ nouns, text }) => ({
    label:
      nouns.length > 1 && nouns.length === priced && coversEverything
        ? 'all other services'
        : joinList(nouns),
    text,
  }))
}

export function generateCostNote(data) {
  const loc = data.verifiedLoc
  if (!loc) return 'Select a Verified LOC to generate a cost note.'

  const calc = computeCalc(data)
  const dedRem = calc.deductibleRemaining !== null ? calc.deductibleRemaining : 0

  const lines = []
  const unresolved = []
  const capNotes = []
  // Blank separators only earn their place between things; nothing starts with one.
  const separate = () => {
    if (lines.length > 0) lines.push('')
  }

  // Staff get asked "insurance told me $50, why are you saying $40?" — answer it
  // in the note rather than making them go find it in the detail view.
  const collectCapNote = (r) => {
    if (!r.cappedByContractRate) return
    const note = `the plan lists a ${dollars(r.copay)} ${r.contextLoc} copay, but our contracted rate for ${locServiceName(r.contextLoc).toLowerCase()} is ${dollars(r.contractRate)}. We cannot charge more than the contracted rate, so ${locServiceName(r.contextLoc).toLowerCase()} are ${dollars(r.amount)}. Every other service under the ${r.contextLoc} benefit bills under its own code and keeps the ${dollars(r.copay)} copay.`
    if (!capNotes.includes(note)) capNotes.push(note)
  }

  // ── The level of care this VOB was verified for ───────────────────────────
  //
  // Today's price, so it gets a line per distinct cost rather than one dense
  // line — this is the part that is actually read out.
  const benefits = resolveContextBenefits(data, calc)
  const primary = benefits.find((b) => b.service === 'LOC_SERVICE') || null
  const primaryPrice = primary ? priceOf(primary, calc, dedRem) : null

  if (primary) collectCapNote(primary)

  if (primaryPrice !== null) {
    // Naming the LOC's own service matters wherever it is one service among
    // several sharing a benefit: "OP: Groups $40 copay", not "OP: $40 copay".
    const ownName = locServiceName(loc)
    const prefix = ownName === loc ? '' : `${ownName} `
    lines.push(`${loc}: ${sentence(`${prefix}${primaryPrice.text}`)}`)
  } else {
    unresolved.push(loc)
  }

  priceServices(
    benefits.filter((b) => b.service !== 'LOC_SERVICE'),
    calc,
    dedRem,
    primaryPrice,
    (noun) => unresolved.push(`${noun} during ${loc}`),
    collectCapNote
  ).forEach(({ label, text }) => {
    lines.push(`${capitalize(label)} during ${loc}: ${sentence(text)}`)
  })

  // ── Other levels of care priced on the same verification call ─────────────
  //
  // Captured so the client can be told what happens if they step up or step
  // down, which is the reason the billing team quotes them at all. Reference
  // information, so each one is a single line with its services inline.
  const otherLocs = (data.locBenefits || []).map((b) => b.loc).filter((l) => l && l !== loc)

  otherLocs.forEach((other) => {
    const locResolved = resolveBenefit(data, calc, 'LOC_SERVICE', other)
    const locPrice = priceOf(locResolved, calc, dedRem)
    collectCapNote(locResolved)

    if (locPrice === null) {
      unresolved.push(other)
      return
    }

    // Only OP prices its ancillary services off its own benefit from here —
    // for any other level of care the bundling model was never captured, so
    // nothing about its therapy visits can be claimed.
    const contextResolved =
      other === 'OP' ? CONTEXT_SERVICES.map((key) => resolveBenefit(data, calc, key, other)) : []

    const ownName = locServiceName(other)
    const parts = [ownName === other ? locPrice.text : `${ownName} ${locPrice.text}`]

    priceServices(contextResolved, calc, dedRem, locPrice, () => {}, collectCapNote).forEach(
      ({ label, text }) => parts.push(`${capitalize(label)} ${text}`)
    )

    lines.push(`${other} LOC: ${parts.map(sentence).join(' ')}`)
  })

  // ── Money the client owes that has nothing to do with cost sharing ────────
  const balance =
    data.hasCurrentBalance === 'Yes' && data.balanceAmount ? parseFloat(data.balanceAmount) : 0
  if (balance > 0) {
    separate()
    lines.push(
      `Existing balance: ${dollars(balance)}. This is owed separately and is not part of the amounts above.`
    )
  }

  // ── Anything that must not be quoted ──────────────────────────────────────
  if (unresolved.length > 0) {
    separate()
    lines.push(
      `⚠ Do not quote a price for ${joinList(unresolved)} — still being confirmed with the plan.`
    )
  }

  // ── Why a number differs from the VOB, for the inevitable question ────────
  if (capNotes.length > 0) {
    separate()
    capNotes.forEach((n) => lines.push(`Note: ${capitalize(n)}`))
  }

  return lines.join('\n')
}
