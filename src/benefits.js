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

// Detox and Resi are frequently authorized as one continuous admission: the
// client steps down from detox into residential without being discharged and
// re-admitted. When the plan wrote it that way the combined stay is the level
// of care, which is what makes a per-admission copay a single charge for the
// whole thing rather than one for each phase.
export const COMBINED_DETOX_RESI = 'Detox/Resi'
const DETOX_RESI_MEMBERS = ['Detox', 'Resi']

export const LOC_OPTIONS = ['Detox', 'Resi', COMBINED_DETOX_RESI, 'PHP', 'IOP', 'OP']

const PER_DIEM_LOCS = ['Detox', 'Resi', COMBINED_DETOX_RESI]

export function isCombinedAdmission(loc) {
  return loc === COMBINED_DETOX_RESI
}

// A per diem level of care is billed for the day, not for the individual
// services delivered inside it. Everything that follows from that — the copay
// basis question, what is quotable, what gets bundled — keys off this.
export function isPerDiemLoc(loc) {
  return PER_DIEM_LOCS.includes(loc)
}

// A combined Detox/Resi benefit and its two parts describe the same admission
// two different ways, so storing both would price one stay twice.
function locExcludedBy(loc) {
  if (isCombinedAdmission(loc)) return DETOX_RESI_MEMBERS
  return DETOX_RESI_MEMBERS.includes(loc) ? [COMBINED_DETOX_RESI] : []
}

// Levels of care that were stored despite describing the same admission as
// something else already stored. The radio options prevent this on the way in,
// but changing the verified LOC afterward can still produce it, and a combined
// Detox/Resi benefit sitting next to a Detox one prices a single stay twice.
export function conflictingLocs(storedLocs) {
  const present = new Set(storedLocs.filter(Boolean))
  return LOC_OPTIONS.filter((l) => present.has(l) && locExcludedBy(l).some((x) => present.has(x)))
}

// Which levels of care can still be chosen, given what is already stored.
// `current` is always offered so a card can keep showing its own selection.
export function selectableLocs(storedLocs, current = '') {
  const blocked = new Set()
  storedLocs.filter(Boolean).forEach((loc) => {
    blocked.add(loc)
    locExcludedBy(loc).forEach((l) => blocked.add(l))
  })
  return LOC_OPTIONS.filter((l) => l === current || !blocked.has(l))
}

// Whether a level of care is part of the one this VOB verified. A client
// sitting in detox on a combined Detox/Resi verification is inside the verified
// admission, not in a different level of care from it.
export function locWithin(loc, verifiedLoc) {
  if (!loc || !verifiedLoc) return false
  return (
    loc === verifiedLoc || (isCombinedAdmission(verifiedLoc) && DETOX_RESI_MEMBERS.includes(loc))
  )
}

// A per diem level of care is billed by the day, but its copay is very often
// charged once for the whole stay ("$500 copay per admission"). The two are not
// interchangeable — reading a per-admission copay out as a daily one overstates
// a 30-day stay by 30x — so the basis is captured rather than assumed.
export const COPAY_BASIS = {
  PER_UNIT: 'Per day',
  PER_ADMISSION: 'Per admission',
}

export function copayBasisApplies(loc) {
  return isPerDiemLoc(loc)
}

// One copay covering a detox stay and the residential stay it steps down into.
// Worth saying out loud wherever it is quoted, because "per admission" is
// exactly the phrase that invites the question of whether moving into
// residential starts a second admission — it does not.
export function coversWholeAdmission(resolved) {
  if (!resolved) return false
  const copayDriven =
    resolved.responsibilityType === RESPONSIBILITY.COPAY ||
    resolved.responsibilityType === RESPONSIBILITY.COPAY_AND_COINSURANCE ||
    resolved.responsibilityType === RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY
  return (
    isCombinedAdmission(resolved.contextLoc) && resolved.copayUnit === 'per admission' && copayDriven
  )
}

// What a level of care's own service actually is. For OP that is the routine
// group visit, which matters because it is a different code at a different
// contracted rate than the individual services billed under the same OP
// benefit — the reason a plan's OP copay can land differently on a group than
// on an individual therapy session.
export function locServiceName(loc) {
  return loc === 'OP' ? 'Groups' : loc
}

