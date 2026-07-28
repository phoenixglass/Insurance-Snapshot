import { useState } from 'react'
import './App.css'
import {
  BUNDLING,
  LOC_ORDER,
  PSYCH_RATES,
  PSYCH_RATE_SERVICES,
  RESPONSIBILITY,
  SERVICE_OPTIONS,
  computeCalc,
  deriveActivityBenefit,
  formatCurrency,
  money,
  resolveBenefit,
  responsibilityTypeLabel,
  serviceLabel,
  stepDownOptions,
  unitLabel,
} from './benefits.js'
import { generateExplanation } from './summary.js'

const makeActivity = () => ({
  id: `${Date.now()}-${Math.random()}`,
  activityLoc: '',
  activityStatus: '',
  serviceType: '',
  serviceDate: '',
  sourceReviewed: '',
  clientPaymentApplied: '',
  financialAssistanceApplied: '',
  assistanceType: '',
  appliesTo: '',
  countsTowardOop: '',
  countsTowardDeductible: '',
  notes: '',
})

const LOC_OPTIONS = LOC_ORDER

// The cost-sharing rules shared by a LOC benefit and by any service-specific
// rate that overrides it.
const makeRules = () => ({
  deductibleApplies: '',
  copayAmount: '',
  copayNa: false,
  coinsurancePercent: '',
  coinsuranceNa: false,
  contractRate: '',
  confirmed: false,
})

// One independent benefit configuration per level of care. Every LOC — including
// OP — uses this same shape; none of them is a special case. Bundling lives here
// too: a plan can bundle PHP and itemize IOP.
const makeBenefit = (loc = '') => ({
  id: `${Date.now()}-${Math.random()}`,
  loc,
  ...makeRules(),
  bundlingModel: '',
  separateServiceBenefit: '',
  // OP only — how the plan prices psychiatric evaluations and follow-ups.
  psychRates: '',
  serviceRates: [],
})

const makeServiceRate = (service) => ({ service, ...makeRules() })

// Selecting a verified LOC names which stored benefit is primary. It never
// discards benefits already captured for other levels of care.
const ensureBenefitFor = (benefits, loc) =>
  !loc || benefits.some((b) => b.loc === loc) ? benefits : [...benefits, makeBenefit(loc)]

const INITIAL_FORM_STATE = {
  // Section 1 — Plan Basics
  network: '',
  deductibleTotal: '',
  deductibleMet: '',
  oopMaxTotal: '',
  oopMet: '',
  deductibleOopStructure: '',

  // Section 2 — Level of Care
  currentStatus: '',
  currentLoc: '',
  verifiedLoc: '',

  // Section 2 — planned step-down to a lower level of care
  stepDownPlanned: '',
  stepDownLoc: '',
  stepDownDate: '',

  // Section 3 — one benefit configuration per level of care, each carrying its
  // own bundling model and (for OP) its own psychiatric rates
  locBenefits: [],

  // Section 4 — Episode Financial Activity
  financialActivities: [],
  hasCurrentBalance: '',
  balanceAmount: '',
  balanceType: '',
  balanceReviewed: false,

  // Section 5 — Final Check
  deductibleOopReviewed: false,
  networkConfirmed: false,
  locRulesEntered: false,
  episodeActivityReviewed: false,
}


