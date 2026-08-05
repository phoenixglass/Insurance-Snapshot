// ─────────────────────────────────────────────────────────────────────────────
// Output generation
//
// Every sentence in here is built from a resolved benefit object produced by
// benefits.js — never directly from an individual form field. That is what
// keeps the staff summary and the client explanation from contradicting each
// other.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BUNDLING,
  COPAY_BASIS,
  RESPONSIBILITY,
  computeCalc,
  computeRemainingExposure,
  contractRateSubject,
  coversWholeAdmission,
  formatCurrency,
  isCombinedAdmission,
  isPerDiemLoc,
  locServiceName,
  locWithin,
  money,
  ownServiceNoun,
  ownServicePricedApart,
  readBenefitConfig,
  resolveContextBenefits,
  serviceUnitLabel,
  unitLabel,
} from './benefits.js'
import { generateCostNote } from './costNote.js'

const BUNDLE_SERVICE_NAMES = {
  IT: 'individual therapy',
  FT: 'family therapy',
  ASSESSMENT: 'assessment',
}

const DISPLAY_NAMES = {
  IT: 'Individual Therapy',
  FT: 'Family Therapy',
  ASSESSMENT: 'Assessment',
  PSYCH: 'Psychiatric Services',
}

function joinList(names) {
  if (names.length > 2) return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  return names.join(' and ')
}

function displayName(r) {
  if (r.service === 'LOC_SERVICE') {
    // The heading only names the LOC's own service where that service collects
    // a different number than its siblings under the same benefit. Otherwise
    // the benefit's copay is what every heading below it says too.
    return ownServicePricedApart(r) && locServiceName(r.contextLoc) !== r.contextLoc
      ? `${r.contextLoc} — ${locServiceName(r.contextLoc)}`
      : r.contextLoc
  }
  return DISPLAY_NAMES[r.service] || r.serviceLabel
}

// "per IOP visit", "per session", "per psychiatric visit", ...
function unitPhrase(r) {
  const noun = unitLabel(r.contextLoc) === 'per day' ? 'day' : 'visit'
  switch (r.service) {
    case 'LOC_SERVICE':
      return `per ${r.contextLoc} ${noun}`
    case 'PSYCH':
      return 'per psychiatric visit'
    case 'IT':
    case 'FT':
      return 'per session'
    case 'ASSESSMENT':
      return 'per assessment'
    default:
      return `per ${noun}`
  }
}

// Client-facing sentences already name the service, so they use the bare unit
// ("per visit") rather than the staff form ("per IOP visit").
const plainUnitPhrase = (r) => serviceUnitLabel(r.service, r.contextLoc)

// Copays are not always charged in the unit the level of care is billed in — a
// per diem stay can carry one copay for the whole admission.
const perAdmissionCopay = (r) => r.copayUnit === 'per admission'
const copayUnitPhrase = (r) => (perAdmissionCopay(r) ? 'per admission' : unitPhrase(r))
const plainCopayUnitPhrase = (r) => (perAdmissionCopay(r) ? 'per admission' : plainUnitPhrase(r))

// The thing a staff sentence is about: "IOP", "psychiatric services", ...
function subjectLabel(r) {
  if (r.service === 'LOC_SERVICE') return r.contextLoc
  switch (r.service) {
    case 'PSYCH':
      return 'psychiatric services'
    case 'IT':
      return 'individual therapy'
    case 'FT':
      return 'family therapy'
    case 'ASSESSMENT':
      return 'assessment'
    default:
      return 'this service'
  }
}

function rateName(network) {
  if (network === 'INN') return 'INN contract rate'
  if (network === 'OON') return 'allowed amount'
  return 'contract rate'
}

function networkWord(network) {
  if (network === 'INN') return 'in-network'
  if (network === 'OON') return 'out-of-network'
  return null
}

// A plan can simply not have an out-of-pocket maximum, and then there is no
// ceiling to collect up to — the instruction is the same, but the sentence that
// normally ends with "until the OOP maximum is reached" has nothing to point at.
const untilOopMax = (data) => (data.noOopMax ? '' : ' until the applicable OOP maximum is reached')

const oopAccumulationLine = (data, text) =>
  data.noOopMax
    ? 'This plan has no out-of-pocket maximum, so these amounts continue for the plan year.'
    : text

// One copay for a detox stay and the residential stay it steps down into. Said
// wherever the amount is, because the staff member quoting it is the one who
// gets asked whether residential starts a second charge.
const ONE_ADMISSION_STAFF_LINE =
  'Detox and residential were authorized as one admission — collect this copay once for the whole stay, not again when the client steps down into residential.'

