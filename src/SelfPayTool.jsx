// Self-pay cost & scholarship estimate — the workbook's `Self Pay Calc` sheet.
//
// The screen is organized around the question the sheet exists to answer: how
// much of this program is the client paying for, and how much are we covering?
// A scholarship here is an award against the program, granted as a count of
// sessions or nights — 15 of 30 IOP sessions covered — not a cut to the rate.
// So the split is what the screen shows: units paid at the sheet rate, units
// covered at the same rate, and the dollars on each side.

import { useMemo, useState } from 'react'
import { formatMoney, formatPercent, unitNoun } from './estimate.js'
import { TREATMENT_SEQUENCES } from './data/rates.js'
import {
  INITIAL_SELF_PAY_STATE,
  SCHOLARSHIP_MODES,
  applyScholarshipPercent,
  computeSelfPay,
  convertScholarshipMode,
  selfPayBlockers,
  selfPayRate,
} from './selfPay.js'
import {
  Banner,
  BlockerList,
  CopyButton,
  CurrencyInput,
  Field,
  NumberInput,
  PercentInput,
  SegmentedControl,
  Section,
  Select,
} from './ui.jsx'

// A dollar scholarship that lands mid-night is shown as the fraction it is
// rather than rounded into looking tidy, so this keeps two decimals where the
// shared formatter keeps one.
const unitText = (n) => (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(2))
const noun = unitNoun

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
          {form.rateOverrides[line.key] ? (
            // A rate typed over the sheet is its own kind of discount — a
            // reduced intake, say — and it is not the scholarship. Saying so on
            // the row keeps the two from being read as one number.
            <span className="rate-tag rate-tag-override">own rate</span>
          ) : (
            line.fixedRate !== undefined && <span className="rate-tag">set rate</span>
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
  // Switching how the award is expressed restates the entries in the other
  // unit — the award is the same award either way.
  const setMode = (value) => setForm((prev) => convertScholarshipMode(prev, value))
  const applyPercent = () => setForm((prev) => applyScholarshipPercent(prev, percent))

  const result = useMemo(() => computeSelfPay(form), [form])
  const blockers = selfPayBlockers(form)
  const byUnits = form.scholarshipMode === 'units'

  const inpatient = result.lines.filter((l) => l.group === 'inpatient')
  const serviceOrder = ['opwm', 'php', 'assessment', 'family', 'iop', 'psychEval', 'opGroups', 'psychFollowUp', 'opSpecialtyGroup', 'mats', 'individual']
  const rank = (line) => {
    const i = serviceOrder.indexOf(line.key)
    return i < 0 ? serviceOrder.length : i
  }
  const outpatient = result.lines.filter((l) => l.group === 'outpatient').sort((a, b) => rank(a) - rank(b))

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
        `${l.label} — ${unitText(l.units)} ${noun(l.units, l.unitNoun)} @ ${formatMoney(l.rate)}${
          form.rateOverrides[l.key] ? ' (rate set for this client)' : ''
        }`,
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
    <div className="tool-stack selfpay-compact">
      <div className="selfpay-summary">
        <div><span>Program cost</span><strong>{formatMoney(result.grossCost)}</strong></div>
        <div><span>Scholarship · {formatPercent(result.scholarshipPercent, 1)}</span><strong>{formatMoney(result.totalScholarship)}</strong></div>
        <div className="selfpay-total"><span>Final client responsibility</span><strong>{formatMoney(result.finalClientResponsibility)}</strong></div>
        <CopyButton text={summaryText} label="Copy summary" />
      </div>
      <BlockerList blockers={blockers} />
      <div className="tool-form">
        <div className="form-grid">
        <Section wide title="Treatment & Scholarship" description="Only selected levels of care are costed. Scholarships cover units at the full rate, or a dollar amount. Switching methods restates existing entries. Applying a percentage to covered units rounds each costed line to whole units; dollar mode applies the percentage to each line's program cost.">
          <div className="selfpay-controls">
            <Field label="Treatment sequence" htmlFor="selfPaySequence" required>
              <Select id="selfPaySequence" value={form.treatmentSequence} onChange={setSequence} options={TREATMENT_SEQUENCES} placeholder="Select a sequence…" />
            </Field>
            <Field label="Scholarship method">
              <SegmentedControl name="scholarshipMode" options={SCHOLARSHIP_MODES} value={form.scholarshipMode} onChange={setMode} />
            </Field>
            <Field label="Fill from a percentage" htmlFor="scholarshipPercent" optional>
              <div className="percent-apply">
                <PercentInput id="scholarshipPercent" value={percent} onChange={setPercent} />
                <button type="button" className="btn-secondary" onClick={applyPercent}>Apply to costed lines</button>
              </div>
            </Field>
          </div>
        </Section>
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


        <Section
          wide
          title="Line Items"
          description="Every count starts at zero — enter what this client is actually buying. The rate is the sheet rate unless you type your own over it, and the scholarship covers whole units at whatever rate the row carries."
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
    </div>
  )
}
