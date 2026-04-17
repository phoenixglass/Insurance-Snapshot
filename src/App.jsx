import { useState } from 'react'
import './App.css'

const INITIAL_FORM_STATE = {
  // Section 1
  network: '',
  deductibleTotal: '',
  deductibleMet: '',
  oopMaxTotal: '',
  oopMet: '',
  deductibleOopStructure: '',

  // Section 2
  currentLoc: '',
  verifiedLoc: '',

  // Section 3
  deductibleApplies: '',
  coinsurancePercent: '',
  coinsuranceNa: false,
  copayApplies: '',
  copayAmount: '',
  locRulesConfirmed: false,

  // Section 4
  hasPriorLoc: '',
  priorFinancialsReviewed: false,
  hasCurrentBalance: '',
  balanceAmount: '',
  balanceType: '',

  // Section 5
  hasScholarship: '',
  scholarshipAmount: '',
  scholarshipAppliesTo: [],
  countsTowardOopConfirmed: false,

  // Section 6
  deductibleOopReviewed: false,
  networkConfirmed: false,
  locRulesEntered: false,
  priorLocCreditsReviewed: false,
  balanceReviewed: false,
}

function generateExplanation(data) {
  const lines = []

  lines.push('CLIENT INSURANCE SUMMARY')
  lines.push('═'.repeat(50))

  if (data.network) {
    lines.push(`Network: ${data.network}`)
  }

  const dedTotal = data.deductibleTotal ? parseFloat(data.deductibleTotal) : null
  const dedMet = data.deductibleMet ? parseFloat(data.deductibleMet) : null
  const dedRemaining = dedTotal !== null && dedMet !== null ? dedTotal - dedMet : null

  if (data.deductibleTotal || data.deductibleMet) {
    const dedStr = `$${dedMet !== null ? dedMet.toFixed(2) : 'N/A'} met of $${dedTotal !== null ? dedTotal.toFixed(2) : 'N/A'}`
    const remStr = dedRemaining !== null ? ` ($${dedRemaining.toFixed(2)} remaining)` : ''
    lines.push(`Deductible: ${dedStr}${remStr}`)
    // Rule 13 — deductible remaining drives full-cost-first explanation
    if (dedRemaining !== null && dedRemaining > 0) {
      lines.push('  → Full cost responsibility applies until deductible is met.')
    }
  }

  const oopTotal = data.oopMaxTotal ? parseFloat(data.oopMaxTotal) : null
  const oopMet = data.oopMet ? parseFloat(data.oopMet) : null
  const oopSatisfied = oopTotal !== null && oopMet !== null && oopMet >= oopTotal

  if (data.oopMaxTotal || data.oopMet) {
    const oopStr = `$${oopMet !== null ? oopMet.toFixed(2) : 'N/A'} met of $${oopTotal !== null ? oopTotal.toFixed(2) : 'N/A'}`
    const oopRemStr =
      oopTotal !== null && oopMet !== null
        ? ` ($${(oopTotal - oopMet).toFixed(2)} remaining)`
        : ''
    lines.push(`Out-of-Pocket Max: ${oopStr}${oopRemStr}`)
    // Rule 12 — OOP MAX MET flag
    if (oopSatisfied) {
      lines.push('  ✓ OOP MAX MET — Coinsurance does not apply.')
    }
  }

  if (data.deductibleOopStructure) {
    lines.push(`Deductible/OOP Structure: ${data.deductibleOopStructure}`)
    // Rule 14 — structure drives calculation behavior
    if (data.deductibleOopStructure === 'Combined') {
      lines.push('  → Deductible payments count toward Out-of-Pocket Maximum.')
    } else if (data.deductibleOopStructure === 'Separate') {
      lines.push('  → Deductible and Out-of-Pocket Maximum tracked independently.')
    }
  }

  lines.push('')

  if (data.verifiedLoc) {
    lines.push(`Verified Level of Care: ${data.verifiedLoc}`)
  }
  if (data.currentLoc && data.currentLoc !== 'None' && data.currentLoc !== data.verifiedLoc) {
    lines.push(`Current Level of Care: ${data.currentLoc}`)
    lines.push('⚠ Rules applied are for Verified LOC only.')
  }

  lines.push('')

  if (data.deductibleApplies) {
    lines.push(
      `Deductible Applies for ${data.verifiedLoc || 'Verified LOC'}: ${data.deductibleApplies}`
    )
  }

  // Rule 12 — skip coinsurance in explanation when OOP is satisfied
  if (oopSatisfied) {
    lines.push('Coinsurance: Not applicable (OOP Max met)')
  } else if (data.coinsuranceNa) {
    lines.push('Coinsurance: N/A')
  } else if (data.coinsurancePercent !== '') {
    lines.push(`Coinsurance Rate: ${data.coinsurancePercent}%`)
  }

  if (data.network === 'INN' && data.copayApplies === 'Yes' && data.copayAmount) {
    lines.push(`Copay: $${parseFloat(data.copayAmount).toFixed(2)}`)
  } else if (data.network === 'INN' && data.copayApplies === 'Yes') {
    lines.push('Copay: Yes (amount not specified)')
  } else if (data.network === 'INN' && data.copayApplies === 'No') {
    lines.push('Copay: No')
  }

  lines.push('')

  // Rule 1 — currentLoc = None means Prior LOC is N/A
  if (data.currentLoc === 'None') {
    lines.push('Prior LOC: N/A')
  } else if (data.hasPriorLoc === 'Yes') {
    lines.push('Prior LOC: Yes')
    if (data.priorFinancialsReviewed) {
      lines.push('  Prior financials have been reviewed.')
    }
  } else if (data.hasPriorLoc === 'No') {
    lines.push('Prior LOC: No')
  }

  if (data.hasCurrentBalance === 'Yes') {
    const balAmt = data.balanceAmount
      ? `$${parseFloat(data.balanceAmount).toFixed(2)}`
      : 'amount not specified'
    const balType = data.balanceType ? ` (${data.balanceType})` : ''
    lines.push(`Current Balance: ${balAmt}${balType}`)
  }

  lines.push('')

  if (data.hasScholarship === 'Yes') {
    const schAmt = data.scholarshipAmount
      ? `$${parseFloat(data.scholarshipAmount).toFixed(2)}`
      : 'amount not specified'
    lines.push(`Financial Assistance: ${schAmt}`)
    if (data.scholarshipAppliesTo.length > 0) {
      lines.push(`  Applies to: ${data.scholarshipAppliesTo.join(', ')}`)
    }
    if (data.countsTowardOopConfirmed) {
      lines.push('  Confirmed to count toward OOP.')
    }
  }

  lines.push('')
  lines.push('─'.repeat(50))
  lines.push('Generated by Insurance Snapshot System')

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

  // Rule 1 — "None" cleans the slate: auto-set hasPriorLoc = No
  const handleCurrentLocChange = (value) => {
    setForm((prev) => ({
      ...prev,
      currentLoc: value,
      ...(value === 'None' && { hasPriorLoc: 'No', priorFinancialsReviewed: false }),
    }))
  }

  const toggleAppliesTo = (item) => {
    setForm((prev) => {
      const current = prev.scholarshipAppliesTo
      return {
        ...prev,
        scholarshipAppliesTo: current.includes(item)
          ? current.filter((x) => x !== item)
          : [...current, item],
      }
    })
  }

  // ── Derived state ──────────────────────────────────────
  const isCurrentLocNone = form.currentLoc === 'None'

  // Rule 2 — cross-LOC: current ≠ verified, and current is not None
  const isCrossLoc =
    !isCurrentLocNone &&
    Boolean(form.currentLoc) &&
    Boolean(form.verifiedLoc) &&
    form.currentLoc !== form.verifiedLoc

  // Rule 12 — OOP satisfied flag
  const oopTotal = form.oopMaxTotal ? parseFloat(form.oopMaxTotal) : null
  const oopMet = form.oopMet ? parseFloat(form.oopMet) : null
  const oopSatisfied = oopTotal !== null && oopMet !== null && oopMet >= oopTotal

  // Rule 4 — 0% coinsurance prompt (warning only, not a blocker)
  const showZeroCopayWarning =
    Boolean(form.verifiedLoc) &&
    !form.coinsuranceNa &&
    (form.coinsurancePercent === '0' || form.coinsurancePercent === '')

  // Rule 9 — assistance applies to OOP but not confirmed
  const showOopAssistanceWarning =
    form.hasScholarship === 'Yes' &&
    form.scholarshipAppliesTo.includes('OOP') &&
    !form.countsTowardOopConfirmed

  // ── Submit blockers (Final Check Gate) ────────────────
  const submitBlockers = []

  // Verified LOC required
  if (!form.verifiedLoc) {
    submitBlockers.push('Verified LOC must be selected')
  }

  // Rule 2 — cross-LOC requires prior financials reviewed
  if (isCrossLoc && !form.priorFinancialsReviewed) {
    submitBlockers.push('Cross-LOC scenario: prior financials must be reviewed and checked')
  }

  // Rule 3 — LOC rule confirmation (when verifiedLoc is selected)
  if (form.verifiedLoc) {
    if (!form.deductibleApplies) {
      submitBlockers.push('Deductible Applies must be selected for Verified LOC')
    }
    // Coinsurance required unless deductibleApplies = No (100% plan) or explicitly N/A
    if (!form.coinsuranceNa && form.coinsurancePercent === '' && form.deductibleApplies !== 'No') {
      submitBlockers.push('Coinsurance % must be entered or marked N/A')
    }
    if (!form.locRulesConfirmed) {
      submitBlockers.push('LOC rules must be confirmed from insurance')
    }
  }

  // Deductible / OOP required
  if (!form.deductibleTotal) {
    submitBlockers.push('Deductible Total is required')
  }
  if (!form.oopMaxTotal) {
    submitBlockers.push('OOP Max Total is required')
  }

  // Rule 6 — balance completeness
  if (form.hasCurrentBalance === 'Yes') {
    if (!form.balanceAmount) {
      submitBlockers.push('Balance Amount is required')
    }
    if (!form.balanceType) {
      submitBlockers.push('Balance Type is required')
    }
  }

  // Rules 8 & 9 — assistance completeness
  if (form.hasScholarship === 'Yes') {
    if (!form.scholarshipAmount) {
      submitBlockers.push('Assistance Amount is required')
    }
    if (form.scholarshipAppliesTo.length === 0) {
      submitBlockers.push('Assistance "Applies To" must be selected')
    }
    if (!form.countsTowardOopConfirmed) {
      submitBlockers.push('Counts toward OOP must be confirmed for financial assistance')
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (submitBlockers.length > 0) return
    const text = generateExplanation(form)
    setExplanation(text)
    setSubmitted(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleReset = () => {
    setForm(INITIAL_FORM_STATE)
    setSubmitted(false)
    setExplanation('')
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
          <button className="btn-secondary" onClick={handleReset}>
            ← Start New Snapshot
          </button>
        </div>
      ) : (
        <form className="snapshot-form" onSubmit={handleSubmit}>
          {/* SECTION 1 — Plan Basics */}
          <section className="form-section">
            <h2 className="section-title">Section 1 — Plan Basics</h2>

            <div className="field-group">
              <label className="field-label">Network</label>
              <RadioGroup
                name="network"
                options={['INN', 'OON']}
                value={form.network}
                onChange={set('network')}
              />
            </div>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="deductibleTotal">
                  Deductible Total <span className="required-star">*</span>
                </label>
                <CurrencyInput
                  id="deductibleTotal"
                  value={form.deductibleTotal}
                  onChange={set('deductibleTotal')}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="deductibleMet">
                  Deductible Met
                </label>
                <CurrencyInput
                  id="deductibleMet"
                  value={form.deductibleMet}
                  onChange={set('deductibleMet')}
                />
              </div>
            </div>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label" htmlFor="oopMaxTotal">
                  OOP Max Total <span className="required-star">*</span>
                </label>
                <CurrencyInput
                  id="oopMaxTotal"
                  value={form.oopMaxTotal}
                  onChange={set('oopMaxTotal')}
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="oopMet">
                  OOP Met
                </label>
                <CurrencyInput id="oopMet" value={form.oopMet} onChange={set('oopMet')} />
              </div>
            </div>

            {/* Rule 12 — OOP MAX MET system flag */}
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
              {/* Rule 14 — Combined vs Separate informs calculation */}
              {form.deductibleOopStructure === 'Combined' && (
                <div className="info-banner">
                  ℹ Combined: deductible payments count toward Out-of-Pocket Maximum
                </div>
              )}
              {form.deductibleOopStructure === 'Separate' && (
                <div className="info-banner">
                  ℹ Separate: deductible and OOP Maximum tracked independently
                </div>
              )}
            </div>
          </section>

          {/* SECTION 2 — Level of Care */}
          <section className="form-section">
            <h2 className="section-title">Section 2 — Level of Care</h2>

            <div className="field-group">
              <label className="field-label">Current LOC (where client is now)</label>
              <RadioGroup
                name="currentLoc"
                options={['None', 'Detox', 'Resi', 'PHP', 'IOP', 'OP']}
                value={form.currentLoc}
                onChange={handleCurrentLocChange}
              />
              {/* Rule 1 — None clears prior LOC history */}
              {isCurrentLocNone && (
                <div className="info-banner">
                  ℹ No current LOC — Prior LOC automatically set to No
                </div>
              )}
            </div>

            <div className="field-group">
              <label className="field-label">Verified LOC (what this VOB is for)</label>
              <RadioGroup
                name="verifiedLoc"
                options={['Detox', 'Resi', 'PHP', 'IOP', 'OP']}
                value={form.verifiedLoc}
                onChange={set('verifiedLoc')}
              />
            </div>

            {/* Rule 2 — Cross-LOC transfer detection */}
            {isCrossLoc && (
              <div className="alert-banner">
                ⚠ Cross-LOC scenario — prior financials must be reviewed before submitting
              </div>
            )}
          </section>

          {/* SECTION 3 — LOC Rules */}
          <section className="form-section">
            <h2 className="section-title">Section 3 — LOC Rule (For Verified LOC)</h2>

            {!form.verifiedLoc && (
              <div className="info-banner">
                ℹ Select a Verified LOC in Section 2 to activate these rules
              </div>
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
              {/* Rule 4 — 0% or blank coinsurance prompt */}
              {showZeroCopayWarning && (
                <div className="confirm-prompt">
                  ⚠ Confirm patient responsibility is 0% — some plans are 100% covered
                </div>
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
                    <label className="field-label" htmlFor="copayAmount">
                      Copay Amount
                    </label>
                    <CurrencyInput
                      id="copayAmount"
                      value={form.copayAmount}
                      onChange={set('copayAmount')}
                    />
                  </div>
                )}
              </div>
            )}

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.locRulesConfirmed}
                onChange={setCheck('locRulesConfirmed')}
              />
              LOC rules confirmed from insurance
            </label>
          </section>

          {/* SECTION 4 — Current Financial State */}
          <section className="form-section">
            <h2 className="section-title">Section 4 — Current Financial State</h2>

            {/* Rule 1 — Hide Prior LOC fields when currentLoc = None */}
            {!isCurrentLocNone ? (
              <>
                <div className="field-group">
                  <label className="field-label">Has Prior LOC?</label>
                  <RadioGroup
                    name="hasPriorLoc"
                    options={['Yes', 'No']}
                    value={form.hasPriorLoc}
                    onChange={set('hasPriorLoc')}
                  />
                </div>

                {/* Show prior financials checkbox when hasPriorLoc=Yes OR cross-LOC requires it */}
                {(form.hasPriorLoc === 'Yes' || isCrossLoc) && (
                  <div className="conditional-block">
                    {/* Rule 2 — inline reminder when cross-LOC and hasPriorLoc not yet Yes */}
                    {isCrossLoc && form.hasPriorLoc !== 'Yes' && (
                      <div className="alert-banner">
                        ⚠ Cross-LOC detected — prior financials review is required
                      </div>
                    )}
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={form.priorFinancialsReviewed}
                        onChange={setCheck('priorFinancialsReviewed')}
                      />
                      Prior financials reviewed
                      {isCrossLoc && <span className="required-star"> *</span>}
                    </label>
                  </div>
                )}
              </>
            ) : (
              /* Rule 1 — None: show N/A note in place of Prior LOC fields */
              <div className="info-banner" style={{ marginBottom: '18px' }}>
                ℹ Prior LOC: N/A — no current level of care
              </div>
            )}

            <div className="field-group">
              <label className="field-label">Current Balance?</label>
              <RadioGroup
                name="hasCurrentBalance"
                options={['Yes', 'No']}
                value={form.hasCurrentBalance}
                onChange={set('hasCurrentBalance')}
              />
            </div>

            {/* Rules 5 & 6 — hide details when No, require when Yes */}
            {form.hasCurrentBalance === 'Yes' && (
              <div className="conditional-block">
                <div className="field-group">
                  <label className="field-label" htmlFor="balanceAmount">
                    Balance Amount <span className="required-star">*</span>
                  </label>
                  <CurrencyInput
                    id="balanceAmount"
                    value={form.balanceAmount}
                    onChange={set('balanceAmount')}
                  />
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
              </div>
            )}
          </section>

          {/* SECTION 5 — Financial Assistance */}
          <section className="form-section">
            <h2 className="section-title">Section 5 — Financial Assistance</h2>

            <div className="field-group">
              <label className="field-label">Any Scholarship / Hardship?</label>
              <RadioGroup
                name="hasScholarship"
                options={['Yes', 'No']}
                value={form.hasScholarship}
                onChange={set('hasScholarship')}
              />
            </div>

            {/* Rules 7 & 8 — hide when No, require all fields when Yes */}
            {form.hasScholarship === 'Yes' && (
              <div className="conditional-block">
                <div className="field-group">
                  <label className="field-label" htmlFor="scholarshipAmount">
                    Amount <span className="required-star">*</span>
                  </label>
                  <CurrencyInput
                    id="scholarshipAmount"
                    value={form.scholarshipAmount}
                    onChange={set('scholarshipAmount')}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">
                    Applies To <span className="required-star">*</span>
                  </label>
                  <div className="checkbox-group">
                    {['Deductible', 'OOP', 'Balance', 'Unsure'].map((item) => (
                      <label key={item} className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={form.scholarshipAppliesTo.includes(item)}
                          onChange={() => toggleAppliesTo(item)}
                        />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Rule 9 — OOP + unconfirmed is high-risk */}
                {showOopAssistanceWarning && (
                  <div className="alert-banner">
                    ⚠ Financial assistance may affect OOP calculations — confirm before proceeding
                  </div>
                )}

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.countsTowardOopConfirmed}
                    onChange={setCheck('countsTowardOopConfirmed')}
                  />
                  Counts toward OOP confirmed <span className="required-star">*</span>
                </label>
              </div>
            )}
          </section>

          {/* SECTION 6 — Final Check */}
          <section className="form-section">
            <h2 className="section-title">Section 6 — Final Check</h2>

            <div className="checklist">
              {[
                ['deductibleOopReviewed', 'Deductible/OOP reviewed'],
                ['networkConfirmed', 'Network confirmed'],
                ['locRulesEntered', 'LOC rules entered'],
                ['priorLocCreditsReviewed', 'Prior LOC + credits reviewed'],
                ['balanceReviewed', 'Balance reviewed'],
              ].map(([field, label]) => (
                <label key={field} className="checkbox-label checklist-item">
                  <input
                    type="checkbox"
                    checked={form[field]}
                    onChange={setCheck(field)}
                  />
                  {label}
                </label>
              ))}
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
            <button
              type="submit"
              className="btn-submit"
              disabled={submitBlockers.length > 0}
            >
              SUBMIT → SYSTEM GENERATES CLIENT EXPLANATION
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
