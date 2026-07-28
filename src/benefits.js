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

// Whether the OP benefit prices psychiatric work at the plain OP rate or at its
// own rates. Evaluations and follow-ups routinely price differently from each
// other, so "separate" splits into one rate per psychiatric service.
export const PSYCH_RATES = {
  SAME: 'Same as the OP benefit',
  SEPARATE: 'Separate psychiatric rates',
  UNSURE: 'Unsure',
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
  { key: 'PSYCH_EVAL', label: 'Psychiatric Evaluation', inStandardBundle: false, alwaysOp: true },
  { key: 'PSYCH_FOLLOWUP', label: 'Psychiatric Follow-Up', inStandardBundle: false, alwaysOp: true },
]

// The psychiatric services that can carry their own rate. The generic PSYCH key
// stands in whenever the plan prices all psychiatric work at the OP rate.
export const PSYCH_RATE_SERVICES = ['PSYCH_EVAL', 'PSYCH_FOLLOWUP']
export const PSYCH_ALL_SERVICES = ['PSYCH', ...PSYCH_RATE_SERVICES]

// Radio options for Section 4 — the LOC service label depends on the LOC.
// Psychiatric activity is always recorded as an evaluation or a follow-up; the
// two resolve to the same rules when the plan does not price them separately.
export const SERVICE_OPTIONS = [
  'LOC_SERVICE',
  'IT',
  'FT',
  'ASSESSMENT',
  'PSYCH_EVAL',
  'PSYCH_FOLLOWUP',
  'OTHER',
]

// Most intensive to least. Step-downs move rightward through this list.
export const LOC_ORDER = ['Detox', 'Resi', 'PHP', 'IOP', 'OP']

const PER_DIEM_LOCS = ['Detox', 'Resi']

// A client can only step down to a less intensive level of care.
export function stepDownOptions(loc) {
  const i = LOC_ORDER.indexOf(loc)
  return i === -1 ? [] : LOC_ORDER.slice(i + 1)
}

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

// A benefit category is a level of care ('IOP', 'OP', 'PHP', …), or the
// sentinel LOC meaning "whichever LOC this VOB was verified for".
export function categoryLoc(data, category) {
  return category === BENEFIT_CATEGORY.LOC ? data.verifiedLoc : category
}

export function benefitEntry(data, loc) {
  if (!loc) return null
  return (data.locBenefits || []).find((b) => b.loc === loc) || null
}

// Bundling is a property of the LOC's benefit, not of the VOB as a whole — a
// plan can bundle PHP and itemize IOP. Returns null when the LOC has no benefit.
export function readBundling(data, loc) {
  const entry = benefitEntry(data, loc)
  if (!entry) return null
  return { model: entry.bundlingModel || '', serviceBenefit: entry.separateServiceBenefit || '' }
}

// Which psychiatric rate a service should be priced at. Psychiatric work always
// bills under OP, so the model lives on the OP benefit.
export function readPsychRates(data) {
  const entry = benefitEntry(data, 'OP')
  return entry ? entry.psychRates || '' : ''
}

// A service-specific rate replaces the benefit's own rules for that service.
// Only psychiatric services carry one today, and only when the OP benefit says
// the plan prices them separately.
function serviceRateEntry(data, entry, serviceKey) {
  if (!entry || !serviceKey) return null
  if (!PSYCH_RATE_SERVICES.includes(serviceKey)) return null
  if (entry.psychRates !== PSYCH_RATES.SEPARATE) return null
  return (entry.serviceRates || []).find((r) => r.service === serviceKey) || null
}

