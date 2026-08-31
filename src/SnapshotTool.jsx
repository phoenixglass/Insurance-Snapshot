import { useState } from 'react'
import {
  BUNDLING,
  COPAY_BASIS,
  LOC_OPTIONS,
  RESPONSIBILITY,
  computeCalc,
  conflictingLocs,
  contractRateSubject,
  copayBasisApplies,
  deriveActivityBenefit,
  isCombinedAdmission,
  isPerDiemLoc,
  locServiceName,
  locWithin,
  formatCurrency,
  money,
  ownServicePricedApart,
  resolveBenefit,
  responsibilityTypeLabel,
  selectableLocs,
  serviceLabel,
  unitLabel,
} from './benefits.js'
import { generateSnapshot } from './summary.js'
import { CurrencyInput, RadioGroup } from './ui.jsx'

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

// Detox and Resi are frequently authorized as one continuous admission, so the
// combined stay is offered as its own level of care rather than being assembled
// out of two separate ones.
const LOC_LABELS = {
  'Detox/Resi': 'Detox + Resi (one admission)',
}

const locOptionsFrom = (locs) =>
  locs.map((loc) => ({ value: loc, label: LOC_LABELS[loc] || loc }))

// One independent benefit configuration per level of care. Every LOC — including
// OP — uses this same shape; none of them is a special case.
const makeBenefit = (loc = '') => ({
  id: `${Date.now()}-${Math.random()}`,
  loc,
  deductibleApplies: '',
  copayAmount: '',
  copayNa: false,
  copayBasis: '',
  coinsurancePercent: '',
  coinsuranceNa: false,
  contractRate: '',
  telehealthCovered: false,
  confirmed: false,
})

// Selecting a verified LOC names which stored benefit is primary. It never
// discards benefits already captured for other levels of care.
const ensureBenefitFor = (benefits, loc) =>
  !loc || benefits.some((b) => b.loc === loc) ? benefits : [...benefits, makeBenefit(loc)]

const ACTIVITY_SERVICE_OPTIONS = ['LOC_SERVICE', 'IT', 'FT', 'ASSESSMENT', 'PSYCH', 'OTHER']

