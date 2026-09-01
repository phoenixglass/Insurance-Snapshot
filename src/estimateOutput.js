// ─────────────────────────────────────────────────────────────────────────────
// Estimator output
//
// The estimator's screen is for building a deposit; this is for handing one
// over. Three views of the same estimate, in the order the work needs them:
//
//   Cost Note          — what to read to the client. Short on purpose.
//   Staff Detail       — every number behind it, for the file and for questions.
//   Client Explanation — plain-language wording for "how does my plan work?"
//
// Two rules keep the cost note short:
//
//   1. Money that did not move is not named. A plan with no copay gets no copay
//      line; a sequence with no inpatient stay gets no inpatient line. A zero
//      in front of a client is a number they have to think about for nothing.
//   2. Nothing is described in the abstract. Every line carries the figure it
//      is about, so no sentence needs the one after it to mean anything.
//
// A quote is only as good as the rates under it, so an estimate standing on a
// code nobody has priced leads with a do-not-quote warning rather than a total.
// Every sentence is built from the computed estimate, never from a raw form
// field, which is what keeps the three views from contradicting each other.
// ─────────────────────────────────────────────────────────────────────────────

import {
  ADMISSION_FEE_LOCS,
  COPAY_BASIS,
  COPAY_TREATMENT,
  admissionFeeFor,
  billingLevels,
  formatMoney,
  hasLevelOverrides,
  levelRule,
  sequenceIncludes,
  sequenceLocs,
  toNumber,
} from './estimate.js'

// Cents are noise in a number somebody is about to say out loud, and a deposit
// is quoted in whole dollars. The detail view keeps them, because a line that
// has to be reconciled against a claim needs the exact figure.
const dollars = (n) => formatMoney(n, { decimals: 0 })

const lines = (...parts) => parts.filter((p) => p !== null && p !== undefined).join('\n')