function deductibleAccumulatorLines(data) {
  const lines = ['Amounts collected apply toward the deductible.']
  if (data.noOopMax) {
    lines.push('This plan has no out-of-pocket maximum, so there is no OOP accumulator to apply them to.')
    return lines
  }
  const structure = data.deductibleOopStructure
  if (structure === 'Combined') {
    lines.push(
      'Because the deductible and OOP maximum are combined, these amounts also apply toward the OOP maximum.'
    )
  } else if (structure === 'Separate') {
    lines.push(
      'The deductible and OOP maximum are tracked separately, so these amounts do not apply toward the OOP maximum.'
    )
  } else {
    lines.push('Confirm whether deductible amounts also apply toward the OOP maximum.')
  }
  return lines
}

// ── Staff-facing collection instructions for one resolved benefit ────────────
function collectionLines(r, data, calc) {
  const lines = []
  const primary = r.service === 'LOC_SERVICE'
  const subject = subjectLabel(r)
  const dedRem = calc.deductibleRemaining !== null ? calc.deductibleRemaining : 0
  const rate = rateName(r.network)

  if (r.service === 'PSYCH') {
    lines.push(
      `Psychiatric services use the OP benefit even while the client is enrolled in ${r.contextLoc}.`
    )
  }

  switch (r.responsibilityType) {
    case RESPONSIBILITY.BUNDLED:
      lines.push(
        isPerDiemLoc(r.contextLoc)
          ? `Included in the ${r.contextLoc} per diem — the day is what is billed.`
          : `Included in the INN ${r.contextLoc} bundle.`
      )
      lines.push('No separate patient responsibility.')
      break

    case RESPONSIBILITY.NONE:
      if (calc.oopSatisfied) {
        lines.push('The out-of-pocket maximum has been met — do not collect for covered services.')
      } else {
        lines.push(`The plan lists no patient responsibility for ${subject} — do not collect.`)
      }
      break

    case RESPONSIBILITY.COPAY:
      lines.push(`Collect ${money(r.amount)} ${copayUnitPhrase(r)}.`)
      if (coversWholeAdmission(r)) lines.push(ONE_ADMISSION_STAFF_LINE)
      lines.push(`Do not collect toward the deductible for ${subject}.`)
      lines.push(
        oopAccumulationLine(
          data,
          primary
            ? `${r.contextLoc} copays apply toward the OOP maximum.`
            : 'These copays apply toward the OOP maximum.'
        )
      )
      break

    case RESPONSIBILITY.COINSURANCE:
      if (r.deductibleApplies) {
        lines.push('The deductible has been met.')
      } else {
        lines.push(`Do not collect toward the deductible for ${subject}.`)
      }
      lines.push(`Collect ${r.coinsurance}% coinsurance${untilOopMax(data)}.`)
      if (r.amountKnown) {
        lines.push(
          `At the ${money(r.contractRate)} ${rate}, that is ${money(r.amount)} ${unitPhrase(r)}.`
        )
      }
      lines.push(
        oopAccumulationLine(data, 'Coinsurance applies toward the OOP maximum, not the deductible.')
      )
      break

    case RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE:
      lines.push(`Collect the applicable ${rate} toward the remaining deductible.`)
      if (r.amountKnown) {
        lines.push(
          r.cappedByDeductible
            ? `The ${money(r.contractRate)} ${rate} exceeds the ${money(dedRem)} remaining deductible — collect ${money(r.amount)} to finish the deductible.`
            : `At the ${money(r.contractRate)} ${rate}, collect ${money(r.amount)} ${unitPhrase(r)} until the deductible is met (${money(dedRem)} remaining).`
        )
      } else {
        lines.push(`${money(dedRem)} of deductible remains.`)
      }
      lines.push(
        `Once the deductible is met, collect ${r.coinsurance}% coinsurance${untilOopMax(data)}.`
      )
      if (r.postDeductibleAmount !== null && r.postDeductibleAmount !== undefined) {
        lines.push(
          `That is ${money(r.postDeductibleAmount)} ${unitPhrase(r)} at the ${money(r.contractRate)} ${rate}.`
        )
      }
      deductibleAccumulatorLines(data).forEach((l) => lines.push(l))
      break

    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      lines.push(`Collect the applicable ${rate} toward the remaining deductible.`)
      if (r.amountKnown) {
        lines.push(
          r.cappedByDeductible
            ? `The ${money(r.contractRate)} ${rate} exceeds the ${money(dedRem)} remaining deductible — collect ${money(r.amount)} to finish the deductible.`
            : `At the ${money(r.contractRate)} ${rate}, collect ${money(r.amount)} ${unitPhrase(r)} until the deductible is met (${money(dedRem)} remaining).`
        )
      } else {
        lines.push(`${money(dedRem)} of deductible remains.`)
      }
      lines.push(
        `Once the deductible is met, collect a ${money(r.postDeductibleAmount)} copay ${copayUnitPhrase(r)}${untilOopMax(data)}.`
      )
      if (coversWholeAdmission(r)) lines.push(ONE_ADMISSION_STAFF_LINE)
      deductibleAccumulatorLines(data).forEach((l) => lines.push(l))
      break

    case RESPONSIBILITY.DEDUCTIBLE:
      lines.push(
        `Collect the applicable ${rate} toward the remaining deductible (${money(dedRem)} remaining).`
      )
      lines.push('No copay or coinsurance applies once the deductible is met.')
      deductibleAccumulatorLines(data).forEach((l) => lines.push(l))
      break

    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      lines.push(`Collect ${money(r.amount)} ${copayUnitPhrase(r)}.`)
      if (coversWholeAdmission(r)) lines.push(ONE_ADMISSION_STAFF_LINE)
      lines.push(
        `The plan also lists ${r.coinsurance}% coinsurance — confirm which applies before quoting a final estimate.`
      )
      lines.push(
        oopAccumulationLine(
          data,
          'Copays and coinsurance apply toward the OOP maximum, not the deductible.'
        )
      )
      break

    default:
      lines.push(
        `Cost sharing for ${subject} is not established on this VOB — confirm with insurance before collecting.`
      )
      break
  }

  ;(r.notes || []).forEach((note) => {
    if (r.responsibilityType !== RESPONSIBILITY.UNKNOWN || !lines.includes(note)) lines.push(note)
  })

  return lines
}