// The level of care's own service as it appears in a sentence. `lower` is
// honored for a real word ("Groups" → "groups") and ignored for a level of care
// that is its own service, because an acronym is not lowercased just because it
// landed mid-sentence.
export function ownServiceNoun(loc, { lower = false } = {}) {
  const name = locServiceName(loc)
  return lower && name !== loc ? name.toLowerCase() : name
}

// "Groups are", but "IOP is". Kept beside locServiceName so the two cannot
// drift: the only own-service with a name of its own is a plural.
export function ownServiceVerb(loc) {
  return locServiceName(loc) === loc ? 'is' : 'are'
}

// What a benefit's stored contract rate is the rate *for*. Named explicitly
// because the rate caps that service's copay and no other.
export function contractRateSubject(loc) {
  if (loc === 'OP') return 'groups'
  if (isCombinedAdmission(loc)) return 'a day of the detox/residential stay'
  if (isPerDiemLoc(loc)) return `a day of ${loc}`
  return `an ${loc} visit`
}

// Whether the level of care's own service is priced apart from everything else
// billing under the same benefit.
//
// A benefit's copay applies to every service under it. An OP copay is charged
// on individual therapy, family therapy, assessment, and psych visits too — it
// is not a group-only price — so naming groups by default reads as a narrower
// benefit than the plan actually has. The one thing that can separate the LOC's
// own service is its contracted rate landing *below* that copay, because then
// and only then is a group collected at a different number than everything
// else. Until that happens there is nothing to name.
export function ownServicePricedApart(resolved) {
  return Boolean(resolved && resolved.cappedByContractRate)
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
  return isPerDiemLoc(loc) ? 'per day' : 'per visit'
}

// The unit a specific service is billed in. Therapy and assessments are billed
// per encounter regardless of whether the LOC around them is per diem.
export function serviceUnitLabel(serviceKey, loc) {
  if (serviceKey === 'IT' || serviceKey === 'FT') return 'per session'
  if (serviceKey === 'ASSESSMENT') return 'per assessment'
  return unitLabel(loc)
}

// ── Step 1–2: running plan-level calculations ────────────────────────────────