const joinList = (names) =>
  names.length > 2
    ? `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
    : names.join(' and ')

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// How the network reads in a sentence. A carrier with no network established is
// never described as either one.
function networkPhrase(network) {
  if (network === 'INN') return 'in network'
  if (network === 'OON') return 'out of network'
  return ''
}

function headline(form, result) {
  const network = networkPhrase(result.network)
  const carrier = form.carrier || 'Carrier not selected'
  return `${carrier}${network ? ` (${network})` : ''} — ${form.treatmentSequence || 'no treatment sequence selected'}.`
}

// The levels of care an admission fee covers outright: there the fee is the
// client's whole cost share, and saying so is the difference between "$200"
// and "$200 and we will see what else the plan does".
function feeCoveredLevels(form) {
  return billingLevels(form).filter(({ loc }) => levelRule(form, loc).admissionFeeCovers)
}

// The levels of care that actually collect a copay, with the terms they collect
// it under. A copay can belong to one level of care and not the plan, so this
// reads the levels rather than the plan's own cells.
function copayRules(form) {
  return billingLevels(form)
    .map(({ loc, label }) => ({ label, loc, rule: levelRule(form, loc) }))
    .filter(({ rule }) => rule.copayAmount > 0 && rule.copayBasis !== COPAY_BASIS.NA)
}

// What one copay is charged on, said the way it will be collected. The basis is
// the only thing that decides this; the amount is stated with it so the phrase
// stands on its own, and a ceiling is part of the charge rather than a footnote
// to it — "$200 a day" and "$200 a day up to $2,000" are different benefits.
function basisPhrase(rule, units) {
  const upTo = rule.copayMax > 0 ? `, up to ${dollars(rule.copayMax)}` : ''
  switch (rule.copayBasis) {
    case COPAY_BASIS.MANUAL:
      return `${dollars(rule.copayAmount)}, charged once for the episode${upTo}`
    case COPAY_BASIS.PROFESSIONAL_ONLY:
      return `${dollars(rule.copayAmount)} per visit${units > 0 ? `, on ${plural(units, 'visit', 'visits')}` : ''}${upTo}`
    case COPAY_BASIS.PER_UNIT:
      return `${dollars(rule.copayAmount)} per service unit${upTo}`
    default:
      return `${dollars(rule.copayAmount)}${upTo}`
  }
}

// What the copay is charged on, for the client. Where one set of terms covers
// every level collecting it, that is the sentence; where they differ, each
// level is named, because "a copay" that is two different copays is not
// something to leave a client to work out from the total.
function copayPhrase(form, result) {
  const rules = copayRules(form)
  if (rules.length === 0) return null
  const units = result.outpatient.copayUnits
  const distinct = new Set(
    rules.map(({ rule }) => `${rule.copayAmount}|${rule.copayBasis}|${rule.copayMax}`)
  )
  if (distinct.size === 1) return basisPhrase(rules[0].rule, units)
  return rules.map(({ label, rule }) => `${label}: ${basisPhrase(rule, units)}`).join('; ')
}

// The pieces of the client's responsibility, each with what created it.
//
// These are the amounts actually charged, not the ones the waterfall started
// from: a copay credited to the deductible is not collected as deductible too,
// and a copay that replaces coinsurance leaves no coinsurance behind it. A
// piece worth nothing is dropped rather than printed as $0, so the list only
// ever holds money the client is really being asked for.
function components(form, result) {
  const { inpatient, outpatient } = result
  const deductible = inpatient.netDeductible + outpatient.netDeductible
  const coinsurance = inpatient.coinsuranceDue + outpatient.coinsuranceDue
  const copay = inpatient.copay + outpatient.copay
  const fees = inpatient.admissionFees + outpatient.admissionFees
  return { deductible, coinsurance, copay, fees, total: deductible + coinsurance + copay + fees }
}

function componentLines(form, result) {
  const { deductible, coinsurance, copay, fees } = components(form, result)
  const coinsPercent = toNumber(form.coinsurancePercent)
  const copayNote = copayPhrase(form, result)
  const rules = copayRules(form)
  // Said only where it is true of every copay being charged. Where one level
  // replaces coinsurance and another adds to it, the phrase above has already
  // named them, and one clause cannot cover both.
  const replaces =
    copay > 0 && rules.length > 0 && rules.every(({ rule }) => rule.copayReplacesCoinsurance)

  const out = []
  if (deductible > 0) out.push(`  Deductible: ${dollars(deductible)}.`)
  if (coinsurance > 0) {
    out.push(`  Coinsurance, ${coinsPercent}% of the cost after the deductible: ${dollars(coinsurance)}.`)
  }
  if (copay > 0) {
    out.push(
      `  Copay: ${dollars(copay)}${copayNote ? ` — ${copayNote}` : ''}${
        replaces ? ', charged instead of coinsurance' : ''
      }.`
    )
  }
  if (fees > 0) {
    const covered = feeCoveredLevels(form).map(({ label }) => label)
    out.push(
      `  Admission fee: ${dollars(fees)}${
        covered.length > 0
          ? ` — this covers everything in ${joinList(covered)}, with nothing else charged for that care`
          : ''
      }.`
    )
  }
  return out
}

// The levels of care the sequence names, split the way the two waterfalls do.
function locsIn(sequence, keys) {
  return ADMISSION_FEE_LOCS.filter(
    (l) => keys.includes(l.key) && sequenceIncludes(sequence, l.loc)
  ).map((l) => l.label)
}

function costNote(form, result) {
  const { inpatient, outpatient } = result
  const blockers = result.blockers || []

  if (blockers.length > 0) {
    return lines(
      'DO NOT QUOTE — the estimate is not complete.',
      '',
      ...blockers.map((b) => `  ${b}`),
      '',
      'Finish the estimate and generate the output again.'
    )
  }

  const inpatientLocs = locsIn(form.treatmentSequence, ['detox', 'residential'])
  const outpatientLocs = locsIn(form.treatmentSequence, ['opwm', 'php', 'iop', 'op'])
  const award = result.hardship?.active ? result.hardship : null
  // With an award in play the split has to say what the client's money reached,
  // not just what each block costs — otherwise the lines under a $6,000 figure
  // add up to something else entirely.
  const paidOf = (block) =>
    award ? ` — client pays ${dollars(block.clientPays)}, hardship covers ${dollars(block.scholarship)}` : ''
  const split = []
  if (inpatient.active) {
    split.push(
      `  ${joinList(inpatientLocs)}, ${plural(inpatient.totalNights, 'night', 'nights')}: ${dollars(inpatient.deposit)}${paidOf(award?.inpatient ?? {})}.`
    )
  }
  if (outpatient.active) {
    split.push(`  ${joinList(outpatientLocs)}: ${dollars(outpatient.deposit)}${paidOf(award?.outpatient ?? {})}.`)
  }
  if (result.previousBalance > 0) {
    split.push(
      `  Balance already owed: ${dollars(result.previousBalance)}${
        award && award.coversPreviousBalance > 0
          ? ` — hardship covers ${dollars(award.coversPreviousBalance)} of it`
          : ''
      }.`
    )
  }

  const parts = componentLines(form, result)
  // Whatever the pieces add up to above the deposit is the out-of-pocket
  // maximum holding the total down, and it is shown as the subtraction it is
  // rather than left as a gap between a list and the number over it.
  const capped = components(form, result).total - (inpatient.deposit + outpatient.deposit)

  const hardship = result.hardship
  // A hardship award changes what the client is asked for, so the note leads
  // with the figure they actually pay and keeps the full deposit beside it —
  // the award is a decision the program made, not a lower price.
  return lines(
    headline(form, result),
    '',
    hardship?.active && hardship.scholarship > 0
      ? `Deposit: ${dollars(hardship.clientPays)}, after a hardship award of ${dollars(hardship.scholarship)} against a ${dollars(result.grandTotal)} deposit.`
      : `Deposit: ${dollars(result.grandTotal)}.`,
    // One level of care and no prior balance is already the whole story; the
    // split would only restate the number above it.
    split.length > 1 || award ? '' : null,
    split.length > 1 || award ? split.join('\n') : null,
    parts.length > 0 ? '' : null,
    parts.length > 0 ? 'What makes that up:' : null,
    parts.length > 0 ? parts.join('\n') : null,
    // The out-of-pocket maximum is named only where it actually took money off
    // the total — otherwise it is a plan term, not a price.
    capped > 0.5
      ? `  Less the out-of-pocket maximum, which caps what you can owe: −${dollars(capped)}.`
      : null,
    '',
    result.missingRates.length > 0
      ? `Do not quote yet — ${plural(result.missingRates.length, 'service is', 'services are')} priced at $0 because no rate is on file: ${result.missingRates
          .map((r) => `${r.label} (${r.code})`)
          .join(', ')}. The real deposit is higher than the figure above.`
      : null,
    result.estimatedRates.length > 0
      ? `Quote as an estimate — ${result.estimatedRates
          .map((r) => `${r.label} (${r.code})`)
          .join(', ')} ${result.estimatedRates.length === 1 ? 'is' : 'are'} priced from average paid claims rather than a rate for this plan.`
      : null,
    result.missingRates.length > 0 || result.estimatedRates.length > 0 ? '' : null,
    'This is an estimate of the plan’s cost share for the care listed above, not a bill. What is owed in the end follows the care actually delivered.'
  )
}

// ── Staff detail ─────────────────────────────────────────────────────────────

// One level of care's terms, said as a sentence rather than a row of cells: the
// deductible first, then the copay and what it does to everything else.
function levelTerms(form, loc) {
  const rule = levelRule(form, loc)
  if (rule.admissionFeeCovers) {
    return `the ${formatMoney(
      admissionFeeFor(form, loc)
    )} admission fee covers everything delivered here — no deductible, coinsurance or copay`
  }
  const parts = [rule.deductibleApplies ? 'deductible applies' : 'deductible waived']
  if (rule.copayAmount > 0 && rule.copayBasis !== COPAY_BASIS.NA) {
    parts.push(
      `${formatMoney(rule.copayAmount)} copay (${rule.copayBasis.toLowerCase()})${
        rule.copayMax > 0 ? `, up to ${formatMoney(rule.copayMax)}` : ''
      }`
    )
    parts.push(
      rule.copayReplacesCoinsurance ? 'charged instead of coinsurance' : 'charged with coinsurance'
    )
    parts.push(rule.copayToDeductible ? 'credited to the deductible' : 'not credited to the deductible')
    parts.push(
      rule.copayToOop === 'Yes'
        ? 'counts toward the out-of-pocket maximum'
        : rule.copayToOop === 'No'
          ? 'outside the out-of-pocket maximum'
          : 'accumulator treatment not established'
    )
  } else {
    parts.push('no copay')
  }
  return parts.join(', ')
}

// The deductible a block actually charges. A copay credited to it is not
// collected as deductible on top of the copay, so the row says what is left
// after that credit rather than what the deductible run started from.
function deductibleRow(block) {
  const credited = block.deductibleApplied - block.netDeductible
  return `  Deductible applied: ${formatMoney(block.netDeductible)}${
    credited > 0.005 ? ` (a copay was credited with ${formatMoney(credited)} of it)` : ''
  }`
}

// The coinsurance a block actually charges. Where a copay replaced some of it —
// which a level of care can do without the others doing it — the difference is
// named, because a reader reconciling the waterfall will otherwise look for
// coinsurance the estimate computed and never collected.
function coinsuranceRow(block) {
  const replaced = block.coinsurance - block.coinsuranceDue
  return `  Coinsurance: ${formatMoney(block.coinsuranceDue)}${
    replaced > 0.005 ? ` (a copay replaced ${formatMoney(replaced)} of it)` : ''
  }`
}

// The copay a block actually collects. A ceiling that stopped it is named with
// what it stopped, because a copay that is not the nights times the amount is
// otherwise a number the reader cannot reconcile against the stay.
function copayRow(block, label) {
  const stopped = block.copayBeforeMax - block.copay
  return `  ${label}: ${formatMoney(block.copay)}${
    stopped > 0.005 ? ` (a maximum stopped ${formatMoney(stopped)} of it)` : ''
  }`
}

function lineRows(rows) {
  return rows.map(({ label, units, unitNoun, rate, allowed, note }) => {
    const rateText = rate === null ? 'no rate on file' : formatMoney(rate)
    return `  ${label}: ${plural(units, unitNoun, `${unitNoun}s`)} × ${rateText} = ${formatMoney(allowed)}${note ? ` (${note})` : ''}`
  })
}

function staffDetail(form, result) {
  const { inpatient, outpatient } = result
  const blockers = result.blockers || []
  const coinsPercent = toNumber(form.coinsurancePercent)

  const activeInpatient = inpatient.lines.filter((l) => l.active)
  const activeOutpatient = outpatient.lines.filter((l) => l.inSequence)

  return lines(
    'DEPOSIT ESTIMATE — STAFF DETAIL',
    '',
    'PLAN',
    `  Carrier: ${form.carrier || '—'}`,
    `  Network: ${result.network || 'not established'}`,
    `  Treatment sequence: ${form.treatmentSequence || '—'}`,
    result.schedule
      ? `  Contracted schedule: ${result.schedule.label}, effective ${result.schedule.effective}`
      : null,
    result.scheduleSuppressed
      ? `  Contracted schedule not applied: ${result.scheduleSuppressed.label} is an in-network agreement and this plan is ${result.network}`
      : null,
    outpatient.bundled ? '  Bundled INN IOP agreement: individual and family therapy fold into the IOP rate' : null,
    '',
    'ACCUMULATORS AS VERIFIED',
    `  Deductible remaining: ${formatMoney(toNumber(form.deductibleRemaining))}`,
    `  Out-of-pocket maximum remaining: ${formatMoney(toNumber(form.oopmRemaining))}`,
    `  Coinsurance: ${coinsPercent}%`,
    `  Deductible counts toward the out-of-pocket maximum: ${form.deductibleInOopm}`,
    `  Admission fee counts toward the out-of-pocket maximum: ${form.admissionFeeInOopm}`,
    '',
    'COPAY',
    toNumber(form.copayAmount) > 0
      ? lines(
          `  Amount: ${formatMoney(toNumber(form.copayAmount))}`,
          `  Basis: ${form.copayBasis}`,
          `  Maximum: ${
            toNumber(form.copayMax) > 0
              ? `${formatMoney(toNumber(form.copayMax))} for the episode`
              : 'none stated'
          }`,
          `  Treatment: ${form.copayTreatment}${
            form.copayTreatment === COPAY_TREATMENT.REPLACE ? ' — no coinsurance is charged alongside it' : ''
          }`,
          `  Applies to deductible: ${form.copayAppliesToDeductible}`,
          `  Applies to out-of-pocket maximum: ${form.copayAppliesToOop}`
        )
      : hasLevelOverrides(form)
        ? '  None plan-wide — see the level of care rules below.'
        : '  None.',
    '',
    // Where the levels of care are not all on the plan's terms, the terms each
    // one actually ran under are part of the estimate, not a footnote to it: a
    // deposit assembled from two different sets of rules cannot be checked
    // against one of them.
    hasLevelOverrides(form) ? 'LEVEL OF CARE RULES' : null,
    hasLevelOverrides(form)
      ? billingLevels(form)
          .map(({ loc, label }) => `  ${label}: ${levelTerms(form, loc)}`)
          .join('\n')
      : null,
    hasLevelOverrides(form) ? '' : null,
    activeInpatient.length > 0 ? 'INPATIENT LINES' : null,
    activeInpatient.length > 0
      ? lineRows(
          activeInpatient.map((l) => ({
            label: l.label,
            units: l.nights,
            unitNoun: 'night',
            rate: l.rate,
            allowed: l.allowed,
          }))
        ).join('\n')
      : null,
    activeInpatient.length > 0 ? `  Total allowed: ${formatMoney(inpatient.totalAllowed)}` : null,
    activeInpatient.length > 0 ? '' : null,
    activeOutpatient.length > 0 ? 'OUTPATIENT LINES' : null,
    activeOutpatient.length > 0
      ? lineRows(
          activeOutpatient.map((l) => ({
            label: l.label,
            units: l.units,
            unitNoun: 'unit',
            rate: l.rate,
            allowed: l.allowed,
            note: l.bundledOut
              ? 'bundled into IOP — no cost'
              : l.coveredByFee
                ? `covered by the ${l.deliveredIn} admission fee`
                : undefined,
          }))
        ).join('\n')
      : null,
    activeOutpatient.length > 0 ? `  Total allowed: ${formatMoney(outpatient.totalAllowed)}` : null,
    activeOutpatient.length > 0 ? '' : null,
    inpatient.active ? 'INPATIENT WATERFALL' : null,
    inpatient.active
      ? lines(
          `  Allowed cost (${plural(inpatient.totalNights, 'night', 'nights')}): ${formatMoney(inpatient.totalAllowed)}`,
          deductibleRow(inpatient),
          coinsuranceRow(inpatient),
          copayRow(inpatient, 'Copay'),
          `  Admission fee: ${formatMoney(inpatient.admissionFees)}`,
          `  Before the out-of-pocket cap: ${formatMoney(inpatient.beforeCap)}`,
          `  After the out-of-pocket cap: ${formatMoney(inpatient.afterCap)}`,
          `  Inpatient deposit: ${formatMoney(inpatient.deposit)}`,
          `  Estimated revenue: ${formatMoney(inpatient.revenue)}`
        )
      : null,
    inpatient.active ? '' : null,
    outpatient.active ? 'OUTPATIENT WATERFALL' : null,
    outpatient.active
      ? lines(
          `  Allowed cost: ${formatMoney(outpatient.totalAllowed)}`,
          `  Deductible remaining at entry: ${formatMoney(outpatient.deductibleAtEntry)}`,
          `  Out-of-pocket remaining at entry: ${formatMoney(outpatient.oopAtEntry)}`,
          deductibleRow(outpatient),
          coinsuranceRow(outpatient),
          copayRow(
            outpatient,
            `Copay${outpatient.copayUnits > 0 ? ` (${plural(outpatient.copayUnits, 'unit', 'units')})` : ''}`
          ),
          `  Admission fee: ${formatMoney(outpatient.admissionFees)}`,
          `  Before the out-of-pocket cap: ${formatMoney(outpatient.beforeCap)}`,
          `  After the out-of-pocket cap: ${formatMoney(outpatient.afterCap)}`,
          `  Outpatient deposit: ${formatMoney(outpatient.deposit)}`,
          `  Estimated revenue: ${formatMoney(outpatient.revenue)}`
        )
      : null,
    outpatient.active ? '' : null,
    'TOTALS',
    `  Total allowed cost: ${formatMoney(result.totalAllowed)}`,
    result.previousBalance > 0 ? `  Previous balance: ${formatMoney(result.previousBalance)}` : null,
    `  Estimated total deposit: ${formatMoney(result.grandTotal)}`,
    `  Estimated revenue after the client's responsibility: ${formatMoney(result.totalRevenue)}`,
    result.hardship?.active ? '' : null,
    result.hardship?.active ? 'HARDSHIP ALLOCATION' : null,
    result.hardship?.active
      ? lines(
          `  Total the client can afford: ${formatMoney(result.hardship.canAfford)}`,
          ...result.hardship.rows.map(
            (r) =>
              `  ${r.label}: owes ${formatMoney(r.responsibility)}, pays ${formatMoney(r.clientPays)}, hardship ${formatMoney(r.scholarship)}`
          ),
          `  Client pays: ${formatMoney(result.hardship.clientPays)}`,
          `  Hardship award: ${formatMoney(result.hardship.scholarship)} (${(result.hardship.scholarshipPercent * 100).toFixed(1)}% of the deposit)`,
          result.hardship.coversPreviousBalance > 0
            ? `  Includes ${formatMoney(result.hardship.coversPreviousBalance)} of the balance already owed`
            : null,
          result.hardship.surplus > 0
            ? `  Affordability exceeds the deposit by ${formatMoney(result.hardship.surplus)} — no hardship required`
            : null
        )
      : null,
    result.missingRates.length > 0 ? '' : null,
    result.missingRates.length > 0 ? 'NO RATE ON FILE — THE TOTAL ABOVE IS UNDERSTATED' : null,
    result.missingRates.length > 0
      ? result.missingRates
          .map(
            (r) =>
              `  ${r.label} (${r.code})${r.uncontracted ? ' — billed but not contracted at this location' : ''}${
                r.benchmark !== null ? `, ${formatMoney(r.benchmark)} average across carriers` : ''
              }`
          )
          .join('\n')
      : null,
    result.estimatedRates.length > 0 ? '' : null,
    result.estimatedRates.length > 0 ? 'PRICED FROM AVERAGE PAID CLAIMS, NOT A STATED RATE' : null,
    result.estimatedRates.length > 0
      ? result.estimatedRates.map((r) => `  ${r.label} (${r.code})`).join('\n')
      : null,
    blockers.length > 0 ? '' : null,
    blockers.length > 0 ? 'NOT READY TO QUOTE' : null,
    blockers.length > 0 ? blockers.map((b) => `  ${b}`).join('\n') : null
  )
}