// One plan holds an independent benefit per level of care:
//
//   PLAN ├── Detox ├── Resi ├── PHP ├── IOP └── OP
//
// The verified LOC names which of them is primary for this VOB; it does not
// limit which benefits can be stored. Returns null when a LOC's benefit has not
// been captured.
export function readBenefitConfig(data, category, serviceKey = null) {
  const targetLoc = categoryLoc(data, category)
  if (!targetLoc) return null

  const entry = benefitEntry(data, targetLoc)
  if (!entry) return null

  const rate = serviceRateEntry(data, entry, serviceKey)
  const source = rate || entry
  // "Unsure" on the psychiatric rate model means the plan's psychiatric pricing
  // is unknown — the plain OP rate must not be quoted in its place.
  const rateUnconfirmed =
    PSYCH_ALL_SERVICES.includes(serviceKey) && entry.psychRates === PSYCH_RATES.UNSURE

  return {
    category,
    loc: targetLoc,
    isPrimary: targetLoc === data.verifiedLoc,
    serviceRate: rate ? serviceKey : null,
    rateUnconfirmed,
    deductibleApplies: source.deductibleApplies,
    copay: source.copayNa ? null : num(source.copayAmount),
    copayNa: Boolean(source.copayNa),
    coinsurance: source.coinsuranceNa ? null : num(source.coinsurancePercent),
    coinsuranceNa: Boolean(source.coinsuranceNa),
    contractRate: num(source.contractRate),
    confirmed: Boolean(entry.confirmed) && (!rate || Boolean(rate.confirmed)),
  }
}

export function hasBenefitConfig(data, category) {
  return readBenefitConfig(data, category) !== null
}

// Whether the VOB records a step-down to a lower level of care. The step-down
// LOC is a second collection context: same accumulators, different rates.
export function stepDownPlan(data) {
  if (data.stepDownPlanned !== 'Yes') return null
  if (!data.stepDownLoc || data.stepDownLoc === data.verifiedLoc) return null
  return {
    loc: data.stepDownLoc,
    date: data.stepDownDate || null,
    hasBenefit: hasBenefitConfig(data, data.stepDownLoc),
  }
}

// ── Step 4–6: service → bundling → benefit category ──────────────────────────

// Bundling only exists as an INN program concept, and only for the LOC whose
// benefit records it.
export function isServiceBundled(data, serviceKey, contextLoc = data.verifiedLoc) {
  const service = getService(serviceKey)
  if (!service || !service.inStandardBundle) return false
  if (data.network !== 'INN' || !contextLoc || contextLoc === 'OP') return false
  // Bundling is a plan rule, not an automatic consequence of being in a LOC.
  const bundling = readBundling(data, contextLoc)
  return Boolean(bundling) && bundling.model === BUNDLING.STANDARD
}

