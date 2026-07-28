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
  RESPONSIBILITY,
  computeCalc,
  computeRemainingExposure,
  formatCurrency,
  money,
  readBenefitConfig,
  resolveContextBenefits,
  unitLabel,
} from './benefits.js'

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

function displayName(r) {
  if (r.service === 'LOC_SERVICE') return r.contextLoc
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
function plainUnitPhrase(r) {
  switch (r.service) {
    case 'IT':
    case 'FT':
      return 'per session'
    case 'ASSESSMENT':
      return 'per assessment'
    default:
      return unitLabel(r.contextLoc)
  }
}

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

function deductibleAccumulatorLines(structure) {
  const lines = ['Amounts collected apply toward the deductible.']
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
  const structure = data.deductibleOopStructure
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
      lines.push(`Included in the INN ${r.contextLoc} bundle.`)
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
      lines.push(`Collect ${money(r.amount)} ${unitPhrase(r)}.`)
      lines.push(`Do not collect toward the deductible for ${subject}.`)
      lines.push(
        primary
          ? `${r.contextLoc} copays apply toward the OOP maximum.`
          : 'These copays apply toward the OOP maximum.'
      )
      break

    case RESPONSIBILITY.COINSURANCE:
      if (r.deductibleApplies) {
        lines.push('The deductible has been met.')
      } else {
        lines.push(`Do not collect toward the deductible for ${subject}.`)
      }
      lines.push(
        `Collect ${r.coinsurance}% coinsurance until the applicable OOP maximum is reached.`
      )
      if (r.amountKnown) {
        lines.push(
          `At the ${money(r.contractRate)} ${rate}, that is ${money(r.amount)} ${unitPhrase(r)}.`
        )
      }
      lines.push('Coinsurance applies toward the OOP maximum, not the deductible.')
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
        `Once the deductible is met, collect ${r.coinsurance}% coinsurance until the applicable OOP maximum is reached.`
      )
      if (r.postDeductibleAmount !== null && r.postDeductibleAmount !== undefined) {
        lines.push(
          `That is ${money(r.postDeductibleAmount)} ${unitPhrase(r)} at the ${money(r.contractRate)} ${rate}.`
        )
      }
      deductibleAccumulatorLines(structure).forEach((l) => lines.push(l))
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
        `Once the deductible is met, collect a ${money(r.copay)} copay ${unitPhrase(r)} until the applicable OOP maximum is reached.`
      )
      deductibleAccumulatorLines(structure).forEach((l) => lines.push(l))
      break

    case RESPONSIBILITY.DEDUCTIBLE:
      lines.push(
        `Collect the applicable ${rate} toward the remaining deductible (${money(dedRem)} remaining).`
      )
      lines.push('No copay or coinsurance applies once the deductible is met.')
      deductibleAccumulatorLines(structure).forEach((l) => lines.push(l))
      break

    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      lines.push(`Collect ${money(r.copay)} ${unitPhrase(r)}.`)
      lines.push(
        `The plan also lists ${r.coinsurance}% coinsurance — confirm which applies before quoting a final estimate.`
      )
      lines.push('Copays and coinsurance apply toward the OOP maximum, not the deductible.')
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
  const lines = []

  switch (r.responsibilityType) {
    case RESPONSIBILITY.COPAY:
      lines.push(
        `Your ${loc} copay is ${money(r.amount)} ${unit}. These copays apply toward your out-of-pocket maximum.`
      )
      break
    case RESPONSIBILITY.COINSURANCE:
      lines.push(
        `For ${loc}, you pay ${r.coinsurance}% of the covered charge${
          r.amountKnown ? `, which is about ${money(r.amount)} ${unit} at your plan's contracted rate` : ''
        }. These amounts apply toward your out-of-pocket maximum.`
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
        }, until you reach your out-of-pocket maximum.`
      )
      break
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      lines.push(
        `You have ${money(dedRem)} remaining on your deductible. For ${loc}, you pay your plan's contracted rate${
          r.amountKnown ? ` — about ${money(r.amount)} ${unit}` : ''
        } until the deductible is met. After that, your copay is ${money(r.copay)} ${unit} until you reach your out-of-pocket maximum.`
      )
      break
    case RESPONSIBILITY.DEDUCTIBLE:
      lines.push(
        `You have ${money(dedRem)} remaining on your deductible. For ${loc}, you pay your plan's contracted rate until the deductible is met. After that, covered ${loc} services are paid in full by your plan.`
      )
      break
    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      lines.push(
        `Your plan lists a ${money(r.copay)} copay ${unit} and ${r.coinsurance}% coinsurance for ${loc}. We are confirming which one your plan applies and will review the amount with you before collecting.`
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
  switch (r.responsibilityType) {
    case RESPONSIBILITY.COPAY:
      return `a ${money(r.amount)} copay ${unit}`
    case RESPONSIBILITY.COINSURANCE:
      return `${r.coinsurance}% coinsurance${r.amountKnown ? ` (about ${money(r.amount)} ${unit})` : ''}`
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE:
      return `your plan's contracted rate until the deductible is met, then ${r.coinsurance}% coinsurance`
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      return `your plan's contracted rate until the deductible is met, then a ${money(r.copay)} copay ${unit}`
    case RESPONSIBILITY.DEDUCTIBLE:
      return `your plan's contracted rate until the deductible is met`
    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      return `a ${money(r.copay)} copay ${unit} (we are confirming whether coinsurance also applies)`
    case RESPONSIBILITY.NONE:
      return calc.oopSatisfied ? 'no cost to you, because your out-of-pocket maximum is met' : 'no cost to you'
    default:
      return 'cost sharing we are still confirming with your plan'
  }
}

