import { useState } from 'react'
import './App.css'

const makeActivity = () => ({
  id: `${Date.now()}-${Math.random()}`,
  activityLoc: '',
  activityStatus: '',
  sourceReviewed: '',
  clientPaymentApplied: '',
  financialAssistanceApplied: '',
  assistanceType: '',
  appliesTo: '',
  countsTowardOop: '',
  countsTowardDeductible: '',
  notes: '',
})

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

  // Section 3 — LOC Rules
  deductibleApplies: '',
  coinsurancePercent: '',
  coinsuranceNa: false,
  copayApplies: '',
  copayAmount: '',
  locRulesConfirmed: false,

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

function formatCurrency(value) {
  return parseFloat(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function computeCalc(data) {
  const oopTotal = data.oopMaxTotal ? parseFloat(data.oopMaxTotal) : null
  const oopMetVal = data.oopMet ? parseFloat(data.oopMet) : null
  const dedTotal = data.deductibleTotal ? parseFloat(data.deductibleTotal) : null
  const dedMet = data.deductibleMet ? parseFloat(data.deductibleMet) : null

  const activities = data.financialActivities || []
  const totalClientPaymentsToOop = activities
    .filter((a) => a.countsTowardOop === 'Yes')
    .reduce((sum, a) => sum + (parseFloat(a.clientPaymentApplied) || 0), 0)
  const totalAssistanceToOop = activities
    .filter((a) => a.countsTowardOop === 'Yes')
    .reduce((sum, a) => sum + (parseFloat(a.financialAssistanceApplied) || 0), 0)
  const totalEpisodeActivityToOop = totalClientPaymentsToOop + totalAssistanceToOop

  const calculatedOopRemaining =
    oopTotal !== null
      ? Math.max(oopTotal - Math.max(oopMetVal || 0, totalEpisodeActivityToOop), 0)
      : null

  const oopSatisfied =
    (oopTotal !== null && oopMetVal !== null && oopMetVal >= oopTotal) ||
    calculatedOopRemaining === 0

  const deductibleRemaining =
    dedTotal !== null && dedMet !== null ? Math.max(dedTotal - dedMet, 0) : null

  return {
    totalClientPaymentsToOop,
    totalAssistanceToOop,
    totalEpisodeActivityToOop,
    calculatedOopRemaining,
    oopSatisfied,
    deductibleRemaining,
  }
}

function generateExplanation(data) {
  const calc = computeCalc(data)
  const {
    totalClientPaymentsToOop,
    totalAssistanceToOop,
    totalEpisodeActivityToOop,
    calculatedOopRemaining,
    oopSatisfied,
    deductibleRemaining,
  } = calc

  const lines = []
  const blank = () => lines.push('')

  lines.push('CLIENT INSURANCE SUMMARY')
  lines.push('═'.repeat(50))
  blank()

  // Network
  lines.push(`Network: ${data.network || 'Not specified'}`)
  blank()

  // Deductible/OOP Structure
  if (data.deductibleOopStructure) {
    lines.push(`Deductible/OOP Structure: ${data.deductibleOopStructure}`)
    if (data.deductibleOopStructure === 'Combined') {
      lines.push('  → Deductible and Out-of-Pocket Maximum accumulate together.')
    } else if (data.deductibleOopStructure === 'Separate') {
      lines.push('  → Deductible and Out-of-Pocket Maximum are tracked independently.')
    }
    blank()
  }

  // Deductible
  const dedMet = data.deductibleMet ? parseFloat(data.deductibleMet) : 0
  const dedTotal = data.deductibleTotal ? parseFloat(data.deductibleTotal) : null
  lines.push('Deductible:')
  lines.push(`  $${formatCurrency(dedMet)} met of $${dedTotal !== null ? formatCurrency(dedTotal) : 'N/A'}`)
  if (deductibleRemaining !== null) {
    lines.push(`  $${formatCurrency(deductibleRemaining)} remaining`)
  }
  blank()

  // Out-of-Pocket Max
  const oopTotal = data.oopMaxTotal ? parseFloat(data.oopMaxTotal) : null
  const oopMetVal = data.oopMet ? parseFloat(data.oopMet) : 0
  const effectiveOopMet = oopTotal !== null
    ? oopTotal - (calculatedOopRemaining ?? 0)
    : Math.max(oopMetVal, totalEpisodeActivityToOop)
  lines.push('Out-of-Pocket Max:')
  lines.push(`  $${formatCurrency(effectiveOopMet)} met of $${oopTotal !== null ? formatCurrency(oopTotal) : 'N/A'}`)
  if (calculatedOopRemaining !== null) {
    lines.push(`  $${formatCurrency(calculatedOopRemaining)} remaining`)
  }
  if (oopSatisfied) {
    lines.push('  ✓ OOP MAX MET — Coinsurance does not apply.')
  }
  blank()

  // Current Status
  if (data.currentStatus) {
    lines.push('Current Status:')
    lines.push(`  ${data.currentStatus}`)
    blank()
  }

  // Current / Most Recent LOC
  lines.push('Current / Most Recent LOC:')
  lines.push(`  ${data.currentLoc || 'None'}`)
  blank()

  // Verified Level of Care
  if (data.verifiedLoc) {
    lines.push('Verified Level of Care:')
    lines.push(`  ${data.verifiedLoc}`)
    blank()
  }

  // Cross-LOC warning
  const isCrossLoc =
    (data.currentStatus === 'Currently in treatment' || data.currentStatus === 'Discharged') &&
    data.currentLoc && data.currentLoc !== 'None' &&
    data.verifiedLoc && data.currentLoc !== data.verifiedLoc
  if (isCrossLoc) {
    lines.push(`⚠ ${data.verifiedLoc} rules are being used for this agreement, while prior episode financial activity has been carried forward.`)
    blank()
  }

  // LOC Rules
  if (data.verifiedLoc) {
    lines.push(`${data.verifiedLoc} Rules:`)
    lines.push(`  Deductible Applies: ${data.deductibleApplies || 'Not specified'}`)
    let coinsuranceText
    if (oopSatisfied) {
      coinsuranceText = 'Not applicable because OOP Max is met'
    } else if (data.coinsuranceNa) {
      coinsuranceText = 'N/A'
    } else if (data.coinsurancePercent !== '') {
      coinsuranceText = `${data.coinsurancePercent}% patient responsibility`
    } else {
      coinsuranceText = 'Not specified'
    }
    lines.push(`  Coinsurance: ${coinsuranceText}`)
    blank()
  }

  // Episode Financial Activity
  lines.push('Episode Financial Activity:')
  if (data.financialActivities.length === 0) {
    lines.push('  None entered.')
  } else {
    data.financialActivities.forEach((act, i) => {
      blank()
      lines.push(`  ${i + 1}. ${act.activityLoc || 'LOC?'} — ${act.activityStatus || 'Status?'}`)
      lines.push(`     Source Reviewed: ${act.sourceReviewed || 'Not specified'}`)
      lines.push(`     Client Payment Applied: $${formatCurrency(act.clientPaymentApplied || 0)}`)
      lines.push(`     Financial Assistance Applied: $${formatCurrency(act.financialAssistanceApplied || 0)}`)
      lines.push(`     Assistance Type: ${act.assistanceType || 'None'}`)
      lines.push(`     Applies To: ${act.appliesTo || 'Not specified'}`)
      lines.push(`     Counts Toward OOP: ${act.countsTowardOop || 'Not specified'}`)
      lines.push(`     Counts Toward Deductible: ${act.countsTowardDeductible || 'Not specified'}`)
    })
    blank()
    lines.push('  Totals:')
    lines.push(`    Client Payments Applied to OOP: $${formatCurrency(totalClientPaymentsToOop)}`)
    lines.push(`    Assistance Applied to OOP: $${formatCurrency(totalAssistanceToOop)}`)
    lines.push(`    Total Episode Activity Applied to OOP: $${formatCurrency(totalEpisodeActivityToOop)}`)
  }
  blank()

  // Current Balance (only when Yes)
  if (data.hasCurrentBalance === 'Yes') {
    lines.push('Current Balance:')
    lines.push(`  Balance Amount: $${formatCurrency(data.balanceAmount || 0)}`)
    if (data.balanceType) lines.push(`  Balance Type: ${data.balanceType}`)
    lines.push('  Balance Reviewed: Yes')
    blank()
  }

  // Expected Collection
  if (data.verifiedLoc) {
    lines.push(`Expected ${data.verifiedLoc} Collection:`)
    const dedApplies = data.deductibleApplies === 'Yes'
    const dedRem = deductibleRemaining !== null ? deductibleRemaining : 0
    const oopRem = calculatedOopRemaining !== null ? calculatedOopRemaining : 0

    if (dedApplies && dedRem > 0 && oopRem === 0) {
      lines.push(`  Collect deductible only, up to $${formatCurrency(dedRem)} total.`)
      lines.push('  Do not collect coinsurance after deductible is met.')
    } else if (dedApplies && dedRem > 0 && oopRem > 0) {
      lines.push(`  Collect toward deductible up to $${formatCurrency(dedRem)}. After deductible is met, collect coinsurance until OOP max is met.`)
    } else if (!dedApplies && oopRem > 0) {
      lines.push('  Do not collect deductible for this LOC. Collect coinsurance only until OOP max is met.')
    } else if (!dedApplies && oopRem === 0) {
      lines.push('  Do not collect deductible or coinsurance for covered services because OOP max is met.')
    }
    blank()
  }

  // Final Check
  lines.push('Final Check:')
  lines.push(`  Deductible/OOP reviewed: ${data.deductibleOopReviewed ? 'Yes' : 'No'}`)
  lines.push(`  Network confirmed: ${data.networkConfirmed ? 'Yes' : 'No'}`)
  lines.push(`  LOC rules entered: ${data.locRulesEntered ? 'Yes' : 'No'}`)
  lines.push(`  Episode financial activity reviewed: ${data.financialActivities.length > 0 ? (data.episodeActivityReviewed ? 'Yes' : 'No') : 'N/A'}`)
  lines.push(`  Balance reviewed: ${data.hasCurrentBalance === 'Yes' ? (data.balanceReviewed ? 'Yes' : 'No') : 'N/A'}`)

  // Client-Facing Explanation
  blank()
  lines.push('═'.repeat(50))
  blank()
  lines.push("Here's how your insurance is working:")
  blank()

  if (dedTotal !== null && oopTotal !== null) {
    lines.push(`Your plan has a deductible of $${formatCurrency(dedTotal)} and an out-of-pocket maximum of $${formatCurrency(oopTotal)}.`)
    blank()
  }

  if (totalEpisodeActivityToOop > 0) {
    lines.push(`So far, a total of $${formatCurrency(totalEpisodeActivityToOop)} has already been applied toward your out-of-pocket maximum. This includes:`)
    lines.push(`  - $${formatCurrency(totalClientPaymentsToOop)} that you paid`)
    lines.push(`  - $${formatCurrency(totalAssistanceToOop)} that was applied as financial assistance`)
    blank()
  }

  const dedAppliesClient = data.deductibleApplies === 'Yes'
  const isOutpatientLoc = data.verifiedLoc === 'IOP' || data.verifiedLoc === 'OP'
  const serviceLabel = isOutpatientLoc
    ? `outpatient services (${data.verifiedLoc})`
    : data.verifiedLoc ? `${data.verifiedLoc} services` : 'these services'
  const deductibleStillOwed = dedAppliesClient && deductibleRemaining !== null && deductibleRemaining > 0

  if (oopSatisfied) {
    lines.push('Because of this, you have now reached your out-of-pocket maximum for the year.')
    blank()
    lines.push('What this means:')
    if (deductibleStillOwed) {
      lines.push('Because your out-of-pocket maximum is met, you should not have to pay coinsurance.')
      blank()
      lines.push(`However, your deductible and out-of-pocket maximum are tracked separately on your plan. You still have $${formatCurrency(deductibleRemaining)} remaining toward your deductible for ${serviceLabel}.`)
      blank()
      lines.push('What you can expect to pay:')
      lines.push(`You may be responsible for up to $${formatCurrency(deductibleRemaining)} total for ${serviceLabel}.`)
      lines.push('After that, you should not owe additional costs for covered services.')
      blank()
    } else {
      lines.push('Your insurance should now cover 100% of covered services for the rest of the year, and you should not have to pay coinsurance.')
      blank()
    }
  } else if (deductibleStillOwed) {
    lines.push(`For ${serviceLabel}, your deductible still applies.`)
    blank()
    lines.push(`You currently have $${formatCurrency(deductibleRemaining)} remaining toward your deductible.`)
    blank()
    lines.push('What you can expect to pay:')
    lines.push(`You may be responsible for up to $${formatCurrency(deductibleRemaining)} total for ${serviceLabel}.`)
    lines.push('After that, you should not owe additional costs for covered services.')
    blank()
  }

  lines.push('If anything you are billed goes beyond this, please let us know so we can review it with you.')

  return lines.join('\n')
}

function RadioGroup({ name, options, value, onChange }) {
  return (
    <div className="radio-group">
      {options.map((opt) => (
        <label key={opt} className="radio-label">
          <input
            type="radio"
            name={name}
            value={opt}
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          {opt}
        </label>
      ))}
    </div>
  )
}

function CurrencyInput({ id, value, onChange, placeholder = '0.00' }) {
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
      />
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

  const { totalClientPaymentsToOop, totalAssistanceToOop, totalEpisodeActivityToOop,
    calculatedOopRemaining, oopSatisfied, deductibleRemaining } = computeCalc(form)

  const hasActivities = form.financialActivities.length > 0

  const showZeroCopayWarning =
    Boolean(form.verifiedLoc) &&
    !form.coinsuranceNa &&
    (form.coinsurancePercent === '0' || form.coinsurancePercent === '')

  // ── Submit blockers ────────────────────────────────────
  const submitBlockers = []

  if (!form.verifiedLoc) submitBlockers.push('Verified LOC must be selected')

  if (isActiveClient && !form.currentLoc) {
    submitBlockers.push('Current / Most Recent LOC is required when client is in treatment or discharged')
  }

  if (form.verifiedLoc) {
    if (!form.deductibleApplies) {
      submitBlockers.push('Deductible Applies must be selected for Verified LOC')
    }
    if (!form.coinsuranceNa && form.coinsurancePercent === '' && form.deductibleApplies !== 'No') {
      submitBlockers.push('Coinsurance % must be entered or marked N/A')
    }
    if (!form.locRulesConfirmed) {
      submitBlockers.push('LOC rules must be confirmed from insurance')
    }
  }

  // Rule 5 & 6 — structure/deductible blockers
  if (form.deductibleOopStructure === 'Unsure') {
    submitBlockers.push('Deductible/OOP structure must be confirmed before generating summary.')
  }
  if (form.deductibleApplies === 'Unsure') {
    submitBlockers.push('Deductible applicability for the verified LOC must be confirmed before generating summary.')
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
                ✓ OOP MAX MET — Coinsurance will not be applied in the generated explanation
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
                onChange={set('verifiedLoc')}
              />
            </div>

            {isCrossLoc && (
              <div className="alert-banner">
                ⚠ Cross-LOC scenario — episode financial activity should be reviewed before generating output.
              </div>
            )}
          </section>

          {/* SECTION 3 — LOC Rules */}
          <section className="form-section">
            <h2 className="section-title">Section 3 — LOC Rule (For Verified LOC)</h2>

            {!form.verifiedLoc && (
              <div className="info-banner">ℹ Select a Verified LOC in Section 2 to activate these rules</div>
            )}

            <div className="field-group">
              <label className="field-label">Does Deductible Apply?</label>
              <RadioGroup
                name="deductibleApplies"
                options={['Yes', 'No', 'Unsure']}
                value={form.deductibleApplies}
                onChange={set('deductibleApplies')}
              />
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="coinsurancePercent">
                Coinsurance % (for this LOC)
              </label>
              <div className="coinsurance-row">
                <div className="percent-input-wrapper">
                  <input
                    id="coinsurancePercent"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className="percent-input"
                    value={form.coinsurancePercent}
                    onChange={(e) => set('coinsurancePercent')(e.target.value)}
                    placeholder="0"
                    disabled={form.coinsuranceNa}
                  />
                  <span className="percent-symbol">%</span>
                </div>
                <label className="checkbox-label na-checkbox">
                  <input
                    type="checkbox"
                    checked={form.coinsuranceNa}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        coinsuranceNa: e.target.checked,
                        ...(e.target.checked && { coinsurancePercent: '' }),
                      }))
                    }
                  />
                  N/A
                </label>
              </div>
              {showZeroCopayWarning && (
                <div className="confirm-prompt">⚠ Confirm patient responsibility is 0% — some plans are 100% covered</div>
              )}
            </div>

            {form.network === 'INN' && (
              <div className="field-group">
                <label className="field-label">Copay Applies?</label>
                <RadioGroup
                  name="copayApplies"
                  options={['Yes', 'No']}
                  value={form.copayApplies}
                  onChange={set('copayApplies')}
                />
                {form.copayApplies === 'Yes' && (
                  <div className="conditional-block">
                    <label className="field-label" htmlFor="copayAmount">Copay Amount</label>
                    <CurrencyInput id="copayAmount" value={form.copayAmount} onChange={set('copayAmount')} />
                  </div>
                )}
                {form.copayApplies === 'Yes' && form.deductibleApplies === 'Yes' && (
                  <div className="info-banner">
                    ℹ Deductible applies first — once met, a copay applies instead of coinsurance.
                  </div>
                )}
              </div>
            )}

            <label className="checkbox-label">
              <input type="checkbox" checked={form.locRulesConfirmed} onChange={setCheck('locRulesConfirmed')} />
              LOC rules confirmed from insurance
            </label>
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