export function resolveBenefitCategory(data, serviceKey, contextLoc = data.verifiedLoc) {
  const service = getService(serviceKey)
  // Psych is always an OP benefit, regardless of the LOC the client is in.
  if (service && service.alwaysOp) return BENEFIT_CATEGORY.OP
  if (contextLoc === 'OP') return BENEFIT_CATEGORY.OP
  const bundling = readBundling(data, contextLoc)
  if (
    service &&
    service.inStandardBundle &&
    bundling &&
    bundling.model === BUNDLING.SEPARATE &&
    bundling.serviceBenefit === 'OP benefit'
  ) {
    return BENEFIT_CATEGORY.OP
  }
  return contextLoc === data.verifiedLoc ? BENEFIT_CATEGORY.LOC : contextLoc
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
export function resolveBenefit(data, calc, serviceKey, contextLoc = data.verifiedLoc) {
  const loc = contextLoc
  const category = resolveBenefitCategory(data, serviceKey, loc)
  // The unit belongs to the benefit being billed, not to the LOC the client
  // happens to be in: psychiatric work is an OP visit even during a per-diem
  // stay, so it is never quoted "per day".
  const unit = unitLabel(categoryLoc(data, category) || loc)
  const bundled = isServiceBundled(data, serviceKey, loc)
  const structure = data.deductibleOopStructure

  const base = {
    service: serviceKey,
    serviceLabel: serviceLabel(serviceKey, loc),
    contextLoc: loc,
    benefitCategory: category,
    benefitLabel: categoryLoc(data, category) || loc,
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
  const bundling = readBundling(data, loc)
  const bundleUnknown =
    service &&
    service.inStandardBundle &&
    data.network === 'INN' &&
    loc !== 'OP' &&
    (!bundling || !bundling.model || bundling.model === BUNDLING.CUSTOM)
  if (bundleUnknown) {
    return {
      ...base,
      notes: [
        bundling && bundling.model === BUNDLING.CUSTOM
          ? `The plan uses a custom cost-sharing model for ${loc} — confirm this service with insurance.`
          : `Bundling for ${loc} was not captured on this VOB — confirm this service with insurance.`,
      ],
      ...accumulators(RESPONSIBILITY.UNKNOWN, null, structure),
    }
  }

  const config = readBenefitConfig(data, category, serviceKey)
  if (!config) {
    return {
      ...base,
      notes: [`${categoryLoc(data, category)} benefit rules were not entered on this VOB.`],
      ...accumulators(RESPONSIBILITY.UNKNOWN, null, structure),
    }
  }

  // A psychiatric rate model of "Unsure" leaves psychiatric pricing unknown even
  // though the OP benefit itself is fully entered.
  if (config.rateUnconfirmed) {
    return {
      ...base,
      notes: [
        `Whether the plan prices ${serviceKey === 'PSYCH' ? 'psychiatric services' : serviceLabel(serviceKey, loc).toLowerCase()} at the OP rate or at a separate psychiatric rate is unconfirmed.`,
      ],
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
    usesServiceRate: Boolean(config.serviceRate),
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

// Which services need to be described for a given LOC context — the verified
// LOC by default, or the step-down LOC when describing life after the step-down.
export function contextServiceKeys(data, contextLoc = data.verifiedLoc) {
  const loc = contextLoc
  if (!loc) return []

  const keys = ['LOC_SERVICE']
  if (loc !== 'OP') {
    // Ancillary services are only listed once the plan's bundling behavior is
    // known (INN) or when bundling does not apply at all (OON).
    const bundling = readBundling(data, loc)
    const bundlingKnown = data.network === 'INN' ? Boolean(bundling && bundling.model) : true
    if (bundlingKnown) keys.push('IT', 'FT', 'ASSESSMENT')
  }

  // Psych is only listed once the OP benefit it bills under has been captured.
  // In an OP context it is only worth listing separately when the plan prices
  // psychiatric work differently from the rest of the OP benefit.
  if (hasBenefitConfig(data, BENEFIT_CATEGORY.OP)) {
    const psychRates = readPsychRates(data)
    if (psychRates === PSYCH_RATES.SEPARATE) keys.push(...PSYCH_RATE_SERVICES)
    else if (loc !== 'OP' || psychRates === PSYCH_RATES.UNSURE) keys.push('PSYCH')
  }
  return keys
}

export function resolveContextBenefits(data, calc, contextLoc = data.verifiedLoc) {
  return contextServiceKeys(data, contextLoc).map((key) =>
    resolveBenefit(data, calc, key, contextLoc)
  )
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

  const contextLoc = activity.activityLoc || data.verifiedLoc
  const service = getService(activity.serviceType)
  // A service delivered under another LOC can still be derived when that LOC's
  // benefit was captured — otherwise say so rather than applying the wrong rule.
  // Services that always bill under OP do not depend on the surrounding LOC.
  if (
    contextLoc !== data.verifiedLoc &&
    !(service && service.alwaysOp) &&
    !hasBenefitConfig(data, contextLoc)
  ) {
    return {
      crossLoc: true,
      note: `Service occurred under ${contextLoc}, and no ${contextLoc} benefit was entered on this VOB. Add it under Section 3 to derive expected cost sharing.`,
    }
  }
  return resolveBenefit(data, calc, activity.serviceType, contextLoc)
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