const INITIAL_FORM_STATE = {
  // Section 1 — Plan Basics
  network: '',
  deductibleTotal: '',
  deductibleMet: '',
  // Some plans simply do not have one. That is a fact about the plan, not a
  // blank field, so it is recorded rather than left for someone to enter $0.
  noDeductible: false,
  oopMaxTotal: '',
  oopMet: '',
  noOopMax: false,
  deductibleOopStructure: '',

  // Section 2 — Level of Care
  currentStatus: '',
  currentLoc: '',
  verifiedLoc: '',

  // Section 3 — one benefit configuration per level of care
  locBenefits: [],

  // Section 3 — how services delivered during the verified LOC are cost-shared
  bundlingModel: '',
  separateServiceBenefit: '',

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


// Cost-sharing rules for one benefit category. Copay and coinsurance are both
// first-class: "deductible applies = No" says nothing about which of the two
// the plan actually uses, so each has to be entered or explicitly marked N/A.
function BenefitRuleFields({ idPrefix, values, onChange, unit, loc, noDeductible }) {
  const coinsurancePct =
    !values.coinsuranceNa && values.coinsurancePercent !== ''
      ? parseFloat(values.coinsurancePercent)
      : 0
  const hasCopay = !values.copayNa && values.copayAmount !== '' && parseFloat(values.copayAmount) > 0
  // The rate is always recordable — a LOC can have both a contracted rate and a
  // copay — but it only drives a calculation in the deductible/coinsurance case,
  // or when it caps a copay we would otherwise over-collect.
  const rateDrivesCalculation =
    values.deductibleApplies === 'Yes' || coinsurancePct > 0 || hasCopay
  // A per diem level of care is billed daily, but its copay is frequently a
  // single charge for the admission. Which one it is has to be asked.
  const showCopayBasis = copayBasisApplies(loc) && hasCopay
  // The unit is stated in the label only where nothing else states it. Where
  // the basis question below is asked, a "(per day)" in the label contradicts
  // the per-admission answer sitting directly underneath it.
  const copayUnitHint = copayBasisApplies(loc) ? '' : ` (${unit})`

  return (
    <>
      {noDeductible ? (
        <div className="info-banner">
          ℹ This plan has no deductible (Section 1), so no deductible applies to this benefit.
        </div>
      ) : (
        <div className="field-group">
          <label className="field-label">Does Deductible Apply?</label>
          <RadioGroup
            name={`${idPrefix}-deductibleApplies`}
            options={['Yes', 'No', 'Unsure']}
            value={values.deductibleApplies}
            onChange={(v) => onChange('deductibleApplies', v)}
          />
        </div>
      )}

      <div className="field-group">
        <label className="field-label" htmlFor={`${idPrefix}-copayAmount`}>
          Copay{copayUnitHint}
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
        {showCopayBasis && (
          <div className="conditional-block">
            <label className="field-label">
              Is that copay charged per day or once per admission?{' '}
              <span className="required-star">*</span>
            </label>
            <RadioGroup
              name={`${idPrefix}-copayBasis`}
              options={[
                { value: COPAY_BASIS.PER_ADMISSION, label: 'Once per admission' },
                { value: COPAY_BASIS.PER_UNIT, label: 'Per day' },
              ]}
              value={values.copayBasis}
              onChange={(v) => onChange('copayBasis', v)}
            />
            {values.copayBasis === COPAY_BASIS.PER_UNIT && (
              <div className="alert-banner">
                ⚠ A daily copay is charged for every day of the stay. Most VOBs that say "copay per
                admission" mean the other option — confirm before quoting.
              </div>
            )}
            {/* The step down from detox into residential is the moment this
                answer gets tested, so it is answered where it is entered. */}
            {values.copayBasis === COPAY_BASIS.PER_ADMISSION && isCombinedAdmission(loc) && (
              <div className="info-banner">
                ℹ One copay for the entire stay. Detox and Resi were authorized as a single
                admission, so moving from detox into residential does not trigger a second copay.
              </div>
            )}
          </div>
        )}
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
          Contract Rate{loc ? ` — ${locServiceName(loc)}` : ''} ({unit}){' '}
          <span className="optional-hint">— optional</span>
        </label>
        <CurrencyInput
          id={`${idPrefix}-contractRate`}
          value={values.contractRate}
          onChange={(v) => onChange('contractRate', v)}
        />
        {/* The rate belongs to one service, not to the whole benefit. Saying so
            here is what stops a group rate from being read as an OP-wide rate —
            and, just as importantly, stops the copay above from being read as a
            group-only price. */}
        <div className="info-banner">
          {isPerDiemLoc(loc) ? (
            <>
              ℹ This is the contracted rate for {contractRateSubject(loc)}. Individual therapy,
              family therapy, and assessment delivered during the stay are part of the per diem —
              they are not billed or quoted separately.
            </>
          ) : (
            <>
              ℹ The copay above applies to every service billing under this benefit. This is the
              contracted rate for {loc ? contractRateSubject(loc) : 'this service'} only —
              individual therapy, family therapy, assessment, and psychiatric visits bill under
              their own codes at their own rates, so this number does not apply to them.
            </>
          )}
          {rateDrivesCalculation && (
            <>
              {' '}
              It calculates deductible-phase collection and coinsurance (rate × coinsurance %), and
              caps {loc ? locServiceName(loc).toLowerCase() : 'this service'} when the copay is
              higher than the rate — we cannot collect more than the contracted rate. That is the
              only thing that prices{' '}
              {loc ? locServiceName(loc).toLowerCase() : 'this service'} differently from the rest
              of the benefit.
            </>
          )}
        </div>
      </div>

      {/* Scoped to the level of care's own service, and labeled like the
          contract rate above it for the same reason: a telehealth exclusion
          lands on a code, not on a benefit. A plan can refuse to pay a group
          over telehealth and still pay the individual therapy session billing
          under the same benefit. */}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={values.telehealthCovered}
          onChange={(e) => onChange('telehealthCovered', e.target.checked)}
        />
        Telehealth covered{loc ? ` — ${locServiceName(loc)}` : ''}
      </label>
      {/* Shown only while the box is clear, which is the state that puts a
          sentence in front of the client. A covered service needs no note: it
          is the service above, at the cost sharing above. */}
      {!values.telehealthCovered && (
        <div className="info-banner">
          ℹ Unchecked means the plan does not cover{' '}
          {loc ? contractRateSubject(loc) : 'this service'} over telehealth, and the cost note says
          so.{' '}
          {!isPerDiemLoc(loc) && (
            <>
              It says nothing about individual therapy, family therapy, assessment, or psychiatric
              visits — telehealth for those is not captured here.{' '}
            </>
          )}
          Check the box once the plan confirms it.
        </div>
      )}
    </>
  )
}

// One level of care's benefit. The verified LOC's card is marked primary, but
// it behaves exactly like every other card.
function BenefitCard({
  benefit,
  isPrimary,
  takenLocs,
  onChange,
  onRemove,
  resolved,
  verifiedLoc,
  noDeductible,
}) {
  const unit = benefit.loc ? unitLabel(benefit.loc) : 'per visit'
  // Psych bills under OP no matter which level of care the client sits in, so
  // the OP card is where that consequence belongs — not in a general note
  // somewhere else on the page. A per diem stay is the exception: the day is
  // what is billed, and nothing inside it is quoted on its own.
  const pricesPsychElsewhere =
    benefit.loc === 'OP' &&
    Boolean(verifiedLoc) &&
    verifiedLoc !== 'OP' &&
    !isPerDiemLoc(verifiedLoc)
  return (
    <div className={`benefit-card${isPrimary ? ' benefit-card-primary' : ''}`}>
      <div className="activity-row-header">
        <span className="activity-row-label">
          {benefit.loc ? `${benefit.loc} Benefit` : 'New LOC Benefit'}
          {isPrimary && <span className="primary-tag">Verified LOC</span>}
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
            options={locOptionsFrom(selectableLocs(takenLocs, benefit.loc))}
            value={benefit.loc}
            onChange={(v) => onChange('loc', v)}
          />
        </div>
      )}

      {pricesPsychElsewhere && (
        <div className="info-banner">
          ℹ Psychiatric visits during {verifiedLoc} bill under this OP benefit, not the{' '}
          {verifiedLoc} benefit. Whatever copay is entered here is what the client pays for a psych
          visit while they are still in {verifiedLoc} — even when {verifiedLoc} itself is $0.
        </div>
      )}

      <BenefitRuleFields
        idPrefix={`benefit-${benefit.id}`}
        values={benefit}
        onChange={onChange}
        unit={unit}
        loc={benefit.loc}
        noDeductible={noDeductible}
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
        <ResolvedBenefitPreview title={`Resolved ${benefit.loc} Benefit`} resolved={resolved} />
      )}
    </div>
  )
}