// ── Client-facing sentence for one resolved benefit ──────────────────────────
function clientBenefitLines(r, data, calc) {
  const loc = r.contextLoc
  const dedRem = calc.deductibleRemaining !== null ? calc.deductibleRemaining : 0
  const unit = plainUnitPhrase(r)
  const copayUnit = plainCopayUnitPhrase(r)
  const lines = []
  // Without an out-of-pocket maximum there is nothing for the amount to count
  // toward, so the reassurance that normally follows a price is dropped rather
  // than promised.
  const towardOop = data.noOopMax ? '' : ' These amounts apply toward your out-of-pocket maximum.'
  // The client is the one who hears "per admission" and wonders whether moving
  // to residential means paying it again.
  const oneAdmission = coversWholeAdmission(r)
    ? ' That covers your whole stay, including moving from detox into residential — it is one admission, so the copay is charged once.'
    : ''

  switch (r.responsibilityType) {
    case RESPONSIBILITY.COPAY:
      lines.push(
        `Your ${loc} copay is ${money(r.amount)} ${copayUnit}.${oneAdmission}${towardOop}`
      )
      break
    case RESPONSIBILITY.COINSURANCE:
      lines.push(
        `For ${loc}, you pay ${r.coinsurance}% of the covered charge${
          r.amountKnown ? `, which is about ${money(r.amount)} ${unit} at your plan's contracted rate` : ''
        }.${towardOop}`
      )
      break
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE:
      lines.push(
        `You have ${money(dedRem)} remaining on your deductible. For ${loc}, you pay your plan's contracted rate${
          r.amountKnown ? ` — about ${money(r.amount)} ${unit}` : ''
        } until the deductible is met. After that, you pay ${r.coinsurance}% coinsurance${
          r.postDeductibleAmount !== null && r.postDeductibleAmount !== undefined
            ? `, about ${money(r.postDeductibleAmount)} ${unit}`
            : ''
        }${data.noOopMax ? '' : ', until you reach your out-of-pocket maximum'}.`
      )
      break
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      lines.push(
        `You have ${money(dedRem)} remaining on your deductible. For ${loc}, you pay your plan's contracted rate${
          r.amountKnown ? ` — about ${money(r.amount)} ${unit}` : ''
        } until the deductible is met. After that, your copay is ${money(r.postDeductibleAmount)} ${copayUnit}${data.noOopMax ? '' : ' until you reach your out-of-pocket maximum'}.${oneAdmission}`
      )
      break
    case RESPONSIBILITY.DEDUCTIBLE:
      lines.push(
        `You have ${money(dedRem)} remaining on your deductible. For ${loc}, you pay your plan's contracted rate until the deductible is met. After that, covered ${loc} services are paid in full by your plan.`
      )
      break
    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      lines.push(
        `Your plan lists a ${money(r.amount)} copay ${copayUnit} and ${r.coinsurance}% coinsurance for ${loc}.${oneAdmission} We are confirming which one your plan applies and will review the amount with you before collecting.`
      )
      break
    case RESPONSIBILITY.NONE:
      lines.push(
        calc.oopSatisfied
          ? `You have met your out-of-pocket maximum, so you should not owe a deductible, copay, or coinsurance for covered ${loc} services.`
          : `Your plan does not list a copay, coinsurance, or deductible for covered ${loc} services.`
      )
      break
    default:
      lines.push(
        `We are still confirming how your plan applies cost sharing to ${loc}, and we will review that with you before collecting anything.`
      )
      break
  }

  return lines
}

