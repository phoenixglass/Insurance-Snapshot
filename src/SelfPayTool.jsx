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
  allocateSelfPayBudget,
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

function LineRows({ lines, form, byUnits, automatic, onUnits, onScholarship, onRate }) {
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
      <td className="num strong scholarship-side">{formatMoney(line.payment)}</td>
      <td className="num scholarship-side">
        {automatic ? formatMoney(line.scholarship) : byUnits ? (
          <NumberInput value={form.scholarship[line.key]} onChange={(v) => onScholarship(line.key, v)} />
        ) : (
          <CurrencyInput value={form.scholarship[line.key]} onChange={(v) => onScholarship(line.key, v)} size="sm" />
        )}
      </td>
      <td className="num scholarship-side">{formatPercent(line.scholarshipPercent, 1)}</td>
      <td className="num scholarship-side">{unitText(line.coveredUnits)}</td>
      <td className="num scholarship-side">{formatMoney(line.units > 0 ? line.payment / line.units : 0)}</td>
    </tr>
  ))
}

export default function SelfPayTool() {
  const [form, setForm] = useState(INITIAL_SELF_PAY_STATE)
  const [percent, setPercent] = useState('')
  const [method, setMethod] = useState('none')
  const [budget, setBudget] = useState('')
  const automatic = method === 'none' || method === 'budget'

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

  const effectiveForm = useMemo(() => method === 'budget' && budget !== ''
    ? allocateSelfPayBudget(form, budget)
    : automatic ? { ...form, scholarship: {} } : form, [form, method, budget, automatic])
  const result = useMemo(() => computeSelfPay(effectiveForm), [effectiveForm])
  const blockers = selfPayBlockers(form)
  const byUnits = form.scholarshipMode === 'units'

  const inpatient = result.lines.filter((l) => l.group === 'inpatient')
  const serviceOrder = ['opwm', 'php', 'assessment', 'family', 'iop', 'psychEval', 'opGroups', 'psychFollowUp', 'opSpecialtyGroup', 'mats', 'individual']
  const rank = (line) => {
    const i = serviceOrder.indexOf(line.key)
    return i < 0 ? serviceOrder.length : i
  }
  const outpatient = result.lines.filter((l) => l.group === 'outpatient').sort((a, b) => method === 'budget' ? 0 : rank(a) - rank(b))

  const columns = ['Service', 'Code', 'Units', 'Rate', 'Program cost', 'Client pays',
    automatic ? 'Scholarship $' : byUnits ? 'Covered units (edit)' : 'Scholarship $ (edit)',
    'Scholarship %', 'Covered units', 'ADR']

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
      <div className="selfpay-sheet-head">
        <div className="selfpay-program">
          <h2>Program cost</h2>
          <div className="selfpay-sheet-fields">
            <Field label="Treatment sequence" htmlFor="selfPaySequence" required>
              <Select id="selfPaySequence" value={form.treatmentSequence} onChange={setSequence} options={TREATMENT_SEQUENCES} placeholder="Select a sequence…" />
            </Field>
            <div className="selfpay-sheet-total"><span>Total program cost</span><strong>{formatMoney(result.grossCost)}</strong></div>
            <div className="selfpay-sheet-total"><span>Total program units</span><strong>{unitText(result.costedUnits)}</strong></div>
          </div>
        </div>
        <div className="selfpay-hardship">
          <h2>Hardship / Scholarship</h2>
          <div className="selfpay-sheet-fields">
            <Field label="Scholarship required?">
              <SegmentedControl name="hardshipRequired" options={[{value:'none',label:'No'},{value:'budget',label:'Yes'}]} value={method === 'none' ? 'none' : 'budget'} onChange={setMethod} />
            </Field>
            {method !== 'none' && <Field label="Allocation method">
              <SegmentedControl name="allocationMethod" options={[{value:'budget',label:'Client affordability'},{value:'manual',label:'Manual award'}]} value={method} onChange={setMethod} />
            </Field>}
            {method === 'budget' && <Field label="Total client can afford" htmlFor="selfPayBudget" required>
              <CurrencyInput id="selfPayBudget" value={budget} onChange={setBudget} />
            </Field>}
            {method === 'manual' && <>
              <Field label="Award entered as"><SegmentedControl name="scholarshipMode" options={SCHOLARSHIP_MODES} value={form.scholarshipMode} onChange={setMode} /></Field>
              <Field label="Fill from percentage" htmlFor="scholarshipPercent"><div className="percent-apply"><PercentInput id="scholarshipPercent" value={percent} onChange={setPercent} /><button type="button" className="btn-secondary" onClick={applyPercent}>Apply</button></div></Field>
            </>}
            <div className="selfpay-sheet-total"><span>Scholarship required</span><strong>{formatMoney(result.totalScholarship)}</strong></div>
            <div className="selfpay-sheet-total"><span>Client responsibility</span><strong>{formatMoney(result.finalClientResponsibility)}</strong></div>

          </div>
        </div>
      </div>
      <BlockerList blockers={[...blockers, ...(method === 'budget' && budget === '' ? ['Enter the amount the client can afford'] : [])]} />
      <div className="tool-form">
        <div className="form-grid">
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
          actions={<CopyButton text={summaryText} label="Copy summary" />}
          description="Every count starts at zero — enter what this client is actually buying. The rate is the sheet rate unless you type your own over it, and the scholarship covers whole units at whatever rate the row carries."
        >
          <div className="line-table-scroll">
            <table className="line-table line-table-wide selfpay-worksheet-table">
              <colgroup>{[18,8,7,9,8,12,10,9,10,9].map((width, i) => <col key={i} style={{ width: `${width}%` }} />)}</colgroup>
              <thead>
                <tr className="selfpay-table-bands"><th colSpan={5}>Program cost</th><th colSpan={5}>Hardship allocation</th></tr>
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
                  automatic={automatic}
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
                  automatic={automatic}
                  onUnits={setIn('units')}
                  onScholarship={setIn('scholarship')}
                  onRate={setRate}
                />
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Totals</td>
                  <td className="num strong">{formatMoney(result.grossCost)}</td>
                  <td className="num strong">{formatMoney(result.totalPayment)}</td>
                  <td className="num strong">{automatic || !byUnits ? formatMoney(result.totalScholarship) : unitText(result.scholarshipUnits)}</td>
                  <td className="num">{formatPercent(result.scholarshipPercent, 1)}</td>
                  <td className="num">{unitText(result.scholarshipUnits)}</td>
                  <td className="num strong">{formatMoney(result.costedUnits > 0 ? result.totalPayment / result.costedUnits : 0)}</td>
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