function RadioGroup({ name, options, value, onChange }) {
  const items = options.map((opt) => (typeof opt === 'string' ? { value: opt, label: opt } : opt))
  return (
    <div className="radio-group">
      {items.map((opt) => (
        <label key={opt.value} className="radio-label">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  )
}

function CurrencyInput({ id, value, onChange, placeholder = '0.00', disabled = false }) {
  return (
    <div className="currency-input-wrapper">
      <span className="currency-symbol">$</span>
      <input
        id={id}
        type="number"
        min="0"
        step="0.01"
        className="currency-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  )
}

// Cost-sharing rules for one benefit category. Copay and coinsurance are both
// first-class: "deductible applies = No" says nothing about which of the two
// the plan actually uses, so each has to be entered or explicitly marked N/A.
function BenefitRuleFields({ idPrefix, values, onChange, unit }) {
  const coinsurancePct =
    !values.coinsuranceNa && values.coinsurancePercent !== ''
      ? parseFloat(values.coinsurancePercent)
      : 0
  // The rate is always recordable — a LOC can have both a contracted rate and a
  // copay — but it only drives a calculation in the deductible/coinsurance case.
  const rateDrivesCalculation = values.deductibleApplies === 'Yes' || coinsurancePct > 0

  return (
    <>
      <div className="field-group">
        <label className="field-label">Does Deductible Apply?</label>
        <RadioGroup
          name={`${idPrefix}-deductibleApplies`}
          options={['Yes', 'No', 'Unsure']}
          value={values.deductibleApplies}
          onChange={(v) => onChange('deductibleApplies', v)}
        />
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor={`${idPrefix}-copayAmount`}>
          Copay ({unit})
        </label>
        <div className="coinsurance-row">
          <CurrencyInput
            id={`${idPrefix}-copayAmount`}
            value={values.copayAmount}
            onChange={(v) => onChange('copayAmount', v)}
            disabled={values.copayNa}
          />
          <label className="checkbox-label na-checkbox">
            <input
              type="checkbox"
              checked={values.copayNa}
              onChange={(e) => onChange('copayNa', e.target.checked)}
            />
            N/A
          </label>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor={`${idPrefix}-coinsurancePercent`}>
          Coinsurance %
        </label>
        <div className="coinsurance-row">
          <div className="percent-input-wrapper">
            <input
              id={`${idPrefix}-coinsurancePercent`}
              type="number"
              min="0"
              max="100"
              step="1"
              className="percent-input"
              value={values.coinsurancePercent}
              onChange={(e) => onChange('coinsurancePercent', e.target.value)}
              placeholder="0"
              disabled={values.coinsuranceNa}
            />
            <span className="percent-symbol">%</span>
          </div>
          <label className="checkbox-label na-checkbox">
            <input
              type="checkbox"
              checked={values.coinsuranceNa}
              onChange={(e) => onChange('coinsuranceNa', e.target.checked)}
            />
            N/A
          </label>
        </div>
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor={`${idPrefix}-contractRate`}>
          Contract Rate ({unit}) <span className="optional-hint">— optional</span>
        </label>
        <CurrencyInput
          id={`${idPrefix}-contractRate`}
          value={values.contractRate}
          onChange={(v) => onChange('contractRate', v)}
        />
        {rateDrivesCalculation && (
          <div className="info-banner">
            ℹ Used to calculate the actual per-visit amount — deductible-phase collection and
            coinsurance (contract rate × coinsurance %).
          </div>
        )}
      </div>
    </>
  )
}

// A rate that replaces the parent benefit's rules for one specific service —
// today, a psychiatric evaluation or follow-up priced separately from plain OP.
function ServiceRateCard({ idPrefix, title, values, onChange, resolved }) {
  return (
    <div className="service-rate-card">
      <div className="activity-row-header">
        <span className="activity-row-label">{title}</span>
      </div>

      <BenefitRuleFields idPrefix={idPrefix} values={values} onChange={onChange} unit="per visit" />

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={values.confirmed}
          onChange={(e) => onChange('confirmed', e.target.checked)}
        />
        {title} rate confirmed from insurance
      </label>

      <ResolvedBenefitPreview title={`Resolved ${title}`} resolved={resolved} />
    </div>
  )
}

// One level of care's benefit. The verified LOC's card is marked primary, but
// it behaves exactly like every other card.
function BenefitCard({
  benefit,
  isPrimary,
  roleTag,
  network,
  takenLocs,
  onChange,
  onRateChange,
  onRemove,
  resolveFor,
}) {
  const unit = benefit.loc ? unitLabel(benefit.loc) : 'per visit'
  // Bundling only exists as an INN program concept, and OP has no program to
  // bundle into.
  const showBundling = Boolean(benefit.loc) && benefit.loc !== 'OP' && network === 'INN'
  // Psychiatric work always bills under OP, so its rates belong to the OP card.
  const showPsychRates = benefit.loc === 'OP'
  const rateFor = (service) =>
    (benefit.serviceRates || []).find((r) => r.service === service) || makeServiceRate(service)

  return (
    <div className={`benefit-card${isPrimary ? ' benefit-card-primary' : ''}`}>
      <div className="activity-row-header">
        <span className="activity-row-label">
          {benefit.loc ? `${benefit.loc} Benefit` : 'New LOC Benefit'}
          {roleTag && <span className="primary-tag">{roleTag}</span>}
        </span>
        {!isPrimary && (
          <button type="button" className="btn-remove-activity" onClick={onRemove}>
            ✕ Remove
          </button>
        )}
      </div>

      {!isPrimary && (
        <div className="field-group">
          <label className="field-label">
            Level of Care <span className="required-star">*</span>
          </label>
          <RadioGroup
            name={`benefitLoc-${benefit.id}`}
            options={LOC_OPTIONS.filter((l) => l === benefit.loc || !takenLocs.includes(l))}
            value={benefit.loc}
            onChange={(v) => onChange('loc', v)}
          />
        </div>
      )}

      <BenefitRuleFields
        idPrefix={`benefit-${benefit.id}`}
        values={benefit}
        onChange={onChange}
        unit={unit}
      />

      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={benefit.confirmed}
          onChange={(e) => onChange('confirmed', e.target.checked)}
        />
        {benefit.loc ? `${benefit.loc} rules` : 'Rules'} confirmed from insurance
      </label>

      {benefit.loc && (
        <ResolvedBenefitPreview
          title={`Resolved ${benefit.loc} Benefit`}
          resolved={resolveFor('LOC_SERVICE')}
        />
      )}

      {/* Psychiatric rates — evaluations and follow-ups routinely price
          differently from each other and from the rest of the OP benefit. */}
      {showPsychRates && (
        <div className="benefit-subsection">
          <div className="field-group">
            <label className="field-label">
              Psychiatric Evaluations & Follow-Ups <span className="required-star">*</span>
            </label>
            <RadioGroup
              name={`psychRates-${benefit.id}`}
              options={[PSYCH_RATES.SAME, PSYCH_RATES.SEPARATE, PSYCH_RATES.UNSURE]}
              value={benefit.psychRates}
              onChange={(v) => onChange('psychRates', v)}
            />
            {benefit.psychRates === PSYCH_RATES.SAME && (
              <div className="info-banner">
                ℹ Psychiatric visits are priced at the OP rules above, at every level of care.
              </div>
            )}
            {benefit.psychRates === PSYCH_RATES.UNSURE && (
              <div className="alert-banner">
                ⚠ Psychiatric pricing is unconfirmed. No psychiatric evaluation or follow-up amount
                can be quoted until the plan's rates are verified with insurance.
              </div>
            )}
          </div>

          {benefit.psychRates === PSYCH_RATES.SEPARATE && (
            <div className="conditional-block">
              <div className="info-banner">
                ℹ These rates apply whenever the client is seen by psychiatry — including while
                they are enrolled in a program level of care such as IOP.
              </div>
              {PSYCH_RATE_SERVICES.map((service) => (
                <ServiceRateCard
                  key={service}
                  idPrefix={`benefit-${benefit.id}-${service}`}
                  title={serviceLabel(service)}
                  values={rateFor(service)}
                  onChange={(field, value) => onRateChange(service, field, value)}
                  resolved={resolveFor(service)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Services delivered during this LOC — bundling / cost-sharing model.
          This sits on top of the LOC's own rules: it decides which benefit a
          given service uses, or whether it is bundled at all. */}
      {showBundling && (
        <div className="benefit-subsection">
          <div className="field-group">
            <label className="field-label">
              Services During {benefit.loc} <span className="required-star">*</span>
            </label>
            <RadioGroup
              name={`bundlingModel-${benefit.id}`}
              options={[BUNDLING.STANDARD, BUNDLING.SEPARATE, BUNDLING.CUSTOM]}
              value={benefit.bundlingModel}
              onChange={(v) => onChange('bundlingModel', v)}
            />
            {benefit.bundlingModel === BUNDLING.STANDARD && (
              <div className="info-banner">
                ℹ Individual therapy, family therapy, and assessment are included in the{' '}
                {benefit.loc} benefit — $0 additional patient responsibility. Psychiatric services
                still use the OP benefit.
              </div>
            )}
            {benefit.bundlingModel === BUNDLING.SEPARATE && (
              <div className="conditional-block">
                <div className="field-group">
                  <label className="field-label">
                    Benefit used for individual therapy, family therapy, and assessment{' '}
                    <span className="required-star">*</span>
                  </label>
                  <RadioGroup
                    name={`separateServiceBenefit-${benefit.id}`}
                    options={[
                      { value: 'Same as LOC benefit', label: `Same as ${benefit.loc} benefit` },
                      { value: 'OP benefit', label: 'OP benefit' },
                    ]}
                    value={benefit.separateServiceBenefit}
                    onChange={(v) => onChange('separateServiceBenefit', v)}
                  />
                </div>
                <div className="info-banner">
                  ℹ Each service generates its own patient responsibility — nothing is bundled to
                  $0.
                </div>
              </div>
            )}
            {benefit.bundlingModel === BUNDLING.CUSTOM && (
              <div className="alert-banner">
                ⚠ Per-service responsibility and bundling are unconfirmed for {benefit.loc}. No
                individual therapy, family therapy, or assessment amount can be quoted until the
                plan's model is verified with insurance.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Read-only view of what the engine resolved, so staff can see the benefit that
// the generated output will actually describe.
function ResolvedBenefitPreview({ title, resolved }) {
  if (!resolved) return null
  const amountText = resolved.amountKnown
    ? `${money(resolved.amount)} ${resolved.unit}`
    : resolved.responsibilityType === RESPONSIBILITY.UNKNOWN
      ? 'Not established'
      : 'Contract rate not entered'
  const towardText = (value) => (value === null ? 'Confirm with plan' : value ? 'Yes' : 'No')

  return (
    <div className="calculated-fields">
      <div className="calc-field-row calc-total">
        <span className="calc-label">{title}</span>
        <span className="calc-value">{responsibilityTypeLabel(resolved.responsibilityType)}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Patient Responsibility</span>
        <span className="calc-value">{amountText}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Applies Toward Deductible</span>
        <span className="calc-value">{towardText(resolved.countsTowardDeductible)}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Applies Toward OOP Max</span>
        <span className="calc-value">{towardText(resolved.countsTowardOOP)}</span>
      </div>
    </div>
  )
}

// Section 4 captures what HAS happened financially. The benefit category,
// responsibility type and expected amount for a recorded service are derived
// from Sections 1–3 instead of being re-entered by hand.
function ActivityDerivedBenefit({ form, calc, activity }) {
  const derived = deriveActivityBenefit(form, calc, activity)
  if (!derived) return null
  if (derived.crossLoc) {
    return <div className="info-banner">ℹ {derived.note}</div>
  }

  const amountText = derived.amountKnown
    ? `${money(derived.amount)} ${derived.unit}`
    : derived.responsibilityType === RESPONSIBILITY.UNKNOWN
      ? 'Not established'
      : 'Contract rate not entered'
  const towardText = (value) => (value === null ? 'Confirm with plan' : value ? 'Yes' : 'No')

  return (
    <div className="calculated-fields">
      <div className="calc-field-row">
        <span className="calc-label">Benefit Category Used</span>
        <span className="calc-value">{derived.benefitLabel}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Responsibility Type</span>
        <span className="calc-value">{responsibilityTypeLabel(derived.responsibilityType)}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Expected Patient Responsibility</span>
        <span className="calc-value">{amountText}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Expected to Apply Toward Deductible</span>
        <span className="calc-value">{towardText(derived.countsTowardDeductible)}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Expected to Apply Toward OOP</span>
        <span className="calc-value">{towardText(derived.countsTowardOOP)}</span>
      </div>
      {derived.bundled && (
        <div className="calc-field-row">
          <span className="calc-label">Bundled</span>
          <span className="calc-value">Included in the {derived.contextLoc} bundle</span>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [form, setForm] = useState(INITIAL_FORM_STATE)
  const [submitted, setSubmitted] = useState(false)
  const [explanation, setExplanation] = useState('')

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }))
  const setCheck = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.checked }))

  const addActivity = () =>
    setForm((prev) => ({ ...prev, financialActivities: [...prev.financialActivities, makeActivity()] }))

  const removeActivity = (id) =>
    setForm((prev) => ({
      ...prev,
      financialActivities: prev.financialActivities.filter((a) => a.id !== id),
    }))

  const updateActivity = (id, field, value) =>
    setForm((prev) => ({
      ...prev,
      financialActivities: prev.financialActivities.map((a) =>
        a.id === id ? { ...a, [field]: value } : a
      ),
    }))

  const addLocBenefit = () =>
    setForm((prev) => ({ ...prev, locBenefits: [...prev.locBenefits, makeBenefit()] }))

  const removeLocBenefit = (id) =>
    setForm((prev) => ({ ...prev, locBenefits: prev.locBenefits.filter((b) => b.id !== id) }))

  const applyRuleEdit = (rules, field, value) => {
    const next = { ...rules, [field]: value }
    if (field === 'copayNa' && value) next.copayAmount = ''
    if (field === 'coinsuranceNa' && value) next.coinsurancePercent = ''
    return next
  }

  const updateLocBenefit = (id, field, value) =>
    setForm((prev) => ({
      ...prev,
      locBenefits: prev.locBenefits.map((b) => {
        if (b.id !== id) return b
        const next = applyRuleEdit(b, field, value)
        // Switching a LOC's card wipes rules that only made sense for the old
        // LOC — OP has no bundling, and only OP carries psychiatric rates.
        if (field === 'loc') {
          if (value === 'OP') {
            next.bundlingModel = ''
            next.separateServiceBenefit = ''
          } else {
            next.psychRates = ''
            next.serviceRates = []
          }
        }
        if (field === 'bundlingModel' && value !== BUNDLING.SEPARATE) {
          next.separateServiceBenefit = ''
        }
        if (field === 'psychRates') {
          next.serviceRates =
            value === PSYCH_RATES.SEPARATE
              ? PSYCH_RATE_SERVICES.map(
                  (s) => (b.serviceRates || []).find((r) => r.service === s) || makeServiceRate(s)
                )
              : []
        }
        return next
      }),
    }))

  const updateServiceRate = (benefitId, service, field, value) =>
    setForm((prev) => ({
      ...prev,
      locBenefits: prev.locBenefits.map((b) =>
        b.id !== benefitId
          ? b
          : {
              ...b,
              serviceRates: (b.serviceRates || []).map((r) =>
                r.service === service ? applyRuleEdit(r, field, value) : r
              ),
            }
      ),
    }))

  // Choosing the verified LOC creates its benefit card if the call has not
  // already produced one, and leaves every other stored benefit untouched.
  const setVerifiedLoc = (loc) =>
    setForm((prev) => {
      // A step-down must still be to a less intensive level of care; from the
      // lowest one there is nowhere left to step down to.
      const targets = stepDownOptions(loc)
      return {
        ...prev,
        verifiedLoc: loc,
        stepDownPlanned: targets.length > 0 ? prev.stepDownPlanned : '',
        stepDownLoc: targets.includes(prev.stepDownLoc) ? prev.stepDownLoc : '',
        stepDownDate: targets.length > 0 ? prev.stepDownDate : '',
        locBenefits: ensureBenefitFor(prev.locBenefits, loc),
      }
    })

  // A step-down is a second set of rates on the same plan, so naming one opens
  // that LOC's benefit card for entry.
  const setStepDownLoc = (loc) =>
    setForm((prev) => ({
      ...prev,
      stepDownLoc: loc,
      locBenefits: ensureBenefitFor(prev.locBenefits, loc),
    }))

  const setStepDownPlanned = (value) =>
    setForm((prev) => ({
      ...prev,
      stepDownPlanned: value,
      ...(value === 'Yes' ? {} : { stepDownLoc: '', stepDownDate: '' }),
    }))

  // ── Derived state ──────────────────────────────────────
  const isNotYetAdmitted = form.currentStatus === 'Not yet admitted'
  const isActiveClient =
    form.currentStatus === 'Currently in treatment' || form.currentStatus === 'Discharged'

  const isCrossLoc =
    isActiveClient &&
    Boolean(form.currentLoc) &&
    form.currentLoc !== 'None' &&
    Boolean(form.verifiedLoc) &&
    form.currentLoc !== form.verifiedLoc

  const calc = computeCalc(form)
  const { totalClientPaymentsToOop, totalAssistanceToOop, totalEpisodeActivityToOop,
    totalEpisodeActivityToDeductible, calculatedOopRemaining, oopSatisfied,
    deductibleRemaining } = calc

  const hasActivities = form.financialActivities.length > 0

  const stepDownTargets = stepDownOptions(form.verifiedLoc)
  const plannedStepDownLoc =
    form.stepDownPlanned === 'Yes' && form.stepDownLoc ? form.stepDownLoc : null
  // The levels of care this VOB actually generates collection instructions for.
  const instructedLocs = [form.verifiedLoc, plannedStepDownLoc].filter(Boolean)

  // The verified LOC's card sorts first, then the step-down; the rest keep
  // insertion order.
  const primaryBenefit = form.locBenefits.find((b) => b.loc && b.loc === form.verifiedLoc) || null
  const stepDownBenefit =
    plannedStepDownLoc && plannedStepDownLoc !== form.verifiedLoc
      ? form.locBenefits.find((b) => b.loc === plannedStepDownLoc) || null
      : null
  const orderedBenefits = [
    ...[primaryBenefit, stepDownBenefit].filter(Boolean),
    ...form.locBenefits.filter((b) => b !== primaryBenefit && b !== stepDownBenefit),
  ]

  const resolvedLocBenefit = form.verifiedLoc ? resolveBenefit(form, calc, 'LOC_SERVICE') : null

  const showNoResponsibilityWarning =
    Boolean(form.verifiedLoc) &&
    !oopSatisfied &&
    resolvedLocBenefit &&
    resolvedLocBenefit.responsibilityType === RESPONSIBILITY.NONE

  // ── Submit blockers ────────────────────────────────────
  const submitBlockers = []

  if (!form.verifiedLoc) submitBlockers.push('Verified LOC must be selected')

  if (isActiveClient && !form.currentLoc) {
    submitBlockers.push('Current / Most Recent LOC is required when client is in treatment or discharged')
  }

  if (form.verifiedLoc && !primaryBenefit) {
    submitBlockers.push(`A ${form.verifiedLoc} benefit must be entered in Section 3`)
  }

  // A step-down changes the rates the client will be quoted, so it has to name
  // a LOC and that LOC's benefit has to exist.
  if (stepDownTargets.length > 0 && !form.stepDownPlanned) {
    submitBlockers.push('Planned Step-Down must be answered')
  }
  if (stepDownTargets.length > 0 && form.stepDownPlanned === 'Unsure') {
    submitBlockers.push('Planned step-down must be confirmed before generating summary.')
  }
  if (stepDownTargets.length > 0 && form.stepDownPlanned === 'Yes' && !form.stepDownLoc) {
    submitBlockers.push('Step-Down LOC must be selected')
  }
  if (plannedStepDownLoc && !stepDownBenefit) {
    submitBlockers.push(`A ${plannedStepDownLoc} benefit must be entered in Section 3`)
  }

  // Cost-sharing rules, whether they belong to a LOC benefit or to a
  // service-specific rate that overrides it.
  const checkRules = (label, rules) => {
    if (!rules.deductibleApplies) submitBlockers.push(`${label}: Deductible Applies must be selected`)
    if (rules.deductibleApplies === 'Unsure') {
      submitBlockers.push(`${label}: deductible applicability must be confirmed before generating summary.`)
    }
    if (!rules.copayNa && rules.copayAmount === '') {
      submitBlockers.push(`${label}: Copay must be entered or marked N/A`)
    }
    if (!rules.coinsuranceNa && rules.coinsurancePercent === '') {
      submitBlockers.push(`${label}: Coinsurance % must be entered or marked N/A`)
    }
    if (!rules.confirmed) submitBlockers.push(`${label}: rules must be confirmed from insurance`)
  }

  // Every stored benefit is held to the same standard, primary or not — a
  // half-entered LOC rule is worse than no LOC rule.
  form.locBenefits.forEach((b, i) => {
    const label = b.loc || `LOC benefit ${i + 1}`
    if (!b.loc) {
      submitBlockers.push(`${label}: Level of Care must be selected`)
    } else if (form.locBenefits.filter((o) => o.loc === b.loc).length > 1) {
      submitBlockers.push(`${b.loc}: only one benefit can be entered per level of care`)
    }
    checkRules(label, b)

    // Psychiatric work always bills under OP, so the OP benefit has to say
    // whether the plan prices evaluations and follow-ups at its own rate.
    if (b.loc === 'OP') {
      if (!b.psychRates) {
        submitBlockers.push('OP benefit: psychiatric evaluation / follow-up rates must be answered')
      }
      if (b.psychRates === PSYCH_RATES.UNSURE) {
        submitBlockers.push(
          'Psychiatric evaluation and follow-up rates must be confirmed before generating summary.'
        )
      }
      if (b.psychRates === PSYCH_RATES.SEPARATE) {
        (b.serviceRates || []).forEach((rate) => checkRules(serviceLabel(rate.service), rate))
      }
    }

    // Bundling is only required for the levels of care this VOB will quote.
    // Submitting finalizes the VOB and generates actionable collection
    // instructions, so an unconfirmed cost-sharing model gates it the same way
    // the other unresolved insurance rules do.
    if (b.loc && b.loc !== 'OP' && form.network === 'INN' && instructedLocs.includes(b.loc)) {
      if (!b.bundlingModel) {
        submitBlockers.push(`${b.loc}: Services During ${b.loc} (bundling model) must be selected`)
      }
      if (b.bundlingModel === BUNDLING.CUSTOM) {
        submitBlockers.push(
          `${b.loc}: per-service cost sharing must be confirmed before generating summary.`
        )
      }
      if (b.bundlingModel === BUNDLING.SEPARATE && !b.separateServiceBenefit) {
        submitBlockers.push(
          `${b.loc}: benefit used for individual therapy, family therapy, and assessment must be selected`
        )
      }
    }
  })


  // Rule 5 & 6 — structure/deductible blockers
  if (form.deductibleOopStructure === 'Unsure') {
    submitBlockers.push('Deductible/OOP structure must be confirmed before generating summary.')
  }

  if (!form.deductibleTotal) submitBlockers.push('Deductible Total is required')
  if (!form.oopMaxTotal) submitBlockers.push('OOP Max Total is required')

  // Rule 3 & 4 — episode activity validation
  form.financialActivities.forEach((act, i) => {
    const n = i + 1
    if (!act.sourceReviewed) submitBlockers.push(`Activity ${n}: Source Reviewed is required`)
    if (!act.appliesTo) submitBlockers.push(`Activity ${n}: Applies To is required`)
    if (!act.countsTowardOop) submitBlockers.push(`Activity ${n}: Counts Toward OOP is required`)
    if (!act.countsTowardDeductible) submitBlockers.push(`Activity ${n}: Counts Toward Deductible is required`)
  })

  if (form.financialActivities.some((a) => a.appliesTo === 'Unsure' || a.countsTowardOop === 'Unsure')) {
    submitBlockers.push('Financial activity application must be confirmed before generating summary.')
  }

  if (form.hasCurrentBalance === 'Yes') {
    if (!form.balanceAmount) submitBlockers.push('Balance Amount is required')
    if (!form.balanceType) submitBlockers.push('Balance Type is required')
  }

  // Rule 10 — Final Check gates
  if (!form.deductibleOopReviewed) submitBlockers.push('Deductible/OOP must be reviewed (Final Check)')
  if (!form.networkConfirmed) submitBlockers.push('Network must be confirmed (Final Check)')
  if (!form.locRulesEntered) submitBlockers.push('LOC rules must be entered (Final Check)')
  if (hasActivities && !form.episodeActivityReviewed) {
    submitBlockers.push('Episode financial activity must be reviewed (Final Check)')
  }
  if (form.hasCurrentBalance === 'Yes' && !form.balanceReviewed) {
    submitBlockers.push('Balance must be reviewed (Final Check)')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (submitBlockers.length > 0) return
    setExplanation(generateExplanation(form))
    setSubmitted(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleReset = () => {
    setForm(INITIAL_FORM_STATE)
    setSubmitted(false)
    setExplanation('')
  }

  const handleEdit = () => {
    setSubmitted(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>INSURANCE SNAPSHOT</h1>
      </header>

      {submitted ? (
        <div className="explanation-card">
          <h2>Client Explanation</h2>
          <pre className="explanation-text">{explanation}</pre>
          <div className="explanation-actions">
            <button className="btn-secondary" onClick={handleEdit}>← Edit</button>
            <button className="btn-secondary" onClick={handleReset}>↺ Start New Snapshot</button>
          </div>
        </div>
      ) : (
        <form className="snapshot-form" onSubmit={handleSubmit}>

          {/* SECTION 1 — Plan Basics */}
          <section className="form-section">
            <h2 className="section-title">Section 1 — Plan Basics</h2>

            <div className="field-group">
              <label className="field-label">Network</label>
              <RadioGroup name="network" options={['INN', 'OON']} value={form.network} onChange={set('network')} />
            </div>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="deductibleTotal">
                  Deductible Total <span className="required-star">*</span>
                </label>
                <CurrencyInput id="deductibleTotal" value={form.deductibleTotal} onChange={set('deductibleTotal')} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="deductibleMet">Deductible Met</label>
                <CurrencyInput id="deductibleMet" value={form.deductibleMet} onChange={set('deductibleMet')} />
              </div>
            </div>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="oopMaxTotal">
                  OOP Max Total <span className="required-star">*</span>
                </label>
                <CurrencyInput id="oopMaxTotal" value={form.oopMaxTotal} onChange={set('oopMaxTotal')} />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="oopMet">OOP Met</label>
                <CurrencyInput id="oopMet" value={form.oopMet} onChange={set('oopMet')} />
              </div>
            </div>

            {oopSatisfied && (
              <div className="success-banner">
                ✓ OOP MAX MET — no further cost sharing will be applied in the generated explanation
              </div>
            )}

            <div className="field-group">
              <label className="field-label">Deductible / OOP Structure</label>
              <RadioGroup
                name="deductibleOopStructure"
                options={['Combined', 'Separate', 'Unsure']}
                value={form.deductibleOopStructure}
                onChange={set('deductibleOopStructure')}
              />
              {form.deductibleOopStructure === 'Combined' && (
                <div className="info-banner">ℹ Combined: deductible payments count toward Out-of-Pocket Maximum</div>
              )}
              {form.deductibleOopStructure === 'Separate' && (
                <div className="info-banner">ℹ Separate: deductible and OOP Maximum tracked independently</div>
              )}
            </div>
          </section>

          {/* SECTION 2 — Level of Care */}
          <section className="form-section">
            <h2 className="section-title">Section 2 — Level of Care</h2>

            <div className="field-group">
              <label className="field-label">Current Status</label>
              <RadioGroup
                name="currentStatus"
                options={['Not yet admitted', 'Currently in treatment', 'Discharged']}
                value={form.currentStatus}
                onChange={set('currentStatus')}
              />
            </div>

            <div className="field-group">
              <label className="field-label">
                Current / Most Recent LOC
                {isActiveClient && <span className="required-star"> *</span>}
              </label>
              <RadioGroup
                name="currentLoc"
                options={['None', 'Detox', 'Resi', 'PHP', 'IOP', 'OP']}
                value={form.currentLoc}
                onChange={set('currentLoc')}
              />
              {isNotYetAdmitted && (
                <div className="info-banner">ℹ "None" is valid — client has not yet been admitted</div>
              )}
            </div>

            <div className="field-group">
              <label className="field-label">
                Verified LOC (what this VOB is for) <span className="required-star">*</span>
              </label>
              <RadioGroup
                name="verifiedLoc"
                options={['Detox', 'Resi', 'PHP', 'IOP', 'OP']}
                value={form.verifiedLoc}
                onChange={setVerifiedLoc}
              />
            </div>

            {isCrossLoc && (
              <div className="alert-banner">
                ⚠ Cross-LOC scenario — episode financial activity should be reviewed before generating output.
              </div>
            )}

            {/* A step-down keeps the same plan and the same accumulators, but
                cost sharing switches to the lower LOC's benefit. */}
            {stepDownTargets.length > 0 && (
              <div className="field-group">
                <label className="field-label">
                  Planned Step-Down From {form.verifiedLoc}?{' '}
                  <span className="required-star">*</span>
                </label>
                <RadioGroup
                  name="stepDownPlanned"
                  options={['Yes', 'No', 'Unsure']}
                  value={form.stepDownPlanned}
                  onChange={setStepDownPlanned}
                />

                {form.stepDownPlanned === 'Yes' && (
                  <div className="conditional-block">
                    <div className="field-group">
                      <label className="field-label">
                        Step-Down LOC <span className="required-star">*</span>
                      </label>
                      <RadioGroup
                        name="stepDownLoc"
                        options={stepDownTargets}
                        value={form.stepDownLoc}
                        onChange={setStepDownLoc}
                      />
                    </div>
                    <div className="field-group">
                      <label className="field-label" htmlFor="stepDownDate">
                        Expected Step-Down Date{' '}
                        <span className="optional-hint">— optional</span>
                      </label>
                      <input
                        id="stepDownDate"
                        type="date"
                        className="date-input"
                        value={form.stepDownDate}
                        onChange={(e) => set('stepDownDate')(e.target.value)}
                      />
                    </div>
                    {form.stepDownLoc && (
                      <div className="info-banner">
                        ℹ Cost sharing changes at the step-down. Enter the {form.stepDownLoc}{' '}
                        benefit in Section 3 — the deductible and OOP maximum carry over, the rates
                        do not.
                      </div>
                    )}
                  </div>
                )}

                {form.stepDownPlanned === 'Unsure' && (
                  <div className="alert-banner">
                    ⚠ Confirm whether a step-down is planned — ongoing costs cannot be quoted
                    without knowing which benefit applies going forward.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* SECTION 3 — Benefits by Level of Care */}
          <section className="form-section">
            <h2 className="section-title">Section 3 — Benefits by Level of Care</h2>

            {!form.verifiedLoc && (
              <div className="info-banner">ℹ Select a Verified LOC in Section 2 to activate these rules</div>
            )}

            <div className="info-banner">
              ℹ Each level of care carries its own independent benefit, including how services
              delivered during it are bundled. Record every LOC the verification call covers — the
              Verified LOC is the one this VOB collects against, but it does not limit what can be
              stored. Psychiatric services always bill under the OP benefit, so add OP when psych
              visits are expected, and record its psychiatric rates there.
            </div>

            {orderedBenefits.map((benefit) => (
              <BenefitCard
                key={benefit.id}
                benefit={benefit}
                isPrimary={Boolean(form.verifiedLoc) && benefit.loc === form.verifiedLoc}
                roleTag={
                  benefit.loc && benefit.loc === form.verifiedLoc
                    ? 'Verified LOC'
                    : benefit.loc && benefit.loc === plannedStepDownLoc
                      ? 'Step-Down'
                      : null
                }
                network={form.network}
                takenLocs={form.locBenefits.map((b) => b.loc).filter(Boolean)}
                onChange={(field, value) => updateLocBenefit(benefit.id, field, value)}
                onRateChange={(service, field, value) =>
                  updateServiceRate(benefit.id, service, field, value)
                }
                onRemove={() => removeLocBenefit(benefit.id)}
                resolveFor={(serviceKey) =>
                  benefit.loc ? resolveBenefit(form, calc, serviceKey, benefit.loc) : null
                }
              />
            ))}

            {form.locBenefits.length < LOC_OPTIONS.length && (
              <button type="button" className="btn-add-activity" onClick={addLocBenefit}>
                + Add Another LOC Benefit
              </button>
            )}

            {showNoResponsibilityWarning && (
              <div className="confirm-prompt">
                ⚠ No deductible, copay, or coinsurance is recorded for {form.verifiedLoc} — confirm
                the plan covers it at 100%.
              </div>
            )}

          </section>


          {/* SECTION 4 — Episode Financial Activity */}
          <section className="form-section">
            <h2 className="section-title">Section 4 — Episode Financial Activity</h2>

            {isNotYetAdmitted && !hasActivities && (
              <div className="info-banner" style={{ marginBottom: '16px' }}>
                ℹ Episode financial activity is optional for clients not yet admitted
              </div>
            )}

            {form.financialActivities.map((act, i) => (
              <div key={act.id} className="activity-row">
                <div className="activity-row-header">
                  <span className="activity-row-label">Activity {i + 1}</span>
                  <button
                    type="button"
                    className="btn-remove-activity"
                    onClick={() => removeActivity(act.id)}
                  >
                    ✕ Remove
                  </button>
                </div>

                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">Activity LOC</label>
                    <RadioGroup
                      name={`activityLoc-${act.id}`}
                      options={['Detox', 'Resi', 'PHP', 'IOP', 'OP', 'Other']}
                      value={act.activityLoc}
                      onChange={(v) => updateActivity(act.id, 'activityLoc', v)}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">Activity Status</label>
                    <RadioGroup
                      name={`activityStatus-${act.id}`}
                      options={['Completed', 'Ongoing', 'Discharged', 'Adjustment only']}
                      value={act.activityStatus}
                      onChange={(v) => updateActivity(act.id, 'activityStatus', v)}
                    />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">Service Type</label>
                    <RadioGroup
                      name={`serviceType-${act.id}`}
                      options={SERVICE_OPTIONS.map((key) => ({
                        value: key,
                        label: serviceLabel(key, act.activityLoc || form.verifiedLoc),
                      }))}
                      value={act.serviceType}
                      onChange={(v) => updateActivity(act.id, 'serviceType', v)}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor={`serviceDate-${act.id}`}>
                      Date of Service
                    </label>
                    <input
                      id={`serviceDate-${act.id}`}
                      type="date"
                      className="date-input"
                      value={act.serviceDate}
                      onChange={(e) => updateActivity(act.id, 'serviceDate', e.target.value)}
                    />
                  </div>
                </div>

                {/* Benefit category, responsibility type and expected amount are
                    derived rather than entered by hand. */}
                <ActivityDerivedBenefit form={form} calc={calc} activity={act} />

                <div className="field-group">
                  <label className="field-label" htmlFor={`sourceReviewed-${act.id}`}>
                    Source Reviewed <span className="required-star">*</span>
                  </label>
                  <input
                    id={`sourceReviewed-${act.id}`}
                    type="text"
                    className="text-input"
                    value={act.sourceReviewed}
                    onChange={(e) => updateActivity(act.id, 'sourceReviewed', e.target.value)}
                    placeholder="Example: Detox FA dated MM/DD/YYYY, Salesforce note, payment ledger, etc."
                  />
                </div>

                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label" htmlFor={`clientPayment-${act.id}`}>
                      Client Payment Applied
                    </label>
                    <CurrencyInput
                      id={`clientPayment-${act.id}`}
                      value={act.clientPaymentApplied}
                      onChange={(v) => updateActivity(act.id, 'clientPaymentApplied', v)}
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor={`assistance-${act.id}`}>
                      Financial Assistance Applied
                    </label>
                    <CurrencyInput
                      id={`assistance-${act.id}`}
                      value={act.financialAssistanceApplied}
                      onChange={(v) => updateActivity(act.id, 'financialAssistanceApplied', v)}
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label">Assistance Type</label>
                  <RadioGroup
                    name={`assistanceType-${act.id}`}
                    options={['Scholarship', 'Hardship', 'Courtesy Adjustment', 'Other', 'None']}
                    value={act.assistanceType}
                    onChange={(v) => updateActivity(act.id, 'assistanceType', v)}
                  />
                </div>

                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">
                      Applies To <span className="required-star">*</span>
                    </label>
                    <RadioGroup
                      name={`appliesTo-${act.id}`}
                      options={['Deductible', 'OOP', 'Balance', 'Multiple', 'Unsure']}
                      value={act.appliesTo}
                      onChange={(v) => updateActivity(act.id, 'appliesTo', v)}
                    />
                  </div>
                  <div className="field-group">
                    <div className="field-group">
                      <label className="field-label">
                        Counts Toward OOP <span className="required-star">*</span>
                      </label>
                      <RadioGroup
                        name={`countsTowardOop-${act.id}`}
                        options={['Yes', 'No', 'Unsure']}
                        value={act.countsTowardOop}
                        onChange={(v) => updateActivity(act.id, 'countsTowardOop', v)}
                      />
                    </div>
                    <div className="field-group" style={{ marginTop: '14px' }}>
                      <label className="field-label">
                        Counts Toward Deductible <span className="required-star">*</span>
                      </label>
                      <RadioGroup
                        name={`countsTowardDeductible-${act.id}`}
                        options={['Yes', 'No', 'Unsure']}
                        value={act.countsTowardDeductible}
                        onChange={(v) => updateActivity(act.id, 'countsTowardDeductible', v)}
                      />
                    </div>
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label" htmlFor={`notes-${act.id}`}>Notes</label>
                  <input
                    id={`notes-${act.id}`}
                    type="text"
                    className="text-input"
                    value={act.notes}
                    onChange={(e) => updateActivity(act.id, 'notes', e.target.value)}
                    placeholder="Optional notes"
                  />
                </div>

                {act.appliesTo === 'Unsure' && (
                  <div className="alert-banner">
                    ⚠ "Applies To" must be resolved before generating output.
                  </div>
                )}
                {act.countsTowardOop === 'Unsure' && (
                  <div className="alert-banner">
                    ⚠ "Counts Toward OOP" must be resolved before generating output.
                  </div>
                )}
              </div>
            ))}

            <button type="button" className="btn-add-activity" onClick={addActivity}>
              + Add Financial Activity
            </button>

            {/* Calculated totals */}
            {(hasActivities || deductibleRemaining !== null || calculatedOopRemaining !== null) && (
              <div className="calculated-fields">
                {hasActivities && (
                  <>
                    <div className="calc-field-row">
                      <span className="calc-label">Total Client Payments Applied to OOP</span>
                      <span className="calc-value">${formatCurrency(totalClientPaymentsToOop)}</span>
                    </div>
                    <div className="calc-field-row">
                      <span className="calc-label">Total Assistance Applied to OOP</span>
                      <span className="calc-value">${formatCurrency(totalAssistanceToOop)}</span>
                    </div>
                    <div className="calc-field-row calc-total">
                      <span className="calc-label">Total Episode Activity Applied to OOP</span>
                      <span className="calc-value">${formatCurrency(totalEpisodeActivityToOop)}</span>
                    </div>
                    <div className="calc-field-row">
                      <span className="calc-label">Total Episode Activity Applied to Deductible</span>
                      <span className="calc-value">${formatCurrency(totalEpisodeActivityToDeductible)}</span>
                    </div>
                  </>
                )}
                {calculatedOopRemaining !== null && (
                  <div className={`calc-field-row${calculatedOopRemaining === 0 ? ' calc-oop-met' : ''}`}>
                    <span className="calc-label">Calculated OOP Remaining</span>
                    <span className="calc-value">${formatCurrency(calculatedOopRemaining)}</span>
                  </div>
                )}
                {deductibleRemaining !== null && (
                  <div className="calc-field-row">
                    <span className="calc-label">Deductible Remaining</span>
                    <span className="calc-value">${formatCurrency(deductibleRemaining)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Current Balance */}
            <div className="balance-subsection">
              <div className="field-group">
                <label className="field-label">Current Balance?</label>
                <RadioGroup
                  name="hasCurrentBalance"
                  options={['Yes', 'No']}
                  value={form.hasCurrentBalance}
                  onChange={set('hasCurrentBalance')}
                />
              </div>

              {form.hasCurrentBalance === 'Yes' && (
                <div className="conditional-block">
                  <div className="field-group">
                    <label className="field-label" htmlFor="balanceAmount">
                      Balance Amount <span className="required-star">*</span>
                    </label>
                    <CurrencyInput id="balanceAmount" value={form.balanceAmount} onChange={set('balanceAmount')} />
                  </div>
                  <div className="field-group">
                    <label className="field-label">
                      Balance Type <span className="required-star">*</span>
                    </label>
                    <RadioGroup
                      name="balanceType"
                      options={['Deductible', 'Coinsurance', 'Copay', 'Prior LOC', 'NSF', 'Other']}
                      value={form.balanceType}
                      onChange={set('balanceType')}
                    />
                  </div>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={form.balanceReviewed} onChange={setCheck('balanceReviewed')} />
                    Balance reviewed
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 5 — Final Check */}
          <section className="form-section">
            <h2 className="section-title">Section 5 — Final Check</h2>

            <div className="checklist">
              <label className="checkbox-label checklist-item">
                <input type="checkbox" checked={form.deductibleOopReviewed} onChange={setCheck('deductibleOopReviewed')} />
                Deductible/OOP reviewed
              </label>
              <label className="checkbox-label checklist-item">
                <input type="checkbox" checked={form.networkConfirmed} onChange={setCheck('networkConfirmed')} />
                Network confirmed
              </label>
              <label className="checkbox-label checklist-item">
                <input type="checkbox" checked={form.locRulesEntered} onChange={setCheck('locRulesEntered')} />
                LOC rules entered
              </label>
              {hasActivities && (
                <label className="checkbox-label checklist-item">
                  <input type="checkbox" checked={form.episodeActivityReviewed} onChange={setCheck('episodeActivityReviewed')} />
                  Episode financial activity reviewed
                </label>
              )}
              {form.hasCurrentBalance === 'Yes' && (
                <label className="checkbox-label checklist-item">
                  <input type="checkbox" checked={form.balanceReviewed} onChange={setCheck('balanceReviewed')} />
                  Balance reviewed
                </label>
              )}
            </div>
          </section>

          {/* SUBMIT */}
          <div className="submit-row">
            {submitBlockers.length > 0 && (
              <div className="submit-blockers">
                <div className="submit-blockers-title">Cannot submit — resolve the following:</div>
                <ul>
                  {submitBlockers.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}
            <button type="submit" className="btn-submit" disabled={submitBlockers.length > 0}>
              SUBMIT → SYSTEM GENERATES CLIENT EXPLANATION
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
