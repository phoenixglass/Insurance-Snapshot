// Self-pay cost & scholarship estimate — the workbook's `Self Pay Calc` sheet.
//
// The screen is organized around the question the sheet exists to answer: how
// much of this program is the client paying for, and how much are we covering?
// A scholarship here is an award against the program, granted as a count of
// sessions or nights — 15 of 30 IOP sessions covered — not a cut to the rate.
// So the split is what the screen shows: units paid at the sheet rate, units
// covered at the same rate, and the dollars on each side.

import { useMemo, useState } from 'react'
import { formatMoney, formatPercent, sequenceLocs } from './estimate.js'
import { TREATMENT_SEQUENCES } from './data/rates.js'
import {
  INITIAL_SELF_PAY_STATE,
  SCHOLARSHIP_MODES,
  applyScholarshipPercent,
  computeSelfPay,
  selfPayBlockers,
  selfPayRate,
} from './selfPay.js'
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
  SegmentedControl,
  Section,
  Select,
  StatRow,
  StatTile,
} from './ui.jsx'

// Units are whole where they can be. A dollar scholarship that lands mid-night
// is shown to a decimal rather than rounded into looking tidy.
const unitText = (n) => (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(2))

// "1 session", not "1 sessions" — the copied summary goes straight into a note
// to a client, so it has to read like a sentence someone wrote.
const noun = (n, unitNoun) => (Math.abs(n - 1) < 1e-9 ? unitNoun.replace(/s$/, '') : unitNoun)

function LineRows({ lines, form, byUnits, onUnits, onScholarship, onRate }) {
  return lines.map((line) => (
    <tr key={line.key} className={line.active ? '' : 'row-inactive'}>
      <td>
        {line.label}
        {!line.active && <span className="row-off">not in sequence</span>}
      </td>
      <td className="mono">{line.code}</td>
      <td className="num">
        <NumberInput value={form.units[line.key]} onChange={(v) => onUnits(line.key, v)} />
      </td>
      <td className="num">
        <div className="rate-cell">
          <CurrencyInput
            value={form.rateOverrides[line.key] ?? ''}
            onChange={(v) => onRate(line.key, v)}
            placeholder={
              selfPayRate(line, {}) === null ? 'no rate' : selfPayRate(line, {}).toFixed(2)
            }
            size="sm"
          />
          {line.fixedRate !== undefined && !form.rateOverrides[line.key] && (
            <span className="rate-tag">set rate</span>
          )}
        </div>
      </td>
      <td className="num strong">{formatMoney(line.programCost)}</td>
      <td className="num">
        {byUnits ? (
          <NumberInput
            value={form.scholarship[line.key]}
            onChange={(v) => onScholarship(line.key, v)}
          />
        ) : (
          <CurrencyInput
            value={form.scholarship[line.key]}
            onChange={(v) => onScholarship(line.key, v)}
            size="sm"
          />
        )}
      </td>
      <td className="num">{formatMoney(line.scholarship)}</td>
      <td className="num muted">
        {line.programCost > 0
          ? `${unitText(line.paidUnits)} / ${unitText(line.coveredUnits)}`
          : '—'}
      </td>
      <td className="num strong">{formatMoney(line.payment)}</td>
    </tr>
  ))
}