function benefitBlockLines(title, config, unit) {
  const lines = [`${title}:`]
  lines.push(`  Deductible Applies: ${config.deductibleApplies || 'Not specified'}`)
  lines.push(
    `  Copay: ${
      config.copayNa ? 'N/A' : config.copay !== null ? `${money(config.copay)} ${unit}` : 'Not specified'
    }`
  )
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
    lines.push(`  Contract Rate: ${money(config.contractRate)} ${unit}`)
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

export function generateExplanation(data) {
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
  const lines = []
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

  // Deductible
  const dedTotal = data.deductibleTotal ? parseFloat(data.deductibleTotal) : null
  const dedMetEntered = data.deductibleMet ? parseFloat(data.deductibleMet) : 0
  const effectiveDedMet =
    dedTotal !== null ? dedTotal - (deductibleRemaining ?? 0) : dedMetEntered
  lines.push('Deductible:')
  lines.push(
    `  ${money(effectiveDedMet)} met of ${dedTotal !== null ? money(dedTotal) : 'N/A'}`
  )
  if (deductibleRemaining !== null) {
    lines.push(`  ${money(deductibleRemaining)} remaining`)
  }
  blank()

  // Out-of-Pocket Max
  const oopTotal = data.oopMaxTotal ? parseFloat(data.oopMaxTotal) : null
  const oopMetVal = data.oopMet ? parseFloat(data.oopMet) : 0
  const effectiveOopMet =
    oopTotal !== null
      ? oopTotal - (calculatedOopRemaining ?? 0)
      : Math.max(oopMetVal, totalEpisodeActivityToOop)
  lines.push('Out-of-Pocket Max:')
  lines.push(`  ${money(effectiveOopMet)} met of ${oopTotal !== null ? money(oopTotal) : 'N/A'}`)
  if (calculatedOopRemaining !== null) {
    lines.push(`  ${money(calculatedOopRemaining)} remaining`)
  }
  if (oopSatisfied) {
    lines.push('  ✓ OOP MAX MET — no further cost sharing applies to covered services.')
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

  const isCrossLoc =
    (data.currentStatus === 'Currently in treatment' || data.currentStatus === 'Discharged') &&
    data.currentLoc &&
    data.currentLoc !== 'None' &&
    loc &&
    data.currentLoc !== loc
  if (isCrossLoc) {
    lines.push(
      `⚠ ${loc} rules are being used for this agreement, while prior episode financial activity has been carried forward.`
    )
    blank()
  }

  // ── Benefit blocks (resolved configuration, not raw fields) ────────────────
  if (loc) {
    const locConfig = readBenefitConfig(data, 'LOC')
    benefitBlockLines(`${loc} Benefit`, locConfig, unit).forEach((l) => lines.push(l))
    blank()

    if (data.opBenefitEnabled && loc !== 'OP') {
      const opConfig = readBenefitConfig(data, 'OP')
      if (opConfig) {
        benefitBlockLines(
          `OP Benefit (used for services that bill under the OP benefit during ${loc})`,
          opConfig,
          'per visit'
        ).forEach((l) => lines.push(l))
        blank()
      }
    }

    if (loc !== 'OP' && data.bundlingModel) {
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
          '  Custom / Unsure — per-service cost sharing must be confirmed with insurance before collecting.'
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
    lines.push(
      `  ${money(exposure.oopRemaining)} remains before the client's OOP maximum is reached.`
    )
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
  blank()
  lines.push('═'.repeat(50))
  blank()

  lines.push("Here's how your insurance is working:")
  blank()

  if (dedTotal !== null && oopTotal !== null) {
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
    if (primary.deductibleApplies === true) {
      lines.push(`For ${loc}, your deductible applies.`)
      blank()
    } else if (primary.deductibleApplies === false) {
      lines.push(`For ${loc}, your deductible does not apply.`)
      blank()
    }

    clientBenefitLines(primary, data, calc).forEach((l) => {
      lines.push(l)
      blank()
    })
  }

  // Bundled services — one sentence covering everything included in the bundle.
  const bundledServices = secondary.filter((b) => b.responsibilityType === RESPONSIBILITY.BUNDLED)
  if (bundledServices.length > 0) {
    const names = bundledServices.map((b) => BUNDLE_SERVICE_NAMES[b.service] || b.serviceLabel)
    const list =
      names.length > 2
        ? `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
        : names.join(' and ')
    lines.push(
      `Your ${loc} program benefit includes ${list}, so there is no separate charge for those visits.`
    )
    blank()
  }

  // Services that carry their own cost share.
  const separateServices = secondary.filter(
    (b) => b.responsibilityType !== RESPONSIBILITY.BUNDLED && b.service !== 'PSYCH'
  )
  separateServices.forEach((b) => {
    const name = BUNDLE_SERVICE_NAMES[b.service] || b.serviceLabel
    lines.push(
      `${name.charAt(0).toUpperCase()}${name.slice(1)} visits are billed separately under this plan: ${clientShortPhrase(b, calc)}.`
    )
    blank()
  })

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

  return lines.join('\n')
}

export { formatCurrency }