export function computeCalc(data) {
  // Not every plan has a deductible or an out-of-pocket maximum. "The plan does
  // not have one" and "nobody entered it yet" are different facts and are kept
  // apart: an absent accumulator resolves to a known zero balance, an unentered
  // one stays null so the output says it is unknown.
  const noDeductible = Boolean(data.noDeductible)
  const noOopMax = Boolean(data.noOopMax)
  const oopTotal = noOopMax ? null : num(data.oopMaxTotal)
  const oopMetVal = noOopMax ? null : num(data.oopMet)
  const dedTotal = noDeductible ? null : num(data.deductibleTotal)
  const dedMet = noDeductible ? null : num(data.deductibleMet)

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

  const deductibleRemaining = noDeductible
    ? 0
    : dedTotal !== null
      ? Math.max(dedTotal - Math.max(dedMet || 0, totalEpisodeActivityToDeductible), 0)
      : null

  return {
    noDeductible,
    noOopMax,
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

// One plan holds an independent benefit per level of care:
//
//   PLAN ├── Detox ├── Resi ├── PHP ├── IOP └── OP
//
// The verified LOC names which of them is primary for this VOB; it does not
// limit which benefits can be stored. Returns null when a LOC's benefit has not
// been captured.
export function readBenefitConfig(data, category) {
  const targetLoc = categoryLoc(data, category)
  if (!targetLoc) return null

  const entry = (data.locBenefits || []).find((b) => b.loc === targetLoc)
  if (!entry) return null
  return {
    category,
    loc: targetLoc,
    isPrimary: targetLoc === data.verifiedLoc,
    // A plan with no deductible cannot have one apply to a benefit, so the
    // per-LOC question is never asked and never has to be answered.
    deductibleApplies: data.noDeductible ? 'No' : entry.deductibleApplies,
    copay: entry.copayNa ? null : num(entry.copayAmount),
    copayNa: Boolean(entry.copayNa),
    copayBasis: copayBasisApplies(targetLoc) ? entry.copayBasis || '' : '',
    coinsurance: entry.coinsuranceNa ? null : num(entry.coinsurancePercent),
    coinsuranceNa: Boolean(entry.coinsuranceNa),
    contractRate: num(entry.contractRate),
    // Whether the plan pays the level of care's OWN service delivered over
    // telehealth — scoped exactly like contractRate above, and for the same
    // reason. A telehealth exclusion lands on a code, not on a benefit: a plan
    // that will not pay a group over telehealth still pays the individual
    // therapy session billing under the same benefit. Nothing here says
    // anything about those services.
    telehealth: Boolean(entry.telehealthCovered),
    confirmed: Boolean(entry.confirmed),
  }
}

export function hasBenefitConfig(data, category) {
  return readBenefitConfig(data, category) !== null
}

// ── Step 4–6: service → bundling → benefit category ──────────────────────────

// The bundling model is captured for the LOC this VOB verifies, so it only
// governs services delivered in that context.
export function isServiceBundled(data, serviceKey, contextLoc = data.verifiedLoc) {
  const service = getService(serviceKey)
  if (!service || !service.inStandardBundle) return false
  // A per diem buys the day, not the services inside it: individual therapy
  // during detox or residential is part of the stay, not a second charge. There
  // is no bundling model to ask about, in or out of network.
  if (isPerDiemLoc(contextLoc)) return true
  if (contextLoc !== data.verifiedLoc) return false
  // Bundling is a plan rule, not an automatic consequence of being in a LOC.
  return (
    data.network === 'INN' &&
    Boolean(contextLoc) &&
    contextLoc !== 'OP' &&
    data.bundlingModel === BUNDLING.STANDARD
  )
}

export function resolveBenefitCategory(data, serviceKey, contextLoc = data.verifiedLoc) {
  const service = getService(serviceKey)
  // Psych is always an OP benefit, regardless of the LOC the client is in.
  if (service && service.alwaysOp) return BENEFIT_CATEGORY.OP
  if (contextLoc === 'OP') return BENEFIT_CATEGORY.OP
  if (
    service &&
    service.inStandardBundle &&
    contextLoc === data.verifiedLoc &&
    data.bundlingModel === BUNDLING.SEPARATE &&
    data.separateServiceBenefit === 'OP benefit'
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
  const unit = unitLabel(loc)
  const category = resolveBenefitCategory(data, serviceKey, loc)
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
    // The unit the copay is charged in, which is not always the unit the LOC is
    // billed in — a per diem stay can carry a single per-admission copay.
    copayUnit: serviceUnitLabel(serviceKey, loc),
    bundled,
    deductibleApplies: null,
    responsibilityType: RESPONSIBILITY.UNKNOWN,
    phase: null,
    copay: null,
    coinsurance: null,
    contractRate: null,
    // null until a benefit is read *for the service the flag describes*.
    // "nobody captured this" is not the same fact as "the plan does not cover
    // telehealth", and only the second one is ever said out loud.
    telehealth: null,
    amount: null,
    amountKnown: false,
    cappedByDeductible: false,
    cappedByContractRate: false,
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
  const bundleUnknown =
    service &&
    service.inStandardBundle &&
    (loc === data.verifiedLoc
      ? data.bundlingModel === BUNDLING.CUSTOM
      : // The bundling model was only captured for the verified LOC, so nothing
        // can be assumed about ancillary services delivered under another one.
        loc !== 'OP')
  if (bundleUnknown) {
    return {
      ...base,
      notes: [
        loc === data.verifiedLoc
          ? 'The plan uses a custom cost-sharing model — confirm this service with insurance.'
          : `Bundling for ${loc} was not captured on this VOB — confirm this service with insurance.`,
      ],
      ...accumulators(RESPONSIBILITY.UNKNOWN, null, structure),
    }
  }

  const config = readBenefitConfig(data, category)
  if (!config) {
    return {
      ...base,
      notes: [`${categoryLoc(data, category)} benefit rules were not entered on this VOB.`],
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

  // A per-admission copay is charged once for the stay, so it belongs to the
  // level of care itself — a therapy session inside that stay is still priced
  // per session.
  const perAdmission =
    serviceKey === 'LOC_SERVICE' && config.copayBasis === COPAY_BASIS.PER_ADMISSION

  const resolved = {
    ...base,
    copayUnit: perAdmission ? 'per admission' : base.copayUnit,
    deductibleApplies: dedUnknown ? null : dedApplies,
    copay: config.copay,
    coinsurance: config.coinsurance,
    contractRate: config.contractRate,
    // Read only for the service the flag was captured about. An individual
    // therapy session under the OP benefit stays null — the plan may well cover
    // it over telehealth while excluding the group, and this VOB never asked.
    telehealth: serviceKey === 'LOC_SERVICE' ? config.telehealth : null,
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

  // The benefit's copay applies to every service billing under it. An OP copay
  // is charged on individual therapy, family therapy, assessment, and psych
  // visits exactly as it is on a group — `config.copay` is read for all of them
  // above, and nothing here narrows that.
  //
  // What the contracted rate does is cap it. A copay can never exceed what the
  // service actually costs: we cannot collect more than the contracted rate, so
  // a $50 copay against a $40 contracted rate is collected as $40. The plan's
  // stated copay is kept on `copay`; what to actually collect is `amount`.
  //
  // The cap only applies to the level of care's own service, because that is
  // the only service the stored rate describes. A therapy or psychiatric visit
  // billing under the same benefit is a different code at a different rate — an
  // OP benefit's rate is the routine/group visit rate, so capping an individual
  // therapy copay with it would under-collect. That makes a rate below the
  // copay the *only* thing that prices groups apart from the rest of OP; at any
  // higher rate every service under the benefit collects the same copay. A
  // per-admission copay is exempt for the same reason in the other direction: a
  // per-day rate is not a ceiling on a charge that covers the whole stay.
  const rateAppliesToService = serviceKey === 'LOC_SERVICE' && !perAdmission
  const collectibleCopay =
    config.copay !== null && config.contractRate !== null && rateAppliesToService
      ? Math.min(config.copay, config.contractRate)
      : config.copay
  const copayCapped = collectibleCopay !== null && collectibleCopay < config.copay
  const copayCapNote = `The plan lists a ${money(config.copay)} copay, but the ${config.contractRate !== null ? money(config.contractRate) : ''} contracted rate is lower — collect ${money(collectibleCopay)}. We cannot charge more than the contracted rate.`

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
    amount = collectibleCopay
    amountKnown = true
    if (copayCapped) notes.push(copayCapNote)
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
    postDeductibleAmount = collectibleCopay
    if (copayCapped) notes.push(copayCapNote)
  }

  return {
    ...resolved,
    responsibilityType: type,
    phase: inDeductiblePhase ? 'deductible' : 'post-deductible',
    amount,
    amountKnown,
    cappedByDeductible,
    cappedByContractRate:
      copayCapped &&
      (type === RESPONSIBILITY.COPAY ||
        type === RESPONSIBILITY.COPAY_AND_COINSURANCE ||
        type === RESPONSIBILITY.DEDUCTIBLE_THEN_COPAY),
    postDeductibleAmount,
    notes,
    ...accumulators(type, amount, structure),
  }
}

// Which services need to be described for the verified LOC context.
export function contextServiceKeys(data) {
  const loc = data.verifiedLoc
  if (!loc) return []
  // A client in OP still receives therapy and psych visits, and all of them
  // price off the OP benefit — there is no bundling question to settle first,
  // so nothing has to be withheld.
  if (loc === 'OP') return ['LOC_SERVICE', 'IT', 'FT', 'ASSESSMENT', 'PSYCH']

  // A per diem stay is quoted as one price. Individual therapy, family therapy,
  // assessment and psychiatric visits delivered inside detox or residential are
  // part of the day that was already quoted, so listing them would put a second
  // number in front of a client who only owes the first. Naming services one at
  // a time is an outpatient concern.
  if (isPerDiemLoc(loc)) return ['LOC_SERVICE']

  const keys = ['LOC_SERVICE']
  // Ancillary services are only listed once the plan's bundling behavior is
  // known (INN) or when bundling does not apply at all (OON).
  const bundlingKnown = data.network === 'INN' ? Boolean(data.bundlingModel) : true
  if (bundlingKnown) keys.push('IT', 'FT', 'ASSESSMENT')
  // Psych is only listed once the OP benefit it bills under has been captured.
  if (hasBenefitConfig(data, BENEFIT_CATEGORY.OP)) keys.push('PSYCH')
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

  const recordedLoc = activity.activityLoc || data.verifiedLoc
  // A day recorded as Detox against a combined Detox/Resi admission is a day of
  // that admission, so it prices off the benefit that was actually verified
  // rather than looking for a separate Detox benefit that will never exist.
  const contextLoc =
    !hasBenefitConfig(data, recordedLoc) && locWithin(recordedLoc, data.verifiedLoc)
      ? data.verifiedLoc
      : recordedLoc
  // A service delivered under another LOC can still be derived when that LOC's
  // benefit was captured — otherwise say so rather than applying the wrong rule.
  if (contextLoc !== data.verifiedLoc && !hasBenefitConfig(data, contextLoc)) {
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
