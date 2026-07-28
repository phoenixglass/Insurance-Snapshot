// ─────────────────────────────────────────────────────────────────────────────
// Benefit resolution engine
//
// The architectural rule this module exists to enforce:
//
//   current LOC  ≠  verified LOC  ≠  service  ≠  benefit category
//                ≠  bundling rule  ≠  cost-sharing type  ≠  accumulator
//
// Resolve the service first, the benefit category second, patient
// responsibility third, and accumulators fourth. Output (summary.js) is
// generated from the resolved object, never from raw form fields.
// ─────────────────────────────────────────────────────────────────────────────

export const RESPONSIBILITY = {
  DEDUCTIBLE: 'deductible',
  COPAY: 'copay',
  COINSURANCE: 'coinsurance',
  DEDUCTIBLE_THEN_COINSURANCE: 'deductible_then_coinsurance',
  DEDUCTIBLE_THEN_COPAY: 'deductible_then_copay',
  COPAY_AND_COINSURANCE: 'copay_and_coinsurance',
  BUNDLED: 'bundled',
  NONE: 'no_patient_responsibility',
  UNKNOWN: 'unknown',
}

export const BUNDLING = {
  STANDARD: 'Standard INN bundle',
  SEPARATE: 'Separate patient responsibility for each service',
  CUSTOM: 'Custom / Unsure',
}

export const BENEFIT_CATEGORY = {
  LOC: 'LOC',
  OP: 'OP',
}

// Services that can be delivered while a client sits in a given LOC.
// `inStandardBundle` marks the services a normal INN plan rolls into the
// program benefit. `alwaysOp` marks services that use the OP benefit no matter
// which LOC the client is enrolled in.
export const SERVICES = [
  { key: 'LOC_SERVICE', label: null, inStandardBundle: false, alwaysOp: false },
  { key: 'IT', label: 'Individual Therapy', inStandardBundle: true, alwaysOp: false },
  { key: 'FT', label: 'Family Therapy', inStandardBundle: true, alwaysOp: false },
  { key: 'ASSESSMENT', label: 'Assessment', inStandardBundle: true, alwaysOp: false },
  { key: 'PSYCH', label: 'Psychiatric Services', inStandardBundle: false, alwaysOp: true },
]

// Radio options for Section 4 — the LOC service label depends on the LOC.
export const SERVICE_OPTIONS = ['LOC_SERVICE', 'IT', 'FT', 'ASSESSMENT', 'PSYCH', 'OTHER']

const PER_DIEM_LOCS = ['Detox', 'Resi']