export default function SelfPayTool() {
  const [form, setForm] = useState(INITIAL_SELF_PAY_STATE)
  const [percent, setPercent] = useState('')

  const setSequence = (value) => setForm((prev) => ({ ...prev, treatmentSequence: value }))
  const setIn = (group) => (key, value) =>
    setForm((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }))
  const setRate = (key, value) =>
    setForm((prev) => {
      const next = { ...prev.rateOverrides }
      if (value === '') delete next[key]
      else next[key] = value
      return { ...prev, rateOverrides: next }
    })
  // Switching how the award is expressed clears the entries rather than
  // reading nights as dollars.
  const setMode = (value) =>
    setForm((prev) => ({
      ...prev,
      scholarshipMode: value,
      scholarship: Object.fromEntries(Object.keys(prev.scholarship).map((k) => [k, ''])),
    }))
  const applyPercent = () => setForm((prev) => applyScholarshipPercent(prev, percent))

  const result = useMemo(() => computeSelfPay(form), [form])
  const blockers = selfPayBlockers(form)
  const locs = sequenceLocs(form.treatmentSequence)
  const byUnits = form.scholarshipMode === 'units'

  const inpatient = result.lines.filter((l) => l.group === 'inpatient')
  const outpatient = result.lines.filter((l) => l.group === 'outpatient')

  const columns = [
    'Service',
    'Code',
    'Units',
    'Rate',
    'Program cost',
    byUnits ? 'Units covered' : 'Scholarship $',
    'Scholarship',
    'Paid / covered',
    'Client pays',
  ]

  // What actually gets pasted into a note or an email. Every costed line is
  // written the way the award was granted — this many units at the full rate,
  // this many covered — so nobody downstream reads it as a cut rate.
  const lineText = result.lines
    .filter((l) => l.programCost > 0)
    .map((l) =>
      [
        `${l.label} — ${unitText(l.units)} ${noun(l.units, l.unitNoun)} @ ${formatMoney(l.rate)}`,
        `    Client pays ${unitText(l.paidUnits)} ${noun(l.paidUnits, l.unitNoun)}: ${formatMoney(l.payment)}`,
        `    Scholarship covers ${unitText(l.coveredUnits)} ${noun(l.coveredUnits, l.unitNoun)}: ${formatMoney(l.scholarship)}`,
      ].join('\n'),
    )

  const summaryText = [
    `Treatment sequence: ${form.treatmentSequence || '—'}`,
    '',
    ...lineText,
    '',
    `Total program cost: ${formatMoney(result.grossCost)}`,
    `Scholarship: ${formatMoney(result.totalScholarship)} (${formatPercent(result.scholarshipPercent)} of the program, ${unitText(result.scholarshipUnits)} units of care)`,
    'Rates are unchanged — the scholarship covers units of care, it does not reduce the per-unit rate.',
    '',
    `FINAL CLIENT RESPONSIBILITY: ${formatMoney(result.finalClientResponsibility)}`,
  ].join('\n')

  return (
    <div className="tool-stack">
      <div className="result-band">
        <BlockerList blockers={blockers} />

        <div className="result-card">
          <HeroFigure
            label="Final client responsibility"
            value={formatMoney(result.finalClientResponsibility, { decimals: 0 })}
            caption={form.treatmentSequence || 'Select a treatment sequence'}
          />
          <StatRow>
            <StatTile label="Program cost" value={formatMoney(result.grossCost, { decimals: 0 })} />
            <StatTile
              label="Scholarship"
              value={formatMoney(result.totalScholarship, { decimals: 0 })}
              caption={formatPercent(result.scholarshipPercent, 1)}
            />
          </StatRow>
          <div className="result-actions">
            <CopyButton text={summaryText} label="Copy summary" />
          </div>
        </div>

        <div className="result-card">
          <h3 className="result-heading">How the program splits</h3>
          <Meter
            label="Units covered by scholarship"
            value={result.scholarshipUnits}
            total={result.costedUnits}
            valueText={`${unitText(result.scholarshipUnits)} units`}
            totalText={`${unitText(result.costedUnits)} units of care`}
            tone="warn"
          />
          <Meter
            label="Units the client pays for"
            value={result.paidUnits}
            total={result.costedUnits}
            valueText={`${unitText(result.paidUnits)} units`}
            totalText={`${unitText(result.costedUnits)} units of care`}
            tone="accent"
          />
          <div className="result-detail">
            <div className="result-detail-row">
              <span>Scholarship in dollars</span>
              <span className="strong">{formatMoney(result.totalScholarship)}</span>
            </div>
            <div className="result-detail-row">
              <span>Client pays</span>
              <span className="strong">{formatMoney(result.totalPayment)}</span>
            </div>
          </div>
          <p className="result-note">
            Rates do not change. The client is billed the full sheet rate for the units they
            cover, and the scholarship pays for the rest at that same rate.
          </p>
        </div>

        {result.overAllocatedLines.length > 0 && (
          <Banner tone="warn">
            The scholarship entered is larger than the program cost on{' '}
            {result.overAllocatedLines.join(', ')}. That line is covered in full and the client
            pays nothing against it — the surplus is not applied anywhere else.
          </Banner>
        )}

        {result.partialUnitLines.length > 0 && (
          <Banner tone="info">
            The scholarship on {result.partialUnitLines.join(', ')} does not land on a whole unit
            of care. Round it to a whole session or night if the award is meant to read as a
            count of units covered.
          </Banner>
        )}

        {result.missingRates.length > 0 && (
          <Banner tone="warn">
            No self-pay rate on file for{' '}
            {result.missingRates.map((r) => `${r.label} (${r.code})`).join(', ')}. Those lines are
            costing $0 — enter a rate before quoting.
          </Banner>
        )}

        {!result.active && (
          <Banner tone="info">
            Select a treatment sequence to price an episode. Nothing is costed until a level of
            care is in the pathway.
          </Banner>
        )}
      </div>

      <div className="tool-form">
        <Section
          title="Episode"
          eyebrow="Step 1"
          description="Only the levels of care named in the sequence are costed. Everything else stays out of the estimate."
        >
          <Field label="Treatment Sequence" htmlFor="selfPaySequence" required>
            <Select
              id="selfPaySequence"
              value={form.treatmentSequence}
              onChange={setSequence}
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
          <Banner tone="info">
            Rates come from the self-pay column of the same rate sheet the insurance estimator
            uses, and they stay at full price on both sides of the split.
          </Banner>
        </Section>

        <Section
          title="Scholarship"
          eyebrow="Step 2"
          description="Award the scholarship as the units of care the program is covering, or as the dollar figure agreed."
        >
          <Field label="How the award is entered">
            <SegmentedControl
              name="scholarshipMode"
              options={SCHOLARSHIP_MODES}
              value={form.scholarshipMode}
              onChange={setMode}
            />
          </Field>
          <Field
            label="Fill from a percentage"
            htmlFor="scholarshipPercent"
            hint={
              byUnits
                ? 'Splits every costed line at this percentage, rounded to whole units of care.'
                : 'Splits every costed line at this percentage of its program cost.'
            }
            optional
          >
            <div className="percent-apply">
              <PercentInput id="scholarshipPercent" value={percent} onChange={setPercent} />
              <button type="button" className="btn-secondary" onClick={applyPercent}>
                Apply to costed lines
              </button>
            </div>
          </Field>
          {result.grossCost > 0 && (
            <div className="result-detail">
              <div className="result-detail-row">
                <span>Scholarship as entered</span>
                <span className="strong">
                  {formatPercent(result.scholarshipPercent, 1)} · {formatMoney(result.totalScholarship)}
                </span>
              </div>
            </div>
          )}
          <Banner tone="info">
            A 50% scholarship on 30 IOP sessions is 15 sessions billed at the full rate and 15
            sessions covered — not 30 sessions at half the rate. Line entries are editable after
            the percentage is applied.
          </Banner>
        </Section>

        <Section
          title="Line Items"
          eyebrow="Step 3"
          description="One row per service. Enter what the scholarship covers against each; the client pays for the rest at the sheet rate."
        >
          <div className="line-table-scroll">
            <table className="line-table line-table-wide">
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th key={c} className={i >= 2 ? 'num' : ''}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="group-row">
                  <td colSpan={columns.length}>Inpatient — Detox &amp; Residential</td>
                </tr>
                <LineRows
                  lines={inpatient}
                  form={form}
                  byUnits={byUnits}
                  onUnits={setIn('units')}
                  onScholarship={setIn('scholarship')}
                  onRate={setRate}
                />
                <tr className="group-row">
                  <td colSpan={columns.length}>OPS — OPWM, PHP, IOP &amp; Outpatient Services</td>
                </tr>
                <LineRows
                  lines={outpatient}
                  form={form}
                  byUnits={byUnits}
                  onUnits={setIn('units')}
                  onScholarship={setIn('scholarship')}
                  onRate={setRate}
                />
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Totals</td>
                  <td className="num strong">{formatMoney(result.grossCost)}</td>
                  <td className="num">
                    {byUnits
                      ? `${unitText(result.scholarshipUnits)} units`
                      : formatMoney(result.totalScholarship)}
                  </td>
                  <td className="num strong">
                    {formatMoney(result.totalScholarship)}
                    <span className="cell-sub">{formatPercent(result.scholarshipPercent, 0)}</span>
                  </td>
                  <td className="num">
                    {unitText(result.paidUnits)} / {unitText(result.scholarshipUnits)}
                  </td>
                  <td className="num strong">{formatMoney(result.totalPayment)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      </div>

    </div>
  )
}