// ── Client explanation ───────────────────────────────────────────────────────

function clientExplanation(form, result) {
  const { deductible, coinsurance, copay, fees } = components(form, result)
  const coinsPercent = toNumber(form.coinsurancePercent)
  const oopRemaining = toNumber(form.oopmRemaining)
  const copayNote = copayPhrase(form, result)
  const locNames = sequenceLocs(form.treatmentSequence)

  return lines(
    `Here is what we expect your plan to leave you responsible for, based on the benefits we verified with ${form.carrier || 'your carrier'} and the course of care we are planning: ${
      locNames.length > 0 ? joinList(locNames) : 'no levels of care selected yet'
    }.`,
    '',
    result.network === 'OON'
      ? 'Your plan treats us as an out-of-network provider, which means it pays on its own allowed amounts rather than a rate we have agreed with them. That is why the numbers below are larger than they would be with an in-network provider.'
      : result.network === 'INN'
        ? 'We are in network with your plan, so your share is calculated against the rates we have agreed with them rather than our full charges.'
        : null,
    result.network ? '' : null,
    deductible > 0
      ? `Your plan has a deductible — an amount you pay for care before the plan starts paying its share. You have ${dollars(toNumber(form.deductibleRemaining))} of it left this year, and we expect this care to use ${dollars(deductible)} of it.`
      : 'Your deductible is already satisfied for this year, so nothing in this estimate goes toward it.',
    '',
    coinsurance > 0
      ? `After the deductible, your plan pays most of the cost and you pay a share of it. Your share is ${coinsPercent}%, which comes to ${dollars(coinsurance)} across this course of care.`
      : null,
    coinsurance > 0 ? '' : null,
    copay > 0
      ? `Your plan also charges a copay${copayNote ? ` of ${copayNote}` : ''}. Across this course of care that adds up to ${dollars(copay)}.`
      : null,
    copay > 0 ? '' : null,
    fees > 0
      ? feeCoveredLevels(form).length > 0
        ? `There is also an admission fee of ${dollars(fees)}, charged once when you enter a level of care. For ${joinList(
            feeCoveredLevels(form).map(({ label }) => label)
          )} that fee is the whole cost of your care at that level — no deductible, no coinsurance and no copay is charged for anything delivered there.`
        : `There is also an admission fee of ${dollars(fees)}, charged once when you enter a level of care.`
      : null,
    fees > 0 ? '' : null,
    oopRemaining > 0
      ? `Everything your plan counts toward your out-of-pocket maximum stops at ${dollars(oopRemaining)} — that is the most you can owe this year for covered care. Once you reach it, the plan pays the rest.`
      : null,
    oopRemaining > 0 ? '' : null,
    `Putting that together, we are asking for ${dollars(result.grandTotal)} before care begins.${
      result.previousBalance > 0
        ? ` That figure includes the ${dollars(result.previousBalance)} still outstanding on your account.`
        : ''
    }`,
    result.hardship?.active && result.hardship.scholarship > 0 ? '' : null,
    result.hardship?.active && result.hardship.scholarship > 0
      ? `We have applied a hardship award of ${dollars(result.hardship.scholarship)} to that deposit, so what we are asking you for before care begins is ${dollars(result.hardship.clientPays)}. The award covers our charges for the rest of the care in this plan; it is not a change to what your plan is billed or to the rates behind it.`
      : null,
    '',
    'This is an estimate, not a bill. It is built from what your plan told us today, and the final amount depends on the care you actually receive. If your plan pays differently than it told us it would, we will go through the difference with you rather than simply billing it.'
  )
}

