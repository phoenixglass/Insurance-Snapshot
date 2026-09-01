// Deposit estimator — the workbook's `Insurance Calculator_v2` sheet as a
// screen. The workbook's own layout is preserved in spirit: plan terms on the
// left, the estimate on the right, and the two waterfalls kept visibly separate
// because the inpatient one feeds the outpatient one.

import { useMemo, useState } from 'react'
import {
  ADMISSION_FEE_LOCS,
  COPAY_BASIS,
  COPAY_TREATMENT,
  INITIAL_ESTIMATE_STATE,
  CARRIER_OPTIONS,
  LEVEL_RULE_LOCS,
  SERVICE_LINES,
  carriersWithRate,
  computeEstimate,
  estimateBlockers,
  formatMoney,
  formatPercent,
  formatUnits,
  hasLevelOverrides,
  isOtherCarrier,
  levelRule,
  needsNetworkChoice,
  resolveRate,
  sequenceIncludes,
  sequenceLocs,
  toNumber,
  unitNoun,
} from './estimate.js'
import { generateEstimateOutput, parseStaffDetail } from './estimateOutput.js'
import { computeHardship, hardshipBlockers } from './hardship.js'
import { TREATMENT_SEQUENCES } from './data/rates.js'
import { LOCATIONS, getLocation } from './data/contractRates.js'
import { miscRate } from './data/reimbursement.js'
import {
  Banner,
  BlockerList,
  CurrencyInput,
  Field,
  HeroFigure,
  Meter,
  NumberInput,
  PercentInput,
  SegmentBar,
  SegmentedControl,
  Section,
  Select,
  StatRow,
  StatTile,
  Waterfall,
} from './ui.jsx'

// Where the number in this cell came from. Worth showing on every row: a
// contracted rate and a carrier-table estimate are not the same kind of fact,
// and a quote built on the second one deserves to look different.
const RATE_TAGS = {
  override: { className: 'rate-tag-override', label: 'override' },
  contract: { className: 'rate-tag-contract', label: 'contracted' },
  'payer-average': { className: 'rate-tag-estimate', label: 'payer avg' },
  uncontracted: { className: 'rate-tag-missing', label: 'not contracted' },
  missing: { className: 'rate-tag-missing', label: 'not on file' },
}

function RateCell({ form, code, onOverride }) {
  const { rate, source } = resolveRate(form, code)
  const tag = RATE_TAGS[source]
  const misc = source === 'missing' ? miscRate(code) : null
  return (
    <div className="rate-cell">
      <CurrencyInput
        value={form.rateOverrides?.[code] ?? ''}
        onChange={(v) => onOverride(code, v)}
        placeholder={rate === null ? 'no rate' : rate.toFixed(2)}
        size="sm"
      />
      {tag && <span className={`rate-tag ${tag.className}`}>{tag.label}</span>}
      {misc !== null && (
        <button
          type="button"
          className="rate-fill"
          onClick={() => onOverride(code, misc.toFixed(2))}
          title={`Fill with the Misc claims average, ${misc.toFixed(2)}`}
        >
          misc {misc.toFixed(0)}
        </button>
      )}
    </div>
  )
}

// Two outpatient rows bill 90853, so the second one says whose rate it is
// sharing rather than leaving a staff member to notice that editing one rate
// cell moved another row's number.
const LINE_NOTES = {
  opSpecialtyGroup: 'same rate as OP Groups',
}

