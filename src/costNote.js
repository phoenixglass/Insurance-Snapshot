// ─────────────────────────────────────────────────────────────────────────────
// Cost note — what the person on the phone with the client actually reads out.
//
// The staff summary and the client explanation exist to be complete. This
// output exists to be short. It answers exactly one question per line —
// "what does this cost?" — and says nothing about deductibles, accumulators,
// networks, or episode history unless the client owes money because of it.
//
// Two compression rules do the work:
//   1. A service is only given its own line when its price differs from the
//      level of care it is delivered in. "IOP: no cost." already covers every
//      bundled service, so nothing bundled is ever restated.
//   2. Services that share a price share a line.
//
// Like every other output, each line is built from a resolved benefit object,
// never from a raw form field.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RESPONSIBILITY,
  computeCalc,
  formatCurrency,
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
  PSYCH: 'psychiatric services',
}

// Services priced off a level of care's own benefit. When the client is in OP,
// or would move to OP, these all read from the OP benefit — so they collapse
// into the OP line unless the plan prices them differently.
const OP_CONTEXT_SERVICES = ['IT', 'FT', 'ASSESSMENT']

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
// ("per session") or against a neutral one ("each") when several services that
// bill in different units turn out to cost the same. `copayUnit` is separate
// because a per diem stay can carry a single per-admission copay.
function priceText(r, calc, dedRem, unit, copayUnit) {
  switch (r.responsibilityType) {
    // Bundled and "plan covers it in full" are different facts about the plan,
    // but they are the same fact about the client's wallet, and this output is
    // only about the wallet — so they read identically and collapse together.
    case RESPONSIBILITY.BUNDLED:
    case RESPONSIBILITY.NONE:
      return calc.oopSatisfied ? 'no cost — out-of-pocket max already met' : 'no cost'

    case RESPONSIBILITY.COPAY:
      return `${dollars(r.amount)} copay ${copayUnit}`

    case RESPONSIBILITY.COINSURANCE:
      return r.amountKnown
        ? `${dollars(r.amount)} ${unit}`
        : `${r.coinsurance}% of the contracted rate ${unit}`

    case RESPONSIBILITY.DEDUCTIBLE:
      return `${amountOrRate(r, unit)} until the deductible is met (${dollars(dedRem)} left), then no cost`

    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      return `${amountOrRate(r, unit)} until the deductible is met (${dollars(dedRem)} left), then ${dollars(r.postDeductibleAmount)} ${copayUnit}`

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

// A price in both renderings: `text` for a line of its own, `key` for deciding
// whether two services actually cost the same thing.
// "Per session" and "per assessment" are two words for one encounter, so they
// neutralize when comparing prices. "Per admission" is a different denominator
// entirely — one charge covering a whole stay — and must never be treated as
// the same price as a per-encounter charge of the same size.
const comparableCopayUnit = (r) => (r.copayUnit === 'per admission' ? 'per admission' : 'each')

function priceOf(r, calc, dedRem) {
  const unit = serviceUnitLabel(r.service, r.contextLoc)
  const text = priceText(r, calc, dedRem, unit, r.copayUnit || unit)
  if (text === null) return null
  return { text, key: priceText(r, calc, dedRem, 'each', comparableCopayUnit(r)) }
}

// Collapse services that cost the same onto one line, keeping first-seen order.
// A group whose members bill in different units ("per session" vs "per
// assessment") falls back to the neutral rendering rather than splitting into
// one line each — "$50 copay each" beats three lines saying $50.
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
    const note = `${r.contextLoc} — the plan lists a ${dollars(r.copay)} copay, but our contracted rate is ${dollars(r.contractRate)}. We cannot charge more than the contracted rate, so the client pays ${dollars(r.amount)}.`
    if (!capNotes.includes(note)) capNotes.push(note)
  }

  // ── The level of care this VOB was verified for ───────────────────────────
  const benefits = resolveContextBenefits(data, calc)
  const primary = benefits.find((b) => b.service === 'LOC_SERVICE') || null
  const primaryPrice = primary ? priceOf(primary, calc, dedRem) : null

  if (primary) collectCapNote(primary)

  if (primaryPrice !== null) {
    lines.push(`${loc}: ${sentence(primaryPrice.text)}`)
  } else {
    unresolved.push(loc)
  }

  const extras = []
  benefits
    .filter((b) => b.service !== 'LOC_SERVICE')
    .forEach((b) => {
      const noun = SERVICE_NOUN[b.service] || (b.serviceLabel || '').toLowerCase()
      const price = priceOf(b, calc, dedRem)
      collectCapNote(b)
      if (price === null) {
        unresolved.push(`${noun} during ${loc}`)
        return
      }
      // Rule 1: same price as the LOC it happens in — already covered above.
      if (primaryPrice && price.key === primaryPrice.key) return
      extras.push({ noun, price })
    })

  mergeByPrice(extras).forEach(({ nouns, text }) => {
    lines.push(`${capitalize(joinList(nouns))} during ${loc}: ${sentence(text)}`)
  })

  // ── Other levels of care priced on the same verification call ─────────────
  //
  // These are captured so the client can be told what happens if they step up
  // or step down, which is the reason the billing team quotes them at all.
  const otherLocs = (data.locBenefits || []).map((b) => b.loc).filter((l) => l && l !== loc)

  otherLocs.forEach((other) => {
    const keys = other === 'OP' ? ['LOC_SERVICE', ...OP_CONTEXT_SERVICES] : ['LOC_SERVICE']
    const resolvedAll = keys.map((key) => resolveBenefit(data, calc, key, other))
    const locResolved = resolvedAll[0]
    const locPrice = priceOf(locResolved, calc, dedRem)
    collectCapNote(locResolved)

    if (locPrice === null) {
      unresolved.push(other)
      return
    }

    const block = [`  ${other}: ${sentence(locPrice.text)}`]
    const others = []
    resolvedAll.slice(1).forEach((r) => {
      const price = priceOf(r, calc, dedRem)
      collectCapNote(r)
      if (price === null || price.key === locPrice.key) return
      others.push({ noun: SERVICE_NOUN[r.service] || (r.serviceLabel || '').toLowerCase(), price })
    })
    mergeByPrice(others).forEach(({ nouns, text }) => {
      block.push(`  ${capitalize(joinList(nouns))}: ${sentence(text)}`)
    })

    separate()
    lines.push(`If the client moves to ${other}:`)
    block.forEach((l) => lines.push(l))
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
    capNotes.forEach((n) => lines.push(`Note: ${n}`))
  }

  return lines.join('\n')
}