// Short client-facing phrase used when listing secondary services.
function clientShortPhrase(r, calc) {
  const unit = plainUnitPhrase(r)
  const copayUnit = plainCopayUnitPhrase(r)
  switch (r.responsibilityType) {
    case RESPONSIBILITY.COPAY:
      return `a ${money(r.amount)} copay ${copayUnit}`
    case RESPONSIBILITY.COINSURANCE:
      return `${r.coinsurance}% coinsurance${r.amountKnown ? ` (about ${money(r.amount)} ${unit})` : ''}`
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE:
      return `your plan's contracted rate until the deductible is met, then ${r.coinsurance}% coinsurance`
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      return `your plan's contracted rate until the deductible is met, then a ${money(r.postDeductibleAmount)} copay ${copayUnit}`
    case RESPONSIBILITY.DEDUCTIBLE:
      return `your plan's contracted rate until the deductible is met`
    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      return `a ${money(r.amount)} copay ${copayUnit} (we are confirming whether coinsurance also applies)`
    case RESPONSIBILITY.NONE:
      return calc.oopSatisfied ? 'no cost to you, because your out-of-pocket maximum is met' : 'no cost to you'
    default:
      return 'cost sharing we are still confirming with your plan'
  }
}

function benefitBlockLines(title, config, unit, data) {
  const lines = [`${title}:`]
  // The copay is stated in the unit it is actually charged in. A per diem stay
  // carrying one copay for the admission is not a per-day copay, and printing
  // it as one is the error this whole basis question exists to prevent.
  const perAdmission = config.copayBasis === COPAY_BASIS.PER_ADMISSION
  const copayUnit = perAdmission ? 'per admission' : unit
  lines.push(
    `  Deductible Applies: ${
      data.noDeductible ? 'N/A — this plan has no deductible' : config.deductibleApplies || 'Not specified'
    }`
  )
  lines.push(
    `  Copay: ${
      config.copayNa
        ? 'N/A'
        : config.copay !== null
          ? `${money(config.copay)} ${copayUnit}`
          : 'Not specified'
    }`
  )
  if (perAdmission && isCombinedAdmission(config.loc)) {
    lines.push(
      '  Detox and residential are authorized as one admission, so that copay is charged once for the whole stay — stepping down into residential does not start a second admission.'
    )
  }
  const coinsLabel =
    config.deductibleApplies === 'Yes' && config.coinsurance !== null && config.coinsurance > 0
      ? 'Coinsurance After Deductible'
      : 'Coinsurance'
  lines.push(
    `  ${coinsLabel}: ${
      config.coinsuranceNa
        ? 'N/A'
        : config.coinsurance !== null
          ? `${config.coinsurance}%`
          : 'Not specified'
    }`
  )
  if (config.contractRate !== null) {
    // Named, because the rate is for one service and caps that service alone.
    lines.push(
      `  Contract Rate — ${locServiceName(config.loc)}: ${money(config.contractRate)} ${unit}`
    )
    lines.push(
      isPerDiemLoc(config.loc)
        ? `  (This rate is for ${contractRateSubject(config.loc)}. Individual therapy, family therapy, and assessment delivered during the stay are part of the per diem, not separate charges.)`
        : `  (The copay above applies to every service billing under the ${config.loc} benefit. This rate is for ${contractRateSubject(config.loc)} only — it lowers the copay there when it comes in under it, and other services keep the copay because they bill under their own codes at their own rates.)`
    )
  }
  // Only the exclusion is worth a line, and only for the service it was
  // captured about: a service covered over telehealth is just that service, at
  // the cost sharing already stated above it.
  if (config.telehealth === false) {
    lines.push(
      `  ⚠ Telehealth not covered — ${ownServiceNoun(config.loc)} must be attended in person. Telehealth for other services billing under the ${config.loc} benefit was not captured.`
    )
  }
  if (!config.confirmed) {
    lines.push('  ⚠ Not yet confirmed from insurance.')
  }
  return lines
}

function formatDate(value) {
  if (!value) return null
  const parts = value.split('-')
  if (parts.length !== 3) return value
  return `${parts[1]}/${parts[2]}/${parts[0]}`
}

/**
 * Build all three outputs from one form state. They are generated together, and
 * every one of them is built from the same resolved benefits, so the one-line
 * price a staff member reads out cannot disagree with the detail behind it.
 *
 * @returns {{costNote: string, staffSummary: string, clientExplanation: string}}
 */