function LineTable({ columns, children }) {
  return (
    <div className="line-table-scroll">
      <table className="line-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : ''} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// The three views of a finished estimate, in the order the work needs them:
// the price to read out, the detail behind it, then the wording for the client.
const OUTPUT_VIEWS = [
  {
    key: 'costNote',
    tab: 'Cost Note',
    title: 'Cost Note',
    hint: 'What to tell the client. This is the only part that needs to be read out loud.',
  },
  {
    key: 'staffDetail',
    tab: 'Staff Detail',
    title: 'Staff Detail',
    hint: 'Every number behind that deposit — for the file and for questions.',
  },
  {
    key: 'clientExplanation',
    // The result column is narrow; the tab is short and the heading below it
    // carries the full name.
    tab: 'Explanation',
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

// The staff detail, laid out rather than dumped into a <pre>. It is the longest
// of the three outputs and the one read in a narrow column, where a monospace
// block wraps a price back to the left margin and the sections run together.
// Laid out, the labels read down one column and the amounts down another, and a
// priced line keeps its arithmetic under the label it belongs to instead of
// pushing the amount off the end of the row. The text behind it is unchanged —
// what the Copy button puts on the clipboard is what was generated.
function StaffDetailText({ text }) {
  const { blocks } = parseStaffDetail(text)
  return (
    <div className="doc">
      {blocks.map((block, i) => (
        <section key={i} className="doc-section">
          {block.heading && <h3 className="doc-heading">{block.heading}</h3>}
          {block.rows.map((row, j) =>
            row.label === null ? (
              <p key={j} className="doc-statement">
                {row.value}
              </p>
            ) : (
              <div key={j} className="doc-row">
                <div className="doc-label">
                  {row.label}
                  {row.working && <span className="doc-working">{row.working}</span>}
                  {row.note && <span className="doc-working">{row.note}</span>}
                </div>
                <div className={`doc-value${row.amount ? ' doc-value-amount' : ''}`}>
                  {row.value}
                </div>
              </div>
            )
          )}
        </section>
      ))}
    </div>
  )
}

function OutputPanel({ output }) {
  const [activeKey, setActiveKey] = useState(OUTPUT_VIEWS[0].key)
  const [copied, setCopied] = useState(false)
  const active = OUTPUT_VIEWS.find((v) => v.key === activeKey) || OUTPUT_VIEWS[0]
  const text = output[active.key] || ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* Clipboard unavailable — the text is on screen to select by hand. */
      setCopied(false)
    }
  }

  const selectView = (key) => {
    setActiveKey(key)
    setCopied(false)
  }

  return (
    <div className="result-card">
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

      {active.key === 'costNote' && <CostNoteText text={text} />}
      {active.key === 'staffDetail' && <StaffDetailText text={text} />}
      {active.key === 'clientExplanation' && <pre className="explanation-text">{text}</pre>}
    </div>
  )
}

export default function EstimatorTool() {
  const [form, setForm] = useState(INITIAL_ESTIMATE_STATE)
  const [showOutput, setShowOutput] = useState(false)

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }))
  const setNested = (group, key) => (value) =>
    setForm((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }))
  const setOverride = (code, value) =>
    setForm((prev) => {
      const next = { ...prev.rateOverrides }
      if (value === '') delete next[code]
      else next[code] = value
      return { ...prev, rateOverrides: next }
    })

  // A level's own terms. Clearing a field puts that level back on the plan's
  // answer rather than storing a second copy of it.
  const setLevelRule = (loc, field) => (value) =>
    setForm((prev) => {
      const rule = { ...(prev.levelRules[loc] || {}) }
      if (value === '' || value === undefined) delete rule[field]
      else rule[field] = value
      const levelRules = { ...prev.levelRules }
      if (Object.keys(rule).length === 0) delete levelRules[loc]
      else levelRules[loc] = rule
      return { ...prev, levelRules }
    })

  const resetUnits = () => setForm((prev) => ({ ...prev, units: {} }))
  // Any count the user typed, whether against a service or against one level
  // of care inside it.
  const unitsEdited = Object.values(form.units).some((v) => v !== undefined && v !== '')

  const result = useMemo(() => computeEstimate(form), [form])
  const hardship = useMemo(() => computeHardship(result, form), [result, form])
  const blockers = useMemo(() => [...estimateBlockers(form), ...hardshipBlockers(form)], [form])
  const { inpatient, outpatient } = result
  const locs = sequenceLocs(form.treatmentSequence)
  const copayActive = form.copayBasis !== COPAY_BASIS.NA
  // The levels this sequence actually names, in the order care is delivered
  // through them. Nothing to override until a sequence is chosen.
  const sequenceLevels = LEVEL_RULE_LOCS.filter((l) =>
    sequenceIncludes(form.treatmentSequence, l.loc)
  )
  const levelsDiffer = hasLevelOverrides(form)

  // The client's side of the estimate, split by what created each dollar. Four
  // categories, each direct-labeled with its own value in the legend.
  const responsibilitySegments = [
    { label: 'Deductible', value: inpatient.deductibleApplied + outpatient.deductibleApplied, series: 1 },
    { label: 'Coinsurance', value: inpatient.coinsurance + outpatient.coinsurance, series: 2 },
    { label: 'Copay', value: inpatient.copay + outpatient.copay, series: 3 },
    { label: 'Admission fees', value: inpatient.admissionFees + outpatient.admissionFees, series: 4 },
  ]

  // Nothing is written until it is asked for — a panel offering a quote over a
  // half-entered form is worse than no panel. Once open it tracks the form, so
  // what is on screen is always this estimate rather than an older one, and an
  // edit that reopens a blocker takes the quote back down with it.
  const output = useMemo(
    () => (showOutput ? generateEstimateOutput(form, result, blockers, hardship) : null),
    [showOutput, form, result, blockers, hardship]
  )

  return (
    <div className="tool-layout">
      <div className="tool-form">
        <Section
          title="Plan & Pathway"
          eyebrow="Step 1"
          description="The carrier sets every contracted rate below. The treatment sequence decides which levels of care are in the estimate at all."
        >
          <div className="field-row">
            <Field label="Insurance Carrier" htmlFor="carrier" required>
              <Select
                id="carrier"
                value={form.carrier}
                onChange={set('carrier')}
                options={CARRIER_OPTIONS}
                placeholder="Select a carrier…"
              />
            </Field>
            <Field
              label="Network Status"
              required={needsNetworkChoice(form.carrier)}
              hint={
                needsNetworkChoice(form.carrier)
                  ? 'This carrier has no network on file, so it has to be stated.'
                  : undefined
              }
            >
              {needsNetworkChoice(form.carrier) ? (
                <SegmentedControl
                  name="networkOverride"
                  options={['INN', 'OON']}
                  value={form.networkOverride}
                  onChange={set('networkOverride')}
                />
              ) : (
                <div className={`network-pill network-${(result.network || 'none').toLowerCase().replace(/\s+/g, '-')}`}>
                  {result.network || 'Select a carrier'}
                </div>
              )}
            </Field>
          </div>

          <Field
            label="Location"
            htmlFor="location"
            hint={(() => {
              const loc = getLocation(form.location)
              if (result.schedule) {
                return `${loc?.label} bills on the ${result.schedule.label} schedule, effective ${result.schedule.effective}. Those signed rates outrank the carrier table; a code the schedule does not cover falls back to it.`
              }
              // A contracted schedule is an in-network agreement, so an OON
              // plan gets the carrier's own allowed amounts no matter which
              // site the client walks into.
              if (result.scheduleSuppressed) {
                return `${loc?.label} has a ${result.scheduleSuppressed.label} contract, but this plan is ${result.network} — there is no agreement with an out-of-network payer, so every rate below is the carrier's own allowed amount.`
              }
              if (loc) {
                return `No contracted rate schedule on file for ${loc.label} — there is no ${loc.state} rate sheet — so every rate here comes from the carrier table.`
              }
              return 'Which site the client is admitting to. In network it sets the contracted rates; out of network the carrier’s own allowed amounts apply either way.'
            })()}
          >
            <Select
              id="location"
              value={form.location}
              onChange={set('location')}
              options={LOCATIONS.map((loc) => ({
                value: loc.id,
                label: `${loc.label}, ${loc.state}`,
              }))}
              placeholder="No location — carrier table only"
            />
          </Field>

          {result.schedule?.alternates.map((alt) => (
            <Banner key={`${alt.code}-${alt.contracted}`} tone="info">
              <strong>{alt.code}</strong> is contracted at a second rate here —{' '}
              {formatMoney(alt.contracted)} for {alt.note}. The residential line prices at the
              other one; enter {formatMoney(alt.contracted)} in its Rate column when the stay bills
              under that revenue code.
            </Banner>
          ))}

          <Field
            label="Treatment Sequence"
            htmlFor="treatmentSequence"
            required
            hint="Only the levels of care named here are priced. Everything else stays at zero."
          >
            <Select
              id="treatmentSequence"
              value={form.treatmentSequence}
              onChange={set('treatmentSequence')}
              options={TREATMENT_SEQUENCES}
              placeholder="Select a sequence…"
            />
          </Field>

          {locs.length > 0 && (
            <div className="pathway-chips">
              {locs.map((loc, i) => (
                <span key={`${loc}-${i}`} className="pathway-chip">
                  {loc}
                </span>
              ))}
            </div>
          )}

          {result.network === 'INN' && (
            <Field label="Bundled Agreement (INN IOP)?">
              <SegmentedControl
                name="bundledInnIop"
                options={['Yes', 'No']}
                value={form.bundledInnIop}
                onChange={set('bundledInnIop')}
              />
              {form.bundledInnIop === 'Yes' && (
                <Banner tone="info">
                  Individual and family therapy are folded into the IOP rate — they add no cost and
                  no copay units to this estimate.
                </Banner>
              )}
            </Field>
          )}
          {isOtherCarrier(form.carrier) && (
            <Banner tone="info">
              Rates come from the Misc claims bucket — the average across every plan the app does
              not carry. Nothing here is specific to this client's plan, so treat the whole estimate
              as provisional and overwrite any rate the verification call establishes.
            </Banner>
          )}
          {result.network === 'Self Pay' && (
            <Banner tone="warn">
              This carrier is the self-pay rate sheet. Cost sharing does not apply to it — use the
              Self-Pay tool instead, which prices the same episode against a scholarship.
            </Banner>
          )}
        </Section>

        <Section
          title="Accumulators"
          eyebrow="Step 2"
          description="What is left of the plan year, as of today. The inpatient stay consumes these first; the outpatient estimate works against what remains."
        >
          <div className="field-row">
            <Field label="Deductible Remaining" htmlFor="deductibleRemaining" required>
              <CurrencyInput
                id="deductibleRemaining"
                value={form.deductibleRemaining}
                onChange={set('deductibleRemaining')}
              />
            </Field>
            <Field label="OOP Max Remaining" htmlFor="oopmRemaining" required>
              <CurrencyInput id="oopmRemaining" value={form.oopmRemaining} onChange={set('oopmRemaining')} />
            </Field>
          </div>

          <div className="field-row">
            <Field label="Coinsurance" htmlFor="coinsurancePercent" required>
              <PercentInput
                id="coinsurancePercent"
                value={form.coinsurancePercent}
                onChange={set('coinsurancePercent')}
              />
            </Field>
            <Field
              label="Deductible Counts Toward OOP Max?"
              hint="No means the deductible is collected on top of the maximum, not inside it."
            >
              <SegmentedControl
                name="deductibleInOopm"
                options={['Yes', 'No']}
                value={form.deductibleInOopm}
                onChange={set('deductibleInOopm')}
              />
            </Field>
          </div>

          <Field label="Previous Outstanding Balance" htmlFor="previousBalance" optional>
            <CurrencyInput id="previousBalance" value={form.previousBalance} onChange={set('previousBalance')} />
          </Field>
        </Section>

        <Section
          title="Copay"
          eyebrow="Step 3"
          description="Three separate questions, each of which moves money on its own: how the copay is counted, whether it displaces coinsurance, and which accumulators it feeds."
        >
          <div className="field-row">
            <Field label="Copay Amount" htmlFor="copayAmount">
              <CurrencyInput id="copayAmount" value={form.copayAmount} onChange={set('copayAmount')} />
            </Field>
            <Field
              label="Copay Basis"
              htmlFor="copayBasis"
              hint={
                {
                  [COPAY_BASIS.NA]: 'No copay is collected.',
                  [COPAY_BASIS.PER_UNIT]: 'Charged once per unit of every active service line.',
                  [COPAY_BASIS.PROFESSIONAL_ONLY]:
                    'Charged only on individually billed visits — assessment, therapy, psychiatry, MATs. Not on a program day.',
                  [COPAY_BASIS.MANUAL]: 'The amount entered is the whole copay, charged once.',
                }[form.copayBasis]
              }
            >
              <Select
                id="copayBasis"
                value={form.copayBasis}
                onChange={set('copayBasis')}
                options={Object.values(COPAY_BASIS)}
                placeholder="Select…"
              />
            </Field>
          </div>

          {copayActive && (
            <>
              <Field
                label="Copay Treatment"
                htmlFor="copayTreatment"
                hint="Replace Coinsurance means the copay is the whole cost share — no coinsurance is charged alongside it."
              >
                <SegmentedControl
                  name="copayTreatment"
                  options={Object.values(COPAY_TREATMENT)}
                  value={form.copayTreatment}
                  onChange={set('copayTreatment')}
                />
              </Field>

              <div className="field-row">
                <Field label="Copay Applies to Deductible?" required>
                  <SegmentedControl
                    name="copayAppliesToDeductible"
                    options={['Not Applicable', 'Yes', 'No']}
                    value={form.copayAppliesToDeductible}
                    onChange={set('copayAppliesToDeductible')}
                  />
                </Field>
                <Field label="Copay Applies to OOP Max?" required>
                  <SegmentedControl
                    name="copayAppliesToOop"
                    options={['Not Applicable', 'Yes', 'No']}
                    value={form.copayAppliesToOop}
                    onChange={set('copayAppliesToOop')}
                  />
                </Field>
              </div>
              {(form.copayAppliesToOop === 'Not Applicable' ||
                form.copayAppliesToDeductible === 'Not Applicable') && (
                <Banner tone="warn">
                  Until both answers are established the copay has no accumulator behavior, and a
                  copay that feeds neither accumulator drops out of the capped responsibility
                  entirely. Confirm them with the plan rather than leaving the estimate to guess.
                </Banner>
              )}
            </>
          )}
        </Section>

        <Section
          title="Admission Fees"
          eyebrow="Step 4"
          description="Charged once on entry to a level of care, and only for the levels the sequence names."
        >
          <div className="fee-grid">
            {ADMISSION_FEE_LOCS.map((loc) => {
              const active = sequenceIncludes(form.treatmentSequence, loc.loc)
              return (
                <div key={loc.key} className={`fee-cell${active ? '' : ' fee-cell-inactive'}`}>
                  <label className="fee-label" htmlFor={`fee-${loc.key}`}>
                    {loc.label}
                    {!active && <span className="fee-off">not in sequence</span>}
                  </label>
                  <CurrencyInput
                    id={`fee-${loc.key}`}
                    value={form.admissionFees[loc.key]}
                    onChange={setNested('admissionFees', loc.key)}
                    size="sm"
                  />
                </div>
              )
            })}
          </div>
          <Field label="Admission Fee Counts Toward OOP Max?">
            <SegmentedControl
              name="admissionFeeInOopm"
              options={['Yes', 'No']}
              value={form.admissionFeeInOopm}
              onChange={set('admissionFeeInOopm')}
            />
          </Field>
        </Section>

        <Section
          title="Inpatient Nights"
          eyebrow="Step 5"
          description="Detox and residential are billed per night at the carrier's contracted rate."
        >
          <LineTable
            columns={[
              { key: 'svc', label: 'Level of care' },
              { key: 'code', label: 'Code' },
              { key: 'nights', label: 'Nights', align: 'right' },
              { key: 'rate', label: 'Rate / night', align: 'right' },
              { key: 'cost', label: 'Allowed cost', align: 'right' },
            ]}
          >
            {inpatient.lines.map((line) => (
              <tr key={line.key} className={line.active ? '' : 'row-inactive'}>
                <td>
                  {line.label}
                  {!line.active && <span className="row-off">not in sequence</span>}
                </td>
                <td className="mono">{line.code}</td>
                <td className="num">
                  <NumberInput
                    value={form.nights[line.key]}
                    onChange={setNested('nights', line.key)}
                  />
                </td>
                <td className="num">
                  <RateCell form={form} code={line.code} onOverride={setOverride} />
                </td>
                <td className="num strong">{formatMoney(line.allowed)}</td>
              </tr>
            ))}
          </LineTable>
        </Section>

        <Section
          title="Outpatient Services"
          eyebrow="Step 6"
          description="Counts start from the typical episode for the levels of care in this sequence, and every one of them is editable."
          actions={
            unitsEdited && (
              <button type="button" className="btn-secondary" onClick={resetUnits}>
                ↺ Reset counts
              </button>
            )
          }
        >
          <LineTable
            columns={[
              { key: 'svc', label: 'Service' },
              { key: 'code', label: 'Code' },
              { key: 'units', label: 'Units', align: 'right' },
              { key: 'rate', label: 'Allowed rate', align: 'right' },
              { key: 'after', label: 'After ded.', align: 'right' },
              { key: 'cost', label: 'Allowed cost', align: 'right' },
            ]}
          >
            {outpatient.lines.map((line) => (
              <tr key={line.key} className={line.active ? '' : 'row-inactive'}>
                <td>
                  {line.label}
                  {line.bundledOut && <span className="row-off row-off-bundled">bundled into IOP</span>}
                  {!line.inSequence && <span className="row-off">not in sequence</span>}
                  {line.inSequence && LINE_NOTES[line.lineKey ?? line.key] && (
                    <span className="row-off">{LINE_NOTES[line.lineKey ?? line.key]}</span>
                  )}
                </td>
                <td className="mono">{line.code}</td>
                <td className="num">
                  <NumberInput
                    value={form.units[line.key] ?? formatUnits(line.units)}
                    onChange={setNested('units', line.key)}
                  />
                </td>
                <td className="num">
                  <RateCell form={form} code={line.code} onOverride={setOverride} />
                </td>
                <td className="num muted">
                  {line.afterDeductibleRate === null ? '—' : formatMoney(line.afterDeductibleRate)}
                </td>
                <td className="num strong">{formatMoney(line.allowed)}</td>
              </tr>
            ))}
          </LineTable>
        </Section>

        <Section
          title="Level of Care Rules"
          eyebrow="Step 7"
          description="Where a plan does not treat every level of care the same way. Leave a cell blank and that level uses the plan terms above — this is only for what the verification call actually established."
        >
          {sequenceLevels.length === 0 ? (
            <Banner tone="info">
              Select a treatment sequence to set rules for the levels of care in it.
            </Banner>
          ) : (
            <>
              <div className="line-table-scroll">
                <table className="line-table">
                  <thead>
                    <tr>
                      <th>Level of care</th>
                      <th>Deductible applies?</th>
                      <th className="num">Copay</th>
                      <th>Copay basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequenceLevels.map(({ loc, label }) => {
                      const rule = form.levelRules[loc] || {}
                      const effective = levelRule(form, loc)
                      return (
                        <tr key={loc}>
                          <td>
                            {label}
                            {(effective.deductibleOverridden || effective.copayOverridden) && (
                              <span className="row-off">own terms</span>
                            )}
                          </td>
                          <td>
                            <SegmentedControl
                              name={`deductibleApplies-${loc}`}
                              options={['Yes', 'No']}
                              value={rule.deductibleApplies || 'Yes'}
                              onChange={setLevelRule(loc, 'deductibleApplies')}
                            />
                          </td>
                          <td className="num">
                            <CurrencyInput
                              value={rule.copayAmount ?? ''}
                              onChange={setLevelRule(loc, 'copayAmount')}
                              placeholder={toNumber(form.copayAmount).toFixed(2)}
                              size="sm"
                            />
                          </td>
                          <td>
                            <Select
                              value={rule.copayBasis || ''}
                              onChange={setLevelRule(loc, 'copayBasis')}
                              options={Object.values(COPAY_BASIS)}
                              placeholder={`Plan default — ${form.copayBasis}`}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <Banner tone={levelsDiffer ? 'warn' : 'info'}>
                {levelsDiffer
                  ? 'This estimate runs on mixed rules. The deductible is spent in the order care is delivered, skipping any level that waives it, and each level collects its own copay.'
                  : 'Every level of care is on the plan terms above. An estimate with nothing overridden here is the estimate the workbook computes.'}
              </Banner>
            </>
          )}
        </Section>

        <Section
          title="Hardship"
          eyebrow="Step 8"
          description="Turn this on only when a client cannot meet the deposit. Everything above stays exactly as it is — hardship splits the deposit, it does not change the estimate."
        >
          <Field label="Hardship / scholarship required?">
            <SegmentedControl
              name="hardship"
              options={['No', 'Yes']}
              value={form.hardship}
              onChange={set('hardship')}
            />
          </Field>
          {form.hardship === 'Yes' && (
            <>
              <Field
                label="Total the client can afford"
                htmlFor="clientCanAfford"
                hint="Applied to the deposit in the order care is delivered: the earliest level of care takes what it can, and hardship covers everything the money does not reach."
                required
              >
                <CurrencyInput
                  id="clientCanAfford"
                  value={form.clientCanAfford}
                  onChange={set('clientCanAfford')}
                />
              </Field>
              <div className="result-detail">
                <div className="result-detail-row">
                  <span>Deposit under review</span>
                  <span className="strong">{formatMoney(hardship.deposit)}</span>
                </div>
                <div className="result-detail-row">
                  <span>Hardship required</span>
                  <span className="strong">{formatMoney(hardship.scholarship)}</span>
                </div>
              </div>
            </>
          )}
        </Section>
      </div>

      {/* ── The estimate ─────────────────────────────────────────────── */}
      <aside className="tool-result">
        <div className="result-sticky">
          <BlockerList blockers={blockers} />

          <div className="result-card">
            <HeroFigure
              label="Estimated total deposit"
              value={formatMoney(result.grandTotal, { decimals: 0 })}
              caption={
                form.treatmentSequence
                  ? `${form.treatmentSequence}${form.carrier ? ` · ${form.carrier}` : ''}`
                  : 'Select a carrier and treatment sequence'
              }
            />

            <StatRow>
              {hardship.active ? (
                <>
                  <StatTile
                    label="Client pays"
                    value={formatMoney(hardship.clientPays, { decimals: 0 })}
                    tone="accent"
                  />
                  <StatTile
                    label="Hardship covers"
                    value={formatMoney(hardship.scholarship, { decimals: 0 })}
                    caption={formatPercent(hardship.scholarshipPercent, 1)}
                  />
                </>
              ) : (
                <>
                  <StatTile label="Inpatient deposit" value={formatMoney(inpatient.deposit, { decimals: 0 })} />
                  <StatTile label="Outpatient deposit" value={formatMoney(outpatient.deposit, { decimals: 0 })} />
                  {result.previousBalance > 0 && (
                    <StatTile label="Prior balance" value={formatMoney(result.previousBalance, { decimals: 0 })} />
                  )}
                </>
              )}
            </StatRow>

            <div className="result-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowOutput((v) => !v)}
                aria-expanded={showOutput}
              >
                {showOutput ? '× Hide output' : '⧉ Generate output'}
              </button>
            </div>
          </div>

          {hardship.active && (
            <div className="result-card">
              <h3 className="result-heading">Hardship allocation</h3>
              <p className="result-note">
                What the client can afford is applied to the deposit in the order care is
                delivered. The level of care where the money runs out is the one that splits;
                everything after it is carried by hardship.
              </p>
              <Meter
                label="Carried by hardship"
                value={hardship.scholarship}
                total={hardship.deposit}
                valueText={formatMoney(hardship.scholarship, { decimals: 0 })}
                totalText={`${formatMoney(hardship.deposit, { decimals: 0 })} deposit`}
                tone="warn"
              />
              <Meter
                label="Paid by the client"
                value={hardship.clientPays}
                total={hardship.deposit}
                valueText={formatMoney(hardship.clientPays, { decimals: 0 })}
                totalText={`${formatMoney(hardship.deposit, { decimals: 0 })} deposit`}
                tone="accent"
              />
              {hardship.rows.length > 0 && (
                <table className="line-table line-table-compact">
                  <thead>
                    <tr>
                      <th>Applied to</th>
                      <th className="num">Client pays</th>
                      <th className="num">Hardship</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hardship.rows.map((row) => (
                      <tr key={row.key} className={row.clientPays === 0 ? 'row-inactive' : ''}>
                        <td>
                          {row.label}
                          <span className="cell-sub">
                            owes {formatMoney(row.responsibility, { decimals: 0 })}
                            {row.units > 0 &&
                              row.scholarship > 0 &&
                              ` · ${formatUnits(row.coveredUnits)} of ${formatUnits(row.units)} ${unitNoun(row.units, row.unitNoun)} covered`}
                            {row.split && ' · splits here'}
                          </span>
                        </td>
                        <td className="num strong">{formatMoney(row.clientPays, { decimals: 0 })}</td>
                        <td className="num">{formatMoney(row.scholarship, { decimals: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Totals</td>
                      <td className="num strong">{formatMoney(hardship.clientPays, { decimals: 0 })}</td>
                      <td className="num strong">{formatMoney(hardship.scholarship, { decimals: 0 })}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {hardship.surplus > 0 && (
            <Banner tone="info">
              The client can afford {formatMoney(hardship.canAfford, { decimals: 0 })}, which is{' '}
              {formatMoney(hardship.surplus, { decimals: 0 })} more than this deposit asks for. No
              hardship is required — the surplus is not credited against anything here.
            </Banner>
          )}

          {hardship.coversPreviousBalance > 0 && (
            <Banner tone="warn">
              Hardship is covering {formatMoney(hardship.coversPreviousBalance)} of the balance
              already owed on the account. Forgiving an old balance is a separate decision from
              covering this admission — confirm it is intended before quoting.
            </Banner>
          )}

          {output && <OutputPanel output={output} />}

          {result.estimatedRates.length > 0 && (
            <Banner tone="info">
              <strong>
                {result.estimatedRates.length} line
                {result.estimatedRates.length === 1 ? ' is' : 's are'} priced from average
                reimbursement
              </strong>{' '}
              — {result.estimatedRates.map((r) => `${r.label} (${r.code})`).join(', ')}. Neither the
              plan nor a contract has a rate for{' '}
              {result.estimatedRates.length === 1 ? 'it' : 'them'}, so the estimate uses what the{' '}
              {[...new Set(result.estimatedRates.map((r) => r.group))].join(' and ')} claims were
              actually paid on average. That is an estimate, not a quote — verify before committing
              a client to this deposit.
            </Banner>
          )}

          {result.missingRates.length > 0 && (
            <Banner tone="warn">
              <strong>
                {result.missingRates.length} scheduled service
                {result.missingRates.length === 1 ? ' has' : 's have'} no rate
              </strong>{' '}
              — {result.missingRates.map((r) => `${r.label} (${r.code})`).join(', ')}. Each is
              costing $0 in the total above, which understates the deposit. Enter the rate from the
              verification call in the Rate column, or use the <em>misc</em> button beside it to
              fill the Misc claims average.
              {result.missingRates.some((r) => r.uncontracted) && (
                <>
                  {' '}
                  {result.missingRates
                    .filter((r) => r.uncontracted)
                    .map((r) => r.label)
                    .join(', ')}{' '}
                  {result.missingRates.filter((r) => r.uncontracted).length === 1 ? 'is' : 'are'}{' '}
                  billed but not contracted on the {result.schedule?.label} schedule — that is a
                  different problem from an unpriced code, and the plan may not pay it at all.
                </>
              )}
              <ul className="benchmark-list">
                {result.missingRates.map((r) => {
                  const comparable = carriersWithRate(r.code, { limit: 3 })
                  return (
                    <li key={r.key}>
                      <span className="mono">{r.code}</span>{' '}
                      {r.benchmark !== null && <>average across carriers {formatMoney(r.benchmark)}</>}
                      {comparable.length > 0 && (
                        <span className="benchmark-carriers">
                          {' '}
                          · e.g. {comparable.map((c) => `${c.name} ${formatMoney(c.rate)}`).join(', ')}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </Banner>
          )}

          <div className="result-card">
            <h3 className="result-heading">Where the client's money goes</h3>
            <SegmentBar segments={responsibilitySegments} />
            <Meter
              label="Plan pays"
              value={result.totalRevenue}
              total={result.totalAllowed}
              valueText={formatMoney(result.totalRevenue, { decimals: 0 })}
              totalText={`${formatMoney(result.totalAllowed, { decimals: 0 })} allowed`}
              tone="ok"
            />
          </div>

          {inpatient.active && (
            <div className="result-card">
              <h3 className="result-heading">Inpatient waterfall</h3>
              <Waterfall
                rows={[
                  {
                    label: 'Estimated allowed cost',
                    note: `${inpatient.totalNights} nights`,
                    value: formatMoney(inpatient.totalAllowed),
                  },
                  { label: 'Deductible applied', value: formatMoney(inpatient.deductibleApplied) },
                  { label: 'Coinsurance', value: formatMoney(inpatient.coinsurance) },
                  { label: 'Copay applied', value: formatMoney(inpatient.copay) },
                  { label: 'Admission fee', value: formatMoney(inpatient.admissionFees) },
                  {
                    label: 'Responsibility before OOP cap',
                    value: formatMoney(inpatient.beforeCap),
                    muted: true,
                  },
                  { label: 'After OOP cap', value: formatMoney(inpatient.afterCap), muted: true },
                  { label: 'Inpatient deposit', value: formatMoney(inpatient.deposit), emphasis: true },
                  { label: 'Estimated revenue', value: formatMoney(inpatient.revenue), muted: true },
                ]}
              />
            </div>
          )}

          {outpatient.active && (
            <div className="result-card">
              <h3 className="result-heading">Outpatient waterfall</h3>
              {inpatient.active && (
                <p className="result-note">
                  Starts from what the inpatient stay left: {formatMoney(outpatient.deductibleAtEntry)}{' '}
                  of deductible and {formatMoney(outpatient.oopAtEntry)} of out-of-pocket room.
                </p>
              )}
              <Waterfall
                rows={[
                  { label: 'Estimated allowed cost', value: formatMoney(outpatient.totalAllowed) },
                  { label: 'Deductible remaining at entry', value: formatMoney(outpatient.deductibleAtEntry), muted: true },
                  { label: 'OOP remaining at entry', value: formatMoney(outpatient.oopAtEntry), muted: true },
                  { label: 'Deductible applied', value: formatMoney(outpatient.deductibleApplied) },
                  { label: 'Coinsurance', value: formatMoney(outpatient.coinsurance) },
                  {
                    label: 'Copay applied',
                    note: outpatient.copayUnits > 0 ? `${outpatient.copayUnits} units` : undefined,
                    value: formatMoney(outpatient.copay),
                  },
                  { label: 'Admission fee', value: formatMoney(outpatient.admissionFees) },
                  { label: 'Responsibility before OOP cap', value: formatMoney(outpatient.beforeCap), muted: true },
                  { label: 'After OOP cap', value: formatMoney(outpatient.afterCap), muted: true },
                  { label: 'Outpatient deposit', value: formatMoney(outpatient.deposit), emphasis: true },
                  { label: 'Estimated revenue', value: formatMoney(outpatient.revenue), muted: true },
                ]}
              />
            </div>
          )}

          {!inpatient.active && !outpatient.active && (
            <Banner tone="info">
              Select a treatment sequence to price an episode. Nothing is costed until a level of
              care is in the pathway.
            </Banner>
          )}
        </div>
      </aside>
    </div>
  )
}