// One estimate, three ways of saying it. `blockers` is what `estimateBlockers`
// returned for the same form: the cost note refuses to quote over them rather
// than printing a total nobody should read out.
export function generateEstimateOutput(form, result, blockers = [], hardship = null) {
  const withBlockers = { ...result, blockers, hardship }
  return {
    costNote: costNote(form, withBlockers),
    staffDetail: staffDetail(form, withBlockers),
    clientExplanation: clientExplanation(form, withBlockers),
  }
}

// ── Reading the staff detail back ────────────────────────────────────────────
//
// The outputs above are plain text, because plain text is what gets pasted into
// the file. The staff detail is also the longest of the three, and dumping it
// into a <pre> reads badly in a narrow column: a price that wraps falls back to
// the left margin, where it lines up under the next label rather than its own.
//
// So the screen lays it out instead, and this reads the text back into the
// shape it was written in. The conventions are this file's own — a section
// heading sits at the left margin, its rows are indented two spaces, and a row
// is `label: value` — so the reader lives next to the writer rather than
// guessing at it from the other side of the app. The text itself is untouched:
// what is copied is exactly what was generated.
//
// A priced line carries its arithmetic in that value (`20 units × $135.00 =
// $2,700.00`), and the amount at the end of it is what the eye is looking for,
// so it comes back separated from the working behind it.