export function generateSnapshot(data) {
  const calc = computeCalc(data)
  const benefits = resolveContextBenefits(data, calc)
  const primary = benefits.find((b) => b.service === 'LOC_SERVICE') || null
  const secondary = benefits.filter((b) => b.service !== 'LOC_SERVICE')
  const exposure = computeRemainingExposure(data, calc, primary)

  const {
    totalClientPaymentsToOop,
    totalAssistanceToOop,
    totalEpisodeActivityToOop,
    totalEpisodeActivityToDeductible,
    calculatedOopRemaining,
    oopSatisfied,
    deductibleRemaining,
  } = calc

  const loc = data.verifiedLoc
  const unit = unitLabel(loc)

  // The two long-form outputs are written into separate buffers. `lines` points
  // at whichever one is being written, and `blank()` follows it.
  const staff = []
  const client = []
  let lines = staff
  const blank = () => lines.push('')

  lines.push('CLIENT INSURANCE SUMMARY')
  lines.push('═'.repeat(50))
  blank()

  lines.push(`Network: ${data.network || 'Not specified'}`)
  blank()

  if (data.deductibleOopStructure) {
    lines.push(`Deductible/OOP Structure: ${data.deductibleOopStructure}`)
    if (data.deductibleOopStructure === 'Combined') {
      lines.push(
        '  → Amounts applied to the deductible also apply according to the plan\'s configured OOP accumulation rule.'
      )
    } else if (data.deductibleOopStructure === 'Separate') {
      lines.push('  → Deductible and Out-of-Pocket Maximum are tracked independently.')
    }
    blank()
  }

  // Deductible. "This plan has none" is stated as a fact of the plan, not as a
  // $0.00 balance — a zero reads like an accumulator that happens to be met.
  const dedTotal = data.noDeductible || !data.deductibleTotal ? null : parseFloat(data.deductibleTotal)
  const dedMetEntered = data.deductibleMet ? parseFloat(data.deductibleMet) : 0
  const effectiveDedMet =
    dedTotal !== null ? dedTotal - (deductibleRemaining ?? 0) : dedMetEntered
  lines.push('Deductible:')
  if (data.noDeductible) {
    lines.push('  None — this plan does not have a deductible.')
  } else {
    lines.push(`  ${money(effectiveDedMet)} met of ${dedTotal !== null ? money(dedTotal) : 'N/A'}`)
    if (deductibleRemaining !== null) {
      lines.push(`  ${money(deductibleRemaining)} remaining`)
    }
  }
  blank()

  // Out-of-Pocket Max
  const oopTotal = data.noOopMax || !data.oopMaxTotal ? null : parseFloat(data.oopMaxTotal)
  const oopMetVal = data.oopMet ? parseFloat(data.oopMet) : 0
  const effectiveOopMet =
    oopTotal !== null
      ? oopTotal - (calculatedOopRemaining ?? 0)
      : Math.max(oopMetVal, totalEpisodeActivityToOop)
  lines.push('Out-of-Pocket Max:')
  if (data.noOopMax) {
    lines.push('  None — this plan does not have an out-of-pocket maximum.')
    lines.push('  Cost sharing does not stop at a ceiling; it continues for the plan year.')
  } else {
    lines.push(`  ${money(effectiveOopMet)} met of ${oopTotal !== null ? money(oopTotal) : 'N/A'}`)
    if (calculatedOopRemaining !== null) {
      lines.push(`  ${money(calculatedOopRemaining)} remaining`)
    }
    if (oopSatisfied) {
      lines.push('  ✓ OOP MAX MET — no further cost sharing applies to covered services.')
    }
  }
  blank()

  if (data.currentStatus) {
    lines.push('Current Status:')
    lines.push(`  ${data.currentStatus}`)
    blank()
  }

  lines.push('Current / Most Recent LOC:')
  lines.push(`  ${data.currentLoc || 'None'}`)
  blank()

  if (loc) {
    lines.push('Verified Level of Care:')
    lines.push(`  ${loc}`)
    blank()
  }

  // A client sitting in detox on a combined Detox/Resi verification is inside
  // the level of care this VOB priced, so that is not a cross-LOC situation.
  const isCrossLoc =
    (data.currentStatus === 'Currently in treatment' || data.currentStatus === 'Discharged') &&
    data.currentLoc &&
    data.currentLoc !== 'None' &&
    loc &&
    !locWithin(data.currentLoc, loc)
  if (isCrossLoc) {
    lines.push(
      `⚠ ${loc} rules are being used for this agreement, while prior episode financial activity has been carried forward.`
    )
    blank()
  }

  // ── Benefit blocks: one per level of care captured on this plan ───────────
  if (loc) {
    const stored = (data.locBenefits || []).filter((b) => b.loc)
    const primary = stored.find((b) => b.loc === loc)
    const others = stored.filter((b) => b.loc !== loc)

    if (primary) {
      benefitBlockLines(
        `${loc} Benefit (Verified LOC)`,
        readBenefitConfig(data, loc),
        unit,
        data
      ).forEach((l) => lines.push(l))
      blank()
    }

    others.forEach((entry) => {
      const config = readBenefitConfig(data, entry.loc)
      if (!config) return
      // The OP benefit only earns that subtitle where services during the
      // verified LOC actually bill under it. Nothing inside a per diem stay
      // does — the day is what is billed — so there it is just another level of
      // care priced on the same call.
      const title =
        entry.loc === 'OP' && !isPerDiemLoc(loc)
          ? `OP Benefit (used for services that bill under the OP benefit during ${loc})`
          : `${entry.loc} Benefit`
      benefitBlockLines(title, config, unitLabel(entry.loc), data).forEach((l) => lines.push(l))
      blank()
    })

    // A per diem stay has no per-service breakdown to describe: the day is what
    // is billed, so the services delivered inside it are not priced or quoted
    // one at a time. That question only exists for outpatient levels of care.
    if (isPerDiemLoc(loc)) {
      lines.push(`Services During ${loc}:`)
      lines.push(
        '  Billed as a per diem — individual therapy, family therapy, and assessment delivered during the stay are part of the daily rate and are not quoted or collected separately.'
      )
      blank()
    } else if (loc !== 'OP' && data.bundlingModel) {
      lines.push(`Services During ${loc}:`)
      if (data.bundlingModel === BUNDLING.STANDARD) {
        lines.push(
          `  Standard INN bundle — individual therapy, family therapy, and assessment are included in the ${loc} benefit.`
        )
      } else if (data.bundlingModel === BUNDLING.SEPARATE) {
        const source = data.separateServiceBenefit === 'OP benefit' ? 'OP' : loc
        lines.push(
          `  Separate patient responsibility for each service — individual therapy, family therapy, and assessment each generate their own cost share using the ${source} benefit.`
        )
      } else {
        lines.push(
          '  ⚠ Custom / Unsure — per-service responsibility and bundling are UNCONFIRMED for this plan.'
        )
        lines.push(
          '  Do not quote or collect an individual therapy, family therapy, or assessment amount until the plan\'s model is verified with insurance.'
        )
      }
      lines.push('  Psychiatric services always use the OP benefit.')
      blank()
    }
  }

  // ── Episode Financial Activity ────────────────────────────────────────────
  lines.push('Episode Financial Activity:')
  if (data.financialActivities.length === 0) {
    lines.push('  None entered.')
  } else {
    data.financialActivities.forEach((act, i) => {
      blank()
      lines.push(`  ${i + 1}. ${act.activityLoc || 'LOC?'} — ${act.activityStatus || 'Status?'}`)
      if (act.serviceType) {
        const date = formatDate(act.serviceDate)
        const name =
          act.serviceType === 'LOC_SERVICE'
            ? `${act.activityLoc || loc || 'LOC'} service`
            : DISPLAY_NAMES[act.serviceType] || 'Other service'
        lines.push(`     Service: ${name}${date ? ` (${date})` : ''}`)
      } else if (act.serviceDate) {
        lines.push(`     Date: ${formatDate(act.serviceDate)}`)
      }
      lines.push(`     Source Reviewed: ${act.sourceReviewed || 'Not specified'}`)
      lines.push(`     Client Payment Applied: ${money(act.clientPaymentApplied || 0)}`)
      lines.push(
        `     Financial Assistance Applied: ${money(act.financialAssistanceApplied || 0)}`
      )
      lines.push(`     Assistance Type: ${act.assistanceType || 'None'}`)
      lines.push(`     Applies To: ${act.appliesTo || 'Not specified'}`)
      lines.push(`     Counts Toward OOP: ${act.countsTowardOop || 'Not specified'}`)
      lines.push(`     Counts Toward Deductible: ${act.countsTowardDeductible || 'Not specified'}`)
    })
    blank()
    lines.push('  Totals:')
    lines.push(`    Client Payments Applied to OOP: ${money(totalClientPaymentsToOop)}`)
    lines.push(`    Assistance Applied to OOP: ${money(totalAssistanceToOop)}`)
    lines.push(`    Total Episode Activity Applied to OOP: ${money(totalEpisodeActivityToOop)}`)
    lines.push(
      `    Total Episode Activity Applied to Deductible: ${money(totalEpisodeActivityToDeductible)}`
    )
  }
  blank()

  if (data.hasCurrentBalance === 'Yes') {
    lines.push('Current Balance:')
    lines.push(`  Balance Amount: ${money(data.balanceAmount || 0)}`)
    if (data.balanceType) lines.push(`  Balance Type: ${data.balanceType}`)
    lines.push('  Balance Reviewed: Yes')
    blank()
  }

  // ── Expected collection, generated from the resolved benefits ─────────────
  if (primary) {
    if (secondary.length === 0) {
      lines.push(`Expected ${loc} Collection:`)
      collectionLines(primary, data, calc).forEach((l) => lines.push(`  ${l}`))
    } else {
      lines.push(`Expected Collection While Client Is In ${loc}:`)
      benefits.forEach((b) => {
        blank()
        lines.push(`  ${displayName(b)}:`)
        collectionLines(b, data, calc).forEach((l) => lines.push(`    ${l}`))
      })
    }
    blank()
  }

  // ── Remaining OOP exposure (a cap, not a bill) ────────────────────────────
  if (loc) {
    lines.push('Remaining OOP Exposure:')
    // With no out-of-pocket maximum there is no cap to report. Printing the
    // computed $0.00 would read as "nothing left to collect", which is the
    // opposite of what a plan without a ceiling means.
    if (data.noOopMax) {
      lines.push('  This plan has no out-of-pocket maximum — cost sharing continues for the plan year.')
    } else {
      lines.push(
        `  ${money(exposure.oopRemaining)} remains before the client's OOP maximum is reached.`
      )
    }
    if (
      data.deductibleOopStructure === 'Separate' &&
      primary &&
      primary.deductibleApplies &&
      exposure.deductibleRemaining > 0
    ) {
      lines.push(
        `  ${money(exposure.deductibleRemaining)} of deductible remains and is tracked separately from the OOP maximum.`
      )
      lines.push(`  Combined remaining exposure: ${money(exposure.locExposure)}.`)
    }
    if (exposure.currentBalance > 0) {
      const balanceLabel = data.balanceType
        ? `Existing balance (${data.balanceType})`
        : 'Existing balance'
      lines.push(
        `  ${balanceLabel}: ${money(exposure.currentBalance)} — separate from insurance cost sharing.`
      )
    }
    blank()
  }

  // ── Final Check ───────────────────────────────────────────────────────────
  lines.push('Final Check:')
  lines.push(`  Deductible/OOP reviewed: ${data.deductibleOopReviewed ? 'Yes' : 'No'}`)
  lines.push(`  Network confirmed: ${data.networkConfirmed ? 'Yes' : 'No'}`)
  lines.push(`  LOC rules entered: ${data.locRulesEntered ? 'Yes' : 'No'}`)
  lines.push(
    `  Episode financial activity reviewed: ${
      data.financialActivities.length > 0 ? (data.episodeActivityReviewed ? 'Yes' : 'No') : 'N/A'
    }`
  )
  lines.push(
    `  Balance reviewed: ${
      data.hasCurrentBalance === 'Yes' ? (data.balanceReviewed ? 'Yes' : 'No') : 'N/A'
    }`
  )

  // ── Client-Facing Explanation ─────────────────────────────────────────────
  lines = client

  lines.push("Here's how your insurance is working:")
  blank()

  // Not having a deductible or an out-of-pocket maximum is something the client
  // needs said plainly — the first is good news, the second is not, and leaving
  // either one unmentioned invites them to assume the usual arrangement.
  if (data.noDeductible && data.noOopMax) {
    lines.push(
      'Your plan does not have a deductible or an out-of-pocket maximum. There is nothing to meet before coverage starts, and there is no yearly ceiling where your cost sharing stops.'
    )
    blank()
  } else if (data.noDeductible && oopTotal !== null) {
    lines.push(
      `Your plan does not have a deductible, so there is nothing to meet before your coverage starts. It has a ${money(oopTotal)} out-of-pocket maximum.`
    )
    blank()
  } else if (data.noOopMax && dedTotal !== null) {
    lines.push(
      `Your plan has a ${money(dedTotal)} deductible and does not have an out-of-pocket maximum, so your cost sharing continues through the plan year rather than stopping at a yearly ceiling.`
    )
    blank()
  } else if (dedTotal !== null && oopTotal !== null) {
    lines.push(
      `Your plan has a ${money(dedTotal)} deductible and a ${money(oopTotal)} out-of-pocket maximum.`
    )
    blank()
  }

  if (dedTotal !== null && deductibleRemaining !== null) {
    lines.push(
      deductibleRemaining === 0
        ? `You have met your ${money(dedTotal)} deductible.`
        : `You have met ${money(effectiveDedMet)} of your deductible, leaving ${money(deductibleRemaining)} remaining.`
    )
    blank()
  }

  if (oopTotal !== null && calculatedOopRemaining !== null) {
    lines.push(
      calculatedOopRemaining === 0
        ? `You have met your ${money(oopTotal)} out-of-pocket maximum.`
        : `You have met ${money(effectiveOopMet)} of your out-of-pocket maximum, leaving ${money(calculatedOopRemaining)} remaining.`
    )
    blank()
  }

  if (data.deductibleOopStructure === 'Separate') {
    lines.push('Your deductible and out-of-pocket maximum are tracked separately.')
    blank()
  }

  if (primary) {
    // Only worth saying where the plan has a deductible to apply. On a plan
    // without one it reads as a per-benefit exception rather than the fact,
    // already stated above, that there is no deductible at all.
    if (!data.noDeductible) {
      if (primary.deductibleApplies === true) {
        lines.push(`For ${loc}, your deductible applies.`)
        blank()
      } else if (primary.deductibleApplies === false) {
        lines.push(`For ${loc}, your deductible does not apply.`)
        blank()
      }
    }

    clientBenefitLines(primary, data, calc).forEach((l) => {
      lines.push(l)
      blank()
    })

    // Said only where the plan excludes it, and only about the service it was
    // captured for. "Telehealth is covered" would be describing the benefit the
    // client was just quoted, at the same cost.
    if (primary.telehealth === false) {
      lines.push(
        `Your plan does not cover ${ownServiceNoun(loc, { lower: true })} over telehealth, so those need to be attended in person to be covered.`
      )
      blank()
    }
  }

  // Bundled services — one sentence covering everything included in the bundle.
  const bundledServices = secondary.filter((b) => b.responsibilityType === RESPONSIBILITY.BUNDLED)
  if (bundledServices.length > 0) {
    const names = bundledServices.map((b) => BUNDLE_SERVICE_NAMES[b.service] || b.serviceLabel)
    lines.push(
      `Your ${loc} program benefit includes ${joinList(names)}, so there is no separate charge for those visits.`
    )
    blank()
  }

  // Services that carry their own cost share.
  const separateServices = secondary.filter(
    (b) => b.responsibilityType !== RESPONSIBILITY.BUNDLED && b.service !== 'PSYCH'
  )
  separateServices
    .filter((b) => b.responsibilityType !== RESPONSIBILITY.UNKNOWN)
    .forEach((b) => {
      const name = BUNDLE_SERVICE_NAMES[b.service] || b.serviceLabel
      lines.push(
        `${name.charAt(0).toUpperCase()}${name.slice(1)} visits are billed separately under this plan: ${clientShortPhrase(b, calc)}.`
      )
      blank()
    })

  // Never imply a bundling arrangement that has not been verified.
  const unconfirmedServices = separateServices.filter(
    (b) => b.responsibilityType === RESPONSIBILITY.UNKNOWN
  )
  if (unconfirmedServices.length > 0) {
    const names = unconfirmedServices.map((b) => BUNDLE_SERVICE_NAMES[b.service] || b.serviceLabel)
    lines.push(
      `We are still confirming with your plan how ${joinList(names)} visits are covered during ${loc} — whether they are included in your ${loc} benefit or billed separately. We will review those amounts with you before collecting anything for them.`
    )
    blank()
  }

  const psych = secondary.find((b) => b.service === 'PSYCH')
  if (psych) {
    if (psych.responsibilityType === RESPONSIBILITY.UNKNOWN) {
      lines.push(
        `Psychiatric visits use your outpatient benefit even while you are in ${loc}. We are still confirming that benefit with your plan.`
      )
    } else {
      lines.push(
        `Psychiatric visits use your outpatient benefit even while you are in ${loc}: ${clientShortPhrase(psych, calc)}.`
      )
    }
    blank()
  }

  // Episode financial activity
  if (totalEpisodeActivityToOop > 0) {
    lines.push(
      `So far, ${money(totalEpisodeActivityToOop)} has been applied toward your out-of-pocket maximum based on prior episode financial activity.`
    )
    if (totalClientPaymentsToOop > 0) {
      lines.push(`  - Client payments applied to OOP: ${money(totalClientPaymentsToOop)}`)
    }
    if (totalAssistanceToOop > 0) {
      lines.push(
        `  - Scholarship/hardship/assistance applied to OOP: ${money(totalAssistanceToOop)}`
      )
    }
    blank()
  }

  // Remaining OOP exposure — described as room remaining, not as an amount owed.
  if (calculatedOopRemaining !== null) {
    const nw = networkWord(data.network)
    if (calculatedOopRemaining > 0) {
      lines.push(
        `You currently have ${money(calculatedOopRemaining)} remaining before reaching your out-of-pocket maximum for covered ${nw ? `${nw} ` : ''}services.`
      )
    } else {
      lines.push(
        `You have reached your out-of-pocket maximum for covered ${nw ? `${nw} ` : ''}services.`
      )
    }
    blank()
  }

  if (exposure.currentBalance > 0) {
    lines.push(
      `You also have an existing balance of ${money(exposure.currentBalance)}, which is separate from the cost sharing described above.`
    )
    blank()
  }

  lines.push(
    'If a claim processes differently than expected, we will review the balance and update your account as needed.'
  )

  return {
    costNote: generateCostNote(data),
    staffSummary: staff.join('\n'),
    clientExplanation: client.join('\n'),
  }
}

export { formatCurrency }