export function formatCurrency(value) {
  const n = parseFloat(value)
  return (Number.isNaN(n) ? 0 : n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export const money = (value) => `$${formatCurrency(value)}`

function num(value) {
  if (value === '' || value === null || value === undefined) return null
  const parsed = parseFloat(value)
  return Number.isNaN(parsed) ? null : parsed
}

const round2 = (n) => Math.round(n * 100) / 100

export function getService(key) {
  return SERVICES.find((s) => s.key === key) || null
}

export function serviceLabel(key, loc) {
  if (key === 'LOC_SERVICE') return loc ? `${loc}` : 'LOC service'
  if (key === 'OTHER') return 'Other service'
  const service = getService(key)
  return service ? service.label : key
}

export function unitLabel(loc) {
  return PER_DIEM_LOCS.includes(loc) ? 'per day' : 'per visit'
}

// ── Step 1–2: running plan-level calculations ────────────────────────────────

export function computeCalc(data) {
  const oopTotal = num(data.oopMaxTotal)
  const oopMetVal = num(data.oopMet)
  const dedTotal = num(data.deductibleTotal)
  const dedMet = num(data.deductibleMet)

  const activities = data.financialActivities || []
  const totalClientPaymentsToOop = activities
    .filter((a) => a.countsTowardOop === 'Yes')
    .reduce((sum, a) => sum + (num(a.clientPaymentApplied) || 0), 0)
  const totalAssistanceToOop = activities
    .filter((a) => a.countsTowardOop === 'Yes')
    .reduce((sum, a) => sum + (num(a.financialAssistanceApplied) || 0), 0)
  const totalEpisodeActivityToOop = totalClientPaymentsToOop + totalAssistanceToOop

  // Accumulator behavior is calculated separately from patient responsibility:
  // an activity can count toward the deductible, the OOP max, both, or neither.
  const totalEpisodeActivityToDeductible = activities
    .filter((a) => a.countsTowardDeductible === 'Yes')
    .reduce(
      (sum, a) =>
        sum + (num(a.clientPaymentApplied) || 0) + (num(a.financialAssistanceApplied) || 0),
      0
    )

  const calculatedOopRemaining =
    oopTotal !== null
      ? Math.max(oopTotal - Math.max(oopMetVal || 0, totalEpisodeActivityToOop), 0)
      : null

  const oopSatisfied =
    (oopTotal !== null && oopMetVal !== null && oopMetVal >= oopTotal) ||
    calculatedOopRemaining === 0

  const deductibleRemaining =
    dedTotal !== null
      ? Math.max(dedTotal - Math.max(dedMet || 0, totalEpisodeActivityToDeductible), 0)
      : null

  return {
    totalClientPaymentsToOop,
    totalAssistanceToOop,
    totalEpisodeActivityToOop,
    totalEpisodeActivityToDeductible,
    calculatedOopRemaining,
    oopSatisfied,
    deductibleRemaining,
  }
}

// ── Step 3: benefit configurations ───────────────────────────────────────────

export function opBenefitConfigured(data) {
  if (!data.verifiedLoc) return false
  if (data.verifiedLoc === 'OP') return true
  return Boolean(data.opBenefitEnabled)
}

// Returns the cost-sharing configuration for a benefit category, or null when
// that category has not been verified on this VOB.
export function readBenefitConfig(data, category) {
  const secondaryOp = category === BENEFIT_CATEGORY.OP && data.verifiedLoc !== 'OP'

  if (secondaryOp) {
    if (!data.opBenefitEnabled) return null
    return {
      category,
      loc: 'OP',
      deductibleApplies: data.opDeductibleApplies,
      copay: data.opCopayNa ? null : num(data.opCopayAmount),
      copayNa: Boolean(data.opCopayNa),
      coinsurance: data.opCoinsuranceNa ? null : num(data.opCoinsurancePercent),
      coinsuranceNa: Boolean(data.opCoinsuranceNa),
      contractRate: num(data.opContractRate),
      confirmed: Boolean(data.opRulesConfirmed),
    }
  }

  // The verified LOC configuration. When the verified LOC is OP this same
  // configuration is the OP benefit.
  return {
    category,
    loc: data.verifiedLoc,
    deductibleApplies: data.deductibleApplies,
    copay: data.copayNa ? null : num(data.copayAmount),
    copayNa: Boolean(data.copayNa),
    coinsurance: data.coinsuranceNa ? null : num(data.coinsurancePercent),
    coinsuranceNa: Boolean(data.coinsuranceNa),
    contractRate: num(data.contractRate),
    confirmed: Boolean(data.locRulesConfirmed),
  }
}

// ── Step 4–6: service → bundling → benefit category ──────────────────────────

export function isServiceBundled(data, serviceKey) {
  const service = getService(serviceKey)
  if (!service || !service.inStandardBundle) return false
  // Bundling is a plan rule, not an automatic consequence of being in a LOC.
  return (
    data.network === 'INN' &&
    Boolean(data.verifiedLoc) &&
    data.verifiedLoc !== 'OP' &&
    data.bundlingModel === BUNDLING.STANDARD
  )
}

export function resolveBenefitCategory(data, serviceKey) {
  const service = getService(serviceKey)
  // Psych is always an OP benefit, regardless of the LOC the client is in.
  if (service && service.alwaysOp) return BENEFIT_CATEGORY.OP
  if (data.verifiedLoc === 'OP') return BENEFIT_CATEGORY.OP
  if (
    service &&
    service.inStandardBundle &&
    data.bundlingModel === BUNDLING.SEPARATE &&
    data.separateServiceBenefit === 'OP benefit'
  ) {
    return BENEFIT_CATEGORY.OP
  }
  return BENEFIT_CATEGORY.LOC
}

// ── Step 7–13: resolve the benefit into a single internal result ─────────────

function accumulators(type, amount, structure) {
  switch (type) {
    case RESPONSIBILITY.DEDUCTIBLE:
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE:
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY: {
      // Deductible dollars always accumulate to the deductible. Whether they
      // also touch the OOP max is governed by the plan's structure field.
      const towardOop =
        structure === 'Combined' ? amount : structure === 'Separate' ? 0 : null
      return {
        countsTowardDeductible: true,
        countsTowardOOP: structure === 'Combined' ? true : structure === 'Separate' ? false : null,
        towardDeductible: amount,
        towardOOP: towardOop,
      }
    }
    case RESPONSIBILITY.COPAY:
    case RESPONSIBILITY.COINSURANCE:
    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      // Copays and coinsurance are paid after (or instead of) the deductible.
      // They never accumulate backward toward the deductible.
      return {
        countsTowardDeductible: false,
        countsTowardOOP: true,
        towardDeductible: 0,
        towardOOP: amount,
      }
    case RESPONSIBILITY.BUNDLED:
    case RESPONSIBILITY.NONE:
      return {
        countsTowardDeductible: false,
        countsTowardOOP: false,
        towardDeductible: 0,
        towardOOP: 0,
      }
    default:
      return {
        countsTowardDeductible: null,
        countsTowardOOP: null,
        towardDeductible: null,
        towardOOP: null,
      }
  }
}

/**
 * Resolve one service into a single benefit result object. Everything the
 * output needs must come from this object.
 */
export function resolveBenefit(data, calc, serviceKey) {
  const loc = data.verifiedLoc
  const unit = unitLabel(loc)
  const category = resolveBenefitCategory(data, serviceKey)
  const bundled = isServiceBundled(data, serviceKey)
  const structure = data.deductibleOopStructure

  const base = {
    service: serviceKey,
    serviceLabel: serviceLabel(serviceKey, loc),
    contextLoc: loc,
    benefitCategory: category,
    benefitLabel: category === BENEFIT_CATEGORY.OP ? 'OP' : loc,
    network: data.network,
    unit,
    bundled,
    deductibleApplies: null,
    responsibilityType: RESPONSIBILITY.UNKNOWN,
    phase: null,
    copay: null,
    coinsurance: null,
    contractRate: null,
    amount: null,
    amountKnown: false,
    cappedByDeductible: false,
    countsTowardDeductible: null,
    countsTowardOOP: null,
    towardDeductible: null,
    towardOOP: null,
    notes: [],
  }

  if (bundled) {
    return {
      ...base,
      deductibleApplies: false,
      responsibilityType: RESPONSIBILITY.BUNDLED,
      amount: 0,
      amountKnown: true,
      ...accumulators(RESPONSIBILITY.BUNDLED, 0, structure),
    }
  }

  const service = getService(serviceKey)
  if (service && service.inStandardBundle && data.bundlingModel === BUNDLING.CUSTOM) {
    return {
      ...base,
      notes: ['The plan uses a custom cost-sharing model — confirm this service with insurance.'],
      ...accumulators(RESPONSIBILITY.UNKNOWN, null, structure),
    }
  }

  const config = readBenefitConfig(data, category)
  if (!config) {
    return {
      ...base,
      notes: ['OP benefit rules were not entered on this VOB.'],
      ...accumulators(RESPONSIBILITY.UNKNOWN, null, structure),
    }
  }

  const dedApplies = config.deductibleApplies === 'Yes'
  const dedUnknown = !config.deductibleApplies || config.deductibleApplies === 'Unsure'
  const hasCopay = config.copay !== null && config.copay > 0
  const hasCoinsurance = config.coinsurance !== null && config.coinsurance > 0
  const copaySpecified = config.copayNa || config.copay !== null
  const coinsuranceSpecified = config.coinsuranceNa || config.coinsurance !== null
  const dedRemaining = calc.deductibleRemaining !== null ? calc.deductibleRemaining : 0

  const resolved = {
    ...base,
    deductibleApplies: dedUnknown ? null : dedApplies,
    copay: config.copay,
    coinsurance: config.coinsurance,
    contractRate: config.contractRate,
    confirmed: config.confirmed,
  }

  if (calc.oopSatisfied) {
    return {
      ...resolved,
      responsibilityType: RESPONSIBILITY.NONE,
      phase: 'oop-met',
      amount: 0,
      amountKnown: true,
      ...accumulators(RESPONSIBILITY.NONE, 0, structure),
    }
  }

  if (dedUnknown || (!copaySpecified && !coinsuranceSpecified)) {
    return {
      ...resolved,
      notes: [
        dedUnknown
          ? 'Deductible applicability for this benefit is not confirmed.'
          : 'Copay and coinsurance for this benefit are not confirmed.',
      ],
      ...accumulators(RESPONSIBILITY.UNKNOWN, null, structure),
    }
  }

  const inDeductiblePhase = dedApplies && dedRemaining > 0

  let type
  if (inDeductiblePhase) {
    if (hasCoinsurance) type = RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE
    else if (hasCopay) type = RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY
    else type = RESPONSIBILITY.DEDUCTIBLE
  } else if (hasCopay && hasCoinsurance) {
    type = RESPONSIBILITY.COPAY_AND_COINSURANCE
  } else if (hasCopay) {
    type = RESPONSIBILITY.COPAY
  } else if (hasCoinsurance) {
    type = RESPONSIBILITY.COINSURANCE
  } else {
    type = RESPONSIBILITY.NONE
  }

  // Patient responsibility for the phase the client is actually in.
  let amount = null
  let amountKnown = false
  let cappedByDeductible = false
  const notes = []

  if (inDeductiblePhase) {
    if (config.contractRate !== null) {
      amount = Math.min(config.contractRate, dedRemaining)
      amountKnown = true
      cappedByDeductible = config.contractRate > dedRemaining
    } else {
      notes.push('Contract rate not entered — the exact per-visit amount cannot be calculated.')
    }
  } else if (type === RESPONSIBILITY.COPAY || type === RESPONSIBILITY.COPAY_AND_COINSURANCE) {
    amount = config.copay
    amountKnown = true
    if (type === RESPONSIBILITY.COPAY_AND_COINSURANCE) {
      notes.push(
        `The plan lists both a copay and ${config.coinsurance}% coinsurance — confirm which applies before quoting a final estimate.`
      )
    }
  } else if (type === RESPONSIBILITY.COINSURANCE) {
    if (config.contractRate !== null) {
      amount = round2((config.contractRate * config.coinsurance) / 100)
      amountKnown = true
    } else {
      notes.push('Contract rate not entered — coinsurance is a percentage of the contracted rate.')
    }
  } else if (type === RESPONSIBILITY.NONE) {
    amount = 0
    amountKnown = true
  }

  // Coinsurance never applies until the deductible is satisfied, so the
  // post-deductible amount is reported separately from the current amount.
  let postDeductibleAmount = null
  if (type === RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE && config.contractRate !== null) {
    postDeductibleAmount = round2((config.contractRate * config.coinsurance) / 100)
  } else if (type === RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY) {
    postDeductibleAmount = config.copay
  }

  return {
    ...resolved,
    responsibilityType: type,
    phase: inDeductiblePhase ? 'deductible' : 'post-deductible',
    amount,
    amountKnown,
    cappedByDeductible,
    postDeductibleAmount,
    notes,
    ...accumulators(type, amount, structure),
  }
}

// Which services need to be described for the verified LOC context.
export function contextServiceKeys(data) {
  const loc = data.verifiedLoc
  if (!loc) return []
  if (loc === 'OP') return ['LOC_SERVICE']

  const keys = ['LOC_SERVICE']
  // Ancillary services are only listed once the plan's bundling behavior is
  // known (INN) or when bundling does not apply at all (OON).
  const bundlingKnown = data.network === 'INN' ? Boolean(data.bundlingModel) : true
  if (bundlingKnown) keys.push('IT', 'FT', 'ASSESSMENT')
  if (data.opBenefitEnabled) keys.push('PSYCH')
  return keys
}

export function resolveContextBenefits(data, calc) {
  return contextServiceKeys(data).map((key) => resolveBenefit(data, calc, key))
}

// ── Remaining exposure (formerly "client responsibility") ────────────────────
//
// This is a cap, not a bill: how much room is left before the client's
// accumulators are satisfied.
export function computeRemainingExposure(data, calc, primary) {
  const oopRem = calc.calculatedOopRemaining !== null ? calc.calculatedOopRemaining : 0
  const dedRem = calc.deductibleRemaining !== null ? calc.deductibleRemaining : 0
  const separate = data.deductibleOopStructure === 'Separate'
  const type = primary ? primary.responsibilityType : RESPONSIBILITY.UNKNOWN

  let locExposure
  if (calc.oopSatisfied || type === RESPONSIBILITY.NONE || type === RESPONSIBILITY.BUNDLED) {
    locExposure = 0
  } else if (type === RESPONSIBILITY.DEDUCTIBLE) {
    // Deductible only — nothing further is owed once the deductible is met.
    locExposure = separate ? dedRem : Math.min(dedRem, oopRem)
  } else if (
    type === RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE ||
    type === RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY
  ) {
    locExposure = separate ? dedRem + oopRem : oopRem
  } else {
    // Copay / coinsurance / unknown — the OOP max is the cap.
    locExposure = oopRem
  }

  const currentBalance =
    data.hasCurrentBalance === 'Yes' && data.balanceAmount ? num(data.balanceAmount) || 0 : 0

  return {
    oopRemaining: oopRem,
    deductibleRemaining: dedRem,
    locExposure,
    currentBalance,
    totalExposure: locExposure + currentBalance,
  }
}

// ── Section 4 support: derive what a recorded service should have cost ───────
export function deriveActivityBenefit(data, calc, activity) {
  if (!activity.serviceType || activity.serviceType === 'OTHER') return null
  if (!data.verifiedLoc) return null
  if (activity.activityLoc && activity.activityLoc !== data.verifiedLoc) {
    return {
      crossLoc: true,
      note: `Service occurred under ${activity.activityLoc}. This VOB verifies ${data.verifiedLoc} rules, so expected cost sharing is not derived.`,
    }
  }
  return resolveBenefit(data, calc, activity.serviceType)
}

export function responsibilityTypeLabel(type) {
  switch (type) {
    case RESPONSIBILITY.DEDUCTIBLE:
      return 'Deductible'
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COINSURANCE:
      return 'Deductible, then coinsurance'
    case RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY:
      return 'Deductible, then copay'
    case RESPONSIBILITY.COPAY:
      return 'Copay'
    case RESPONSIBILITY.COINSURANCE:
      return 'Coinsurance'
    case RESPONSIBILITY.COPAY_AND_COINSURANCE:
      return 'Copay and coinsurance'
    case RESPONSIBILITY.BUNDLED:
      return 'Bundled'
    case RESPONSIBILITY.NONE:
      return 'No patient responsibility'
    default:
      return 'Not established'
  }
}