// A copay-driven amount is quoted in the copay's own unit, which is not always
// the unit the level of care is billed in.
function resolvedAmountUnit(resolved) {
  const copayDriven =
    resolved.responsibilityType === RESPONSIBILITY.COPAY ||
    resolved.responsibilityType === RESPONSIBILITY.COPAY_AND_COINSURANCE
  return copayDriven ? resolved.copayUnit : resolved.unit
}

// Read-only view of what the engine resolved, so staff can see the benefit that
// the generated output will actually describe.
// A plan that lists both a copay and coinsurance has not said which one it
// charges. The engine still records the copay it would collect, but that is
// working state, not a price — the cost note refuses to quote it, and this
// preview has to refuse in the same breath or staff will read the number off
// the screen and say it out loud.
function amountIsSettled(resolved) {
  return resolved.amountKnown && resolved.responsibilityType !== RESPONSIBILITY.COPAY_AND_COINSURANCE
}

function unsettledAmountText(resolved) {
  if (resolved.responsibilityType === RESPONSIBILITY.COPAY_AND_COINSURANCE) {
    return 'Not established — confirm which applies'
  }
  return resolved.responsibilityType === RESPONSIBILITY.UNKNOWN
    ? 'Not established'
    : 'Contract rate not entered'
}

function ResolvedBenefitPreview({ title, resolved }) {
  if (!resolved) return null
  const amountText = amountIsSettled(resolved)
    ? `${money(resolved.amount)} ${resolvedAmountUnit(resolved)}`
    : unsettledAmountText(resolved)
  const towardText = (value) => (value === null ? 'Confirm with plan' : value ? 'Yes' : 'No')

  return (
    <div className="calculated-fields">
      <div className="calc-field-row calc-total">
        <span className="calc-label">{title}</span>
        <span className="calc-value">{responsibilityTypeLabel(resolved.responsibilityType)}</span>
      </div>
      <div className="calc-field-row">
        {/* Named only where the contracted rate has actually priced the LOC's
            own service below the copay. Naming it any other time reads as a
            group-only price, when the copay is what every service under the
            benefit pays. */}
        <span className="calc-label">
          Patient Responsibility
          {ownServicePricedApart(resolved) &&
          locServiceName(resolved.contextLoc) !== resolved.contextLoc
            ? ` — ${locServiceName(resolved.contextLoc)}`
            : ''}
        </span>
        <span className="calc-value">{amountText}</span>
      </div>
      {ownServicePricedApart(resolved) && (
        <div className="calc-field-row">
          <span className="calc-label">
            All Other {resolved.contextLoc} Services
          </span>
          <span className="calc-value">{money(resolved.copay)} copay</span>
        </div>
      )}
      <div className="calc-field-row">
        <span className="calc-label">Applies Toward Deductible</span>
        <span className="calc-value">{towardText(resolved.countsTowardDeductible)}</span>
      </div>
      <div className="calc-field-row">
        <span className="calc-label">Applies Toward OOP Max</span>
        <span className="calc-value">{towardText(resolved.countsTowardOOP)}</span>
      </div>
      {resolved.notes.map((note) => (
        <div key={note} className="alert-banner">
          ⚠ {note}
        </div>
      ))}
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

  const amountText = amountIsSettled(derived)
    ? `${money(derived.amount)} ${derived.unit}`
    : unsettledAmountText(derived)
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

// The three outputs, in the order staff need them: the price to read out, the
// detail behind it, then the wording for the client.
const OUTPUT_VIEWS = [
  {
    key: 'costNote',
    tab: 'Cost Note',
    title: 'Cost Note',
    hint: 'What to tell the client. This is the only part that needs to be read out loud.',
  },
  {
    key: 'staffSummary',
    tab: 'Staff Detail',
    title: 'Staff Detail',
    hint: 'The full VOB breakdown behind those numbers — for the file and for questions.',
  },
  {
    key: 'clientExplanation',
    tab: 'Client Explanation',
    title: 'Client Explanation',
    hint: 'Long-form plain-language wording, for when the client asks how their plan works.',
  },
]

// Rendered as lines rather than a <pre> so a long price that wraps stays lined
// up under the one above it instead of falling back to the left margin. The
// copied text keeps its original spacing either way.
function CostNoteText({ text }) {
  return (
    <div className="cost-note-text">
      {text.split('\n').map((line, i) =>
        line.trim() === '' ? (
          <div key={i} className="cost-note-gap" />
        ) : (
          <div
            key={i}
            className={`cost-note-line${line.startsWith('  ') ? ' cost-note-line-nested' : ''}`}
          >
            {line.trim()}
          </div>
        )
      )}
    </div>
  )
}

function OutputPanel({ snapshot }) {
  const [activeKey, setActiveKey] = useState(OUTPUT_VIEWS[0].key)
  const [copied, setCopied] = useState(false)
  const active = OUTPUT_VIEWS.find((v) => v.key === activeKey) || OUTPUT_VIEWS[0]
  const text = snapshot[active.key] || ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const selectView = (key) => {
    setActiveKey(key)
    setCopied(false)
  }

  return (
    <>
      <div className="output-tabs" role="tablist">
        {OUTPUT_VIEWS.map((view) => (
          <button
            key={view.key}
            type="button"
            role="tab"
            aria-selected={view.key === activeKey}
            className={`output-tab${view.key === activeKey ? ' output-tab-active' : ''}`}
            onClick={() => selectView(view.key)}
          >
            {view.tab}
          </button>
        ))}
      </div>

      <div className="output-header">
        <div>
          <h2>{active.title}</h2>
          <p className="output-hint">{active.hint}</p>
        </div>
        <button type="button" className="btn-copy" onClick={handleCopy}>
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>

      {active.key === 'costNote' ? (
        <CostNoteText text={text} />
      ) : (
        <pre className="explanation-text">{text}</pre>
      )}
    </>
  )
}

export default function SnapshotTool() {
  const [form, setForm] = useState(INITIAL_FORM_STATE)
  const [submitted, setSubmitted] = useState(false)
  const [snapshot, setSnapshot] = useState(null)

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

  const updateLocBenefit = (id, field, value) =>
    setForm((prev) => ({
      ...prev,
      locBenefits: prev.locBenefits.map((b) => {
        if (b.id !== id) return b
        const next = { ...b, [field]: value }
        if (field === 'copayNa' && value) {
          next.copayAmount = ''
          next.copayBasis = ''
        }
        if (field === 'loc' && !copayBasisApplies(value)) next.copayBasis = ''
        if (field === 'coinsuranceNa' && value) next.coinsurancePercent = ''
        return next
      }),
    }))

  // Choosing the verified LOC creates its benefit card if the call has not
  // already produced one, and leaves every other stored benefit untouched. A
  // bundling answer captured for an outpatient LOC is dropped on the way to a
  // per diem one, where the question does not exist.
  const setVerifiedLoc = (loc) =>
    setForm((prev) => ({
      ...prev,
      verifiedLoc: loc,
      locBenefits: ensureBenefitFor(prev.locBenefits, loc),
      ...(isPerDiemLoc(loc) ? { bundlingModel: '', separateServiceBenefit: '' } : {}),
    }))

  // An accumulator the plan does not have takes no amounts with it, and the
  // combined/separate question it feeds has nothing left to answer.
  const setNoAccumulator = (field, amountFields) => (e) => {
    const checked = e.target.checked
    setForm((prev) => ({
      ...prev,
      [field]: checked,
      ...(checked
        ? { ...Object.fromEntries(amountFields.map((f) => [f, ''])), deductibleOopStructure: '' }
        : {}),
    }))
  }

  // ── Derived state ──────────────────────────────────────
  const isNotYetAdmitted = form.currentStatus === 'Not yet admitted'
  const isActiveClient =
    form.currentStatus === 'Currently in treatment' || form.currentStatus === 'Discharged'

  // Detox on a combined Detox/Resi verification is the same admission, not a
  // different level of care from the one this VOB priced.
  const isCrossLoc =
    isActiveClient &&
    Boolean(form.currentLoc) &&
    form.currentLoc !== 'None' &&
    Boolean(form.verifiedLoc) &&
    !locWithin(form.currentLoc, form.verifiedLoc)

  const calc = computeCalc(form)
  const { totalClientPaymentsToOop, totalAssistanceToOop, totalEpisodeActivityToOop,
    totalEpisodeActivityToDeductible, calculatedOopRemaining, oopSatisfied,
    deductibleRemaining } = calc

  const hasActivities = form.financialActivities.length > 0

  // Section 3 visibility: bundling only exists as an INN program concept, and a
  // secondary OP benefit is only relevant when the verified LOC is not OP. A
  // per diem stay has no bundling question either — the day is what is billed,
  // so nothing delivered inside it is priced on its own.
  const showBundlingModel =
    Boolean(form.verifiedLoc) &&
    form.verifiedLoc !== 'OP' &&
    !isPerDiemLoc(form.verifiedLoc) &&
    form.network === 'INN'

  // The verified LOC's card sorts first; the rest keep insertion order.
  const primaryBenefit = form.locBenefits.find((b) => b.loc && b.loc === form.verifiedLoc) || null
  const orderedBenefits = primaryBenefit
    ? [primaryBenefit, ...form.locBenefits.filter((b) => b !== primaryBenefit)]
    : form.locBenefits

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

  // Every stored benefit is held to the same standard, primary or not — a
  // half-entered LOC rule is worse than no LOC rule.
  form.locBenefits.forEach((b, i) => {
    const label = b.loc || `LOC benefit ${i + 1}`
    if (!b.loc) {
      submitBlockers.push(`${label}: Level of Care must be selected`)
    } else if (form.locBenefits.filter((o) => o.loc === b.loc).length > 1) {
      submitBlockers.push(`${b.loc}: only one benefit can be entered per level of care`)
    }
    // Nothing to answer when the plan has no deductible at all.
    if (!form.noDeductible) {
      if (!b.deductibleApplies) submitBlockers.push(`${label}: Deductible Applies must be selected`)
      if (b.deductibleApplies === 'Unsure') {
        submitBlockers.push(`${label}: deductible applicability must be confirmed before generating summary.`)
      }
    }
    if (!b.copayNa && b.copayAmount === '') {
      submitBlockers.push(`${label}: Copay must be entered or marked N/A`)
    }
    // Per day vs per admission is the difference between $500 and $500 × the
    // length of stay, so it cannot be left to a default.
    if (
      copayBasisApplies(b.loc) &&
      !b.copayNa &&
      parseFloat(b.copayAmount) > 0 &&
      !b.copayBasis
    ) {
      submitBlockers.push(`${label}: copay must be marked per day or once per admission`)
    }
    if (!b.coinsuranceNa && b.coinsurancePercent === '') {
      submitBlockers.push(`${label}: Coinsurance % must be entered or marked N/A`)
    }
    if (!b.confirmed) submitBlockers.push(`${label}: rules must be confirmed from insurance`)
  })

  // Detox/Resi is the whole admission, so it cannot coexist with a benefit for
  // one of its halves.
  conflictingLocs(form.locBenefits.map((b) => b.loc)).forEach((loc) => {
    if (!isCombinedAdmission(loc)) return
    submitBlockers.push(
      `${loc} covers the same admission as the Detox and Resi benefits entered — remove one or the other`
    )
  })

  if (showBundlingModel && !form.bundlingModel) {
    submitBlockers.push('Services During This LOC (bundling model) must be selected')
  }
  // Submitting finalizes the VOB and generates actionable collection
  // instructions, so an unconfirmed cost-sharing model gates it the same way
  // the other unresolved insurance rules do.
  if (showBundlingModel && form.bundlingModel === BUNDLING.CUSTOM) {
    submitBlockers.push(
      'Per-service cost sharing (Services During This LOC) must be confirmed before generating summary.'
    )
  }
  if (showBundlingModel && form.bundlingModel === BUNDLING.SEPARATE && !form.separateServiceBenefit) {
    submitBlockers.push(
      'Benefit used for individual therapy, family therapy, and assessment must be selected'
    )
  }


  // Rule 5 & 6 — structure/deductible blockers
  if (form.deductibleOopStructure === 'Unsure') {
    submitBlockers.push('Deductible/OOP structure must be confirmed before generating summary.')
  }

  // Required unless the plan does not have one, which is a real answer.
  if (!form.noDeductible && !form.deductibleTotal) {
    submitBlockers.push('Deductible Total is required, or mark that the plan has no deductible')
  }
  if (!form.noOopMax && !form.oopMaxTotal) {
    submitBlockers.push('OOP Max Total is required, or mark that the plan has no out-of-pocket max')
  }
  // A $0 out-of-pocket maximum is not a plan anyone sells — it is a number
  // somebody typed to get past the field. Left alone it reads as "the maximum
  // is already met" and quotes the entire episode at no cost, which is the one
  // direction a wrong quote must never fail in.
  if (!form.noOopMax && form.oopMaxTotal !== '' && parseFloat(form.oopMaxTotal) === 0) {
    submitBlockers.push(
      'OOP Max Total is $0 — enter the real maximum, or check "No OOP max" if the plan has none'
    )
  }

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
    setSnapshot(generateSnapshot(form))
    setSubmitted(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleReset = () => {
    setForm(INITIAL_FORM_STATE)
    setSubmitted(false)
    setSnapshot(null)
  }

  const handleEdit = () => {
    setSubmitted(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <>
      {submitted && snapshot ? (
        <div className="explanation-card">
          <OutputPanel snapshot={snapshot} />
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

            {/* A plan without one of these is a real plan, not an unfinished
                form. The checkbox records that, so nobody has to enter a $0
                that would read downstream as an accumulator already met. */}
            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="deductibleTotal">
                  Deductible Total {!form.noDeductible && <span className="required-star">*</span>}
                </label>
                <div className="coinsurance-row">
                  <CurrencyInput
                    id="deductibleTotal"
                    value={form.deductibleTotal}
                    onChange={set('deductibleTotal')}
                    disabled={form.noDeductible}
                  />
                  <label className="checkbox-label na-checkbox">
                    <input
                      type="checkbox"
                      checked={form.noDeductible}
                      onChange={setNoAccumulator('noDeductible', ['deductibleTotal', 'deductibleMet'])}
                    />
                    No deductible
                  </label>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="deductibleMet">Deductible Met</label>
                <CurrencyInput
                  id="deductibleMet"
                  value={form.deductibleMet}
                  onChange={set('deductibleMet')}
                  disabled={form.noDeductible}
                />
              </div>
            </div>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="oopMaxTotal">
                  OOP Max Total {!form.noOopMax && <span className="required-star">*</span>}
                </label>
                <div className="coinsurance-row">
                  <CurrencyInput
                    id="oopMaxTotal"
                    value={form.oopMaxTotal}
                    onChange={set('oopMaxTotal')}
                    disabled={form.noOopMax}
                  />
                  <label className="checkbox-label na-checkbox">
                    <input
                      type="checkbox"
                      checked={form.noOopMax}
                      onChange={setNoAccumulator('noOopMax', ['oopMaxTotal', 'oopMet'])}
                    />
                    No OOP max
                  </label>
                </div>
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="oopMet">OOP Met</label>
                <CurrencyInput
                  id="oopMet"
                  value={form.oopMet}
                  onChange={set('oopMet')}
                  disabled={form.noOopMax}
                />
              </div>
            </div>

            {form.noOopMax && (
              <div className="alert-banner">
                ⚠ No out-of-pocket maximum — cost sharing does not stop at a ceiling. The client
                keeps paying copays and coinsurance for the rest of the plan year.
              </div>
            )}

            {oopSatisfied && (
              <div className="success-banner">
                ✓ OOP MAX MET — no further cost sharing will be applied in the generated explanation
              </div>
            )}

            {/* Combined vs separate is a question about how two accumulators
                interact. With only one of them, there is nothing to ask. */}
            {form.noDeductible || form.noOopMax ? (
              <div className="info-banner">
                ℹ Deductible / OOP structure does not apply — this plan has{' '}
                {form.noDeductible && form.noOopMax
                  ? 'neither a deductible nor an out-of-pocket maximum'
                  : form.noDeductible
                    ? 'no deductible'
                    : 'no out-of-pocket maximum'}
                .
              </div>
            ) : (
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
            )}
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
                options={locOptionsFrom(['None', ...LOC_OPTIONS])}
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
                options={locOptionsFrom(LOC_OPTIONS)}
                value={form.verifiedLoc}
                onChange={setVerifiedLoc}
              />
              {isCombinedAdmission(form.verifiedLoc) && (
                <div className="info-banner">
                  ℹ One admission covering detox and residential. There is no separate admission to
                  enter residential from detox, so a per-admission copay is charged once for the
                  whole stay.
                </div>
              )}
            </div>

            {isCrossLoc && (
              <div className="alert-banner">
                ⚠ Cross-LOC scenario — episode financial activity should be reviewed before generating output.
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
              ℹ Each level of care carries its own independent benefit. Record every LOC the
              verification call covers — the Verified LOC is the one this VOB collects against,
              but it does not limit what can be stored. Psychiatric services bill under the OP
              benefit during outpatient care, so add OP when psych visits are expected. Detox and
              Resi verified as one admission are entered once, as the combined benefit.
            </div>

            {orderedBenefits.map((benefit) => (
              <BenefitCard
                key={benefit.id}
                benefit={benefit}
                isPrimary={Boolean(form.verifiedLoc) && benefit.loc === form.verifiedLoc}
                verifiedLoc={form.verifiedLoc}
                takenLocs={form.locBenefits.map((b) => b.loc).filter(Boolean)}
                noDeductible={form.noDeductible}
                onChange={(field, value) => updateLocBenefit(benefit.id, field, value)}
                onRemove={() => removeLocBenefit(benefit.id)}
                resolved={
                  benefit.loc ? resolveBenefit(form, calc, 'LOC_SERVICE', benefit.loc) : null
                }
              />
            ))}

            {selectableLocs(form.locBenefits.map((b) => b.loc)).length > 0 && (
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

            {/* Services during the verified LOC — bundling / cost-sharing model.
                This sits on top of the per-LOC benefits: it decides which LOC
                benefit a given service uses, or whether it is bundled at all. */}
            {showBundlingModel && (
              <div className="field-group" style={{ marginTop: '18px' }}>
                <label className="field-label">
                  Services During {form.verifiedLoc} <span className="required-star">*</span>
                </label>
                <RadioGroup
                  name="bundlingModel"
                  options={[BUNDLING.STANDARD, BUNDLING.SEPARATE, BUNDLING.CUSTOM]}
                  value={form.bundlingModel}
                  onChange={set('bundlingModel')}
                />
                {form.bundlingModel === BUNDLING.STANDARD && (
                  <div className="info-banner">
                    ℹ Individual therapy, family therapy, and assessment are included in the{' '}
                    {form.verifiedLoc} benefit — $0 additional patient responsibility. Psychiatric
                    services still use the OP benefit.
                  </div>
                )}
                {form.bundlingModel === BUNDLING.SEPARATE && (
                  <div className="conditional-block">
                    <div className="field-group">
                      <label className="field-label">
                        Benefit used for individual therapy, family therapy, and assessment{' '}
                        <span className="required-star">*</span>
                      </label>
                      <RadioGroup
                        name="separateServiceBenefit"
                        options={[
                          { value: 'Same as LOC benefit', label: `Same as ${form.verifiedLoc} benefit` },
                          { value: 'OP benefit', label: 'OP benefit' },
                        ]}
                        value={form.separateServiceBenefit}
                        onChange={set('separateServiceBenefit')}
                      />
                    </div>
                    <div className="info-banner">
                      ℹ Each service generates its own patient responsibility — nothing is bundled
                      to $0.
                    </div>
                  </div>
                )}
                {form.bundlingModel === BUNDLING.CUSTOM && (
                  <div className="alert-banner">
                    ⚠ Per-service responsibility and bundling are unconfirmed. The snapshot cannot
                    be generated — and no individual therapy, family therapy, or assessment amount
                    can be quoted — until the plan's model is verified with insurance.
                  </div>
                )}
              </div>
            )}

            {/* The bundling question above does not exist for a per diem stay,
                and there is no per-service quote to produce from it. */}
            {isPerDiemLoc(form.verifiedLoc) && (
              <div className="info-banner" style={{ marginTop: '18px' }}>
                ℹ Services during {form.verifiedLoc} are part of the per diem. Individual therapy,
                family therapy, and assessment delivered during the stay are covered by the daily
                rate, so the cost note quotes one price and does not list them separately —
                per-service pricing is an outpatient question.
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
                      options={locOptionsFrom([...LOC_OPTIONS, 'Other'])}
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
                      options={ACTIVITY_SERVICE_OPTIONS.map((key) => ({
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
              SUBMIT → GENERATE COST NOTE
            </button>
          </div>
        </form>
      )}
    </>
  )
}
