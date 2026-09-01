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
  formatMoney,
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

// What the copay is actually charged on, said the way it will be collected.
// The basis is the only thing that decides this; the amount is stated with it
// so the sentence stands on its own.
function copayPhrase(form, result) {
  const amount = toNumber(form.copayAmount)
  if (amount <= 0 || form.copayBasis === COPAY_BASIS.NA) return null
  const units = result.outpatient.copayUnits
  switch (form.copayBasis) {
    case COPAY_BASIS.MANUAL:
      return `${dollars(amount)}, charged once for the episode`
    case COPAY_BASIS.PROFESSIONAL_ONLY:
      return `${dollars(amount)} per visit${units > 0 ? `, on ${plural(units, 'visit', 'visits')}` : ''}`
    case COPAY_BASIS.PER_UNIT:
      return `${dollars(amount)} per service unit`
    default:
      return dollars(amount)
  }
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
  const replaces = form.copayTreatment === COPAY_TREATMENT.REPLACE && copay > 0

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
  if (fees > 0) out.push(`  Admission fee: ${dollars(fees)}.`)
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
      ? `Deposit before care begins: ${dollars(hardship.clientPays)}, after a hardship award of ${dollars(hardship.scholarship)} against a ${dollars(result.grandTotal)} deposit.`
      : `Deposit before care begins: ${dollars(result.grandTotal)}.`,
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
          `  Treatment: ${form.copayTreatment}${
            form.copayTreatment === COPAY_TREATMENT.REPLACE ? ' — no coinsurance is charged alongside it' : ''
          }`,
          `  Applies to deductible: ${form.copayAppliesToDeductible}`,
          `  Applies to out-of-pocket maximum: ${form.copayAppliesToOop}`
        )
      : '  None.',
    '',
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
            note: l.bundledOut ? 'bundled into IOP — no cost' : undefined,
          }))
        ).join('\n')
      : null,
    activeOutpatient.length > 0 ? `  Total allowed: ${formatMoney(outpatient.totalAllowed)}` : null,
    activeOutpatient.length > 0 ? '' : null,
    inpatient.active ? 'INPATIENT WATERFALL' : null,
    inpatient.active
      ? lines(
          `  Allowed cost (${plural(inpatient.totalNights, 'night', 'nights')}): ${formatMoney(inpatient.totalAllowed)}`,
          `  Deductible applied: ${formatMoney(inpatient.deductibleApplied)}`,
          `  Coinsurance: ${formatMoney(inpatient.coinsurance)}`,
          `  Copay: ${formatMoney(inpatient.copay)}`,
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
          `  Deductible applied: ${formatMoney(outpatient.deductibleApplied)}`,
          `  Coinsurance: ${formatMoney(outpatient.coinsurance)}`,
          `  Copay${outpatient.copayUnits > 0 ? ` (${plural(outpatient.copayUnits, 'unit', 'units')})` : ''}: ${formatMoney(outpatient.copay)}`,
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
      ? `There is also an admission fee of ${dollars(fees)}, charged once when you enter a level of care.`
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
