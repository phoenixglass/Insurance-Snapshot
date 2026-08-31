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
  SERVICE_LINES,
  carriersWithRate,
  computeEstimate,
  defaultUnitsFor,
  estimateBlockers,
  formatMoney,
  isOtherCarrier,
  resolveRate,
  sequenceIncludes,
  sequenceLocs,
} from './estimate.js'
import { TREATMENT_SEQUENCES } from './data/rates.js'
import { LOCATIONS, getLocation } from './data/contractRates.js'
import { miscRate } from './data/reimbursement.js'
import {
  Banner,
  BlockerList,
  CopyButton,
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

export default function EstimatorTool() {
  const [form, setForm] = useState(INITIAL_ESTIMATE_STATE)

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

  const resetUnits = () => setForm((prev) => ({ ...prev, units: {} }))
  const unitsEdited = SERVICE_LINES.some(
    (l) => form.units[l.key] !== undefined && form.units[l.key] !== ''
  )

  const result = useMemo(() => computeEstimate(form), [form])
  const blockers = estimateBlockers(form)
  const { inpatient, outpatient } = result
  const locs = sequenceLocs(form.treatmentSequence)
  const copayActive = form.copayBasis !== COPAY_BASIS.NA

  // The client's side of the estimate, split by what created each dollar. Four
  // categories, each direct-labeled with its own value in the legend.
  const responsibilitySegments = [
    { label: 'Deductible', value: inpatient.deductibleApplied + outpatient.deductibleApplied, series: 1 },
    { label: 'Coinsurance', value: inpatient.coinsurance + outpatient.coinsurance, series: 2 },
    { label: 'Copay', value: inpatient.copay + outpatient.copay, series: 3 },
    { label: 'Admission fees', value: inpatient.admissionFees + outpatient.admissionFees, series: 4 },
  ]

  const quoteText = [
    `Treatment sequence: ${form.treatmentSequence || '—'}`,
    `Carrier: ${form.carrier || '—'}${result.network ? ` (${result.network})` : ''}`,
    '',
    `Inpatient deposit: ${formatMoney(inpatient.deposit)}`,
    `Outpatient deposit: ${formatMoney(outpatient.deposit)}`,
    result.previousBalance > 0 ? `Previous balance: ${formatMoney(result.previousBalance)}` : null,
    '',
    `ESTIMATED TOTAL DEPOSIT: ${formatMoney(result.grandTotal)}`,
    '',
    `Total estimated allowed cost: ${formatMoney(result.totalAllowed)}`,
    `Estimated revenue after client responsibility: ${formatMoney(result.totalRevenue)}`,
  ]
    .filter((l) => l !== null)
    .join('\n')

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
              required={isOtherCarrier(form.carrier)}
              hint={
                isOtherCarrier(form.carrier)
                  ? 'An unlisted carrier has no network on file, so it has to be stated.'
                  : undefined
              }
            >
              {isOtherCarrier(form.carrier) ? (
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
            hint={
              result.schedule
                ? `${getLocation(form.location)?.label} bills on the ${result.schedule.label} schedule, effective ${result.schedule.effective}. Those signed rates outrank the carrier table; a code the schedule does not cover falls back to it.`
                : 'Which site the client is admitting to. It sets the contracted rates. Without it every rate comes from the carrier table, which is observed and estimated rather than signed.'
            }
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
                </td>
                <td className="mono">{line.code}</td>
                <td className="num">
                  <NumberInput
                    value={form.units[line.key] ?? String(defaultUnitsFor(line, form.treatmentSequence))}
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
              <StatTile label="Inpatient deposit" value={formatMoney(inpatient.deposit, { decimals: 0 })} />
              <StatTile label="Outpatient deposit" value={formatMoney(outpatient.deposit, { decimals: 0 })} />
              {result.previousBalance > 0 && (
                <StatTile label="Prior balance" value={formatMoney(result.previousBalance, { decimals: 0 })} />
              )}
            </StatRow>

            <div className="result-actions">
              <CopyButton text={quoteText} label="Copy estimate" />
            </div>
          </div>

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