const AMOUNT_ONLY = /^\$-?[\d,]+\.\d{2}$/
const PRICED_LINE = /^(.+) = (\$-?[\d,]+\.\d{2})(?: \((.+)\))?$/

export function parseStaffDetail(text) {
  const blocks = []
  let title = null
  let current = null

  for (const raw of String(text).split('\n')) {
    if (raw.trim() === '') continue
    if (!raw.startsWith('  ')) {
      // The first heading is the document's own title, which the panel around
      // it already carries; everything after it opens a section.
      if (title === null && blocks.length === 0 && current === null) {
        title = raw
        continue
      }
      current = { heading: raw, rows: [] }
      blocks.push(current)
      continue
    }
    if (current === null) {
      current = { heading: null, rows: [] }
      blocks.push(current)
    }

    const line = raw.trim()
    const at = line.indexOf(': ')
    // A row with nothing to the left of a colon is a statement rather than a
    // reading — an unpriced code, a blocker — and stays whole.
    if (at === -1) {
      current.rows.push({ label: null, working: null, value: line, note: null, amount: false })
      continue
    }
    const label = line.slice(0, at)
    const value = line.slice(at + 2)
    const priced = PRICED_LINE.exec(value)
    current.rows.push(
      priced
        ? { label, working: priced[1], value: priced[2], note: priced[3] ?? null, amount: true }
        : { label, working: null, value, note: null, amount: AMOUNT_ONLY.test(value) }
    )
  }

  return { title, blocks }
}
