// Self-pay cost & scholarship estimate — the workbook's `Self Pay Calc` sheet.
//
// The screen is organized around the question the sheet exists to answer: given
// what this client can pay, how large is the scholarship, and what does it look
// like in the units a director signs off on — a percentage, a number of nights,
// a daily rate.

import { useMemo, useState } from 'react'
import { formatMoney, formatPercent, sequenceLocs } from './estimate.js'
import { TREATMENT_SEQUENCES } from './data/rates.js'
import {
  INITIAL_SELF_PAY_STATE,
  SELF_PAY_LINES,
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
  Section,
  Select,
  StatRow,
  StatTile,
} from './ui.jsx'

function LineRows({ lines, form, onUnits, onPayment, onRate }) {
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
        <CurrencyInput
          value={form.payments[line.key]}
          onChange={(v) => onPayment(line.key, v)}
          size="sm"
        />
      </td>
      <td className="num">{formatMoney(line.scholarship)}</td>
      <td className="num muted">{line.programCost > 0 ? formatPercent(line.scholarshipPercent, 0) : '—'}</td>
      <td className="num muted">{line.programCost > 0 ? formatMoney(line.averageDailyRate, { decimals: 0 }) : '—'}</td>
    </tr>
  ))
}

export default function SelfPayTool() {
  const [form, setForm] = useState(INITIAL_SELF_PAY_STATE)

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

  const result = useMemo(() => computeSelfPay(form), [form])
  const blockers = selfPayBlockers(form)
  const locs = sequenceLocs(form.treatmentSequence)

  const inpatient = result.lines.filter((l) => l.group === 'inpatient')
  const outpatient = result.lines.filter((l) => l.group === 'outpatient')

  const columns = [
    'Service',
    'Code',
    'Units',
    'Rate',
    'Program cost',
    'Client payment',
    'Scholarship',
    'Sch. %',
    'Avg / unit',
  ]

  const summaryText = [
    `Treatment sequence: ${form.treatmentSequence || '—'}`,
    '',
    `Total gross cost: ${formatMoney(result.grossCost)}`,
    `Client payment: ${formatMoney(result.totalPayment)}`,
    `Total scholarship: ${formatMoney(result.totalScholarship)} (${formatPercent(result.scholarshipPercent)})`,
    `Blended rate per unit of care: ${formatMoney(result.blendedDailyRate)}`,
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
            <StatTile label="Gross cost" value={formatMoney(result.grossCost, { decimals: 0 })} />
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
          <h3 className="result-heading">Scholarship against the program</h3>
          <Meter
            label="Covered by scholarship"
            value={result.totalScholarship}
            total={result.grossCost}
            valueText={formatMoney(result.totalScholarship, { decimals: 0 })}
            totalText={`${formatMoney(result.grossCost, { decimals: 0 })} program cost`}
            tone="warn"
          />
          <Meter
            label="Paid by client"
            value={result.totalPayment}
            total={result.grossCost}
            valueText={formatMoney(result.totalPayment, { decimals: 0 })}
            totalText={`${formatMoney(result.grossCost, { decimals: 0 })} program cost`}
            tone="accent"
          />
          <div className="result-detail">
            <div className="result-detail-row">
              <span>Scholarship restated as units of care</span>
              <span className="strong">{result.scholarshipUnits.toFixed(1)}</span>
            </div>
            <div className="result-detail-row">
              <span>Blended rate per unit of care</span>
              <span className="strong">{formatMoney(result.blendedDailyRate)}</span>
            </div>
          </div>
        </div>

        {result.overpaidLines.length > 0 && (
          <Banner tone="warn">
            The payment entered exceeds the program cost on {result.overpaidLines.join(', ')}.
            That line is paid in full and carries no scholarship — the surplus is not applied
            anywhere else.
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
            Rates come from the self-pay column of the same rate sheet the insurance estimator uses.
            The client's payment is applied to each line first; the scholarship is whatever the
            payment did not reach.
          </Banner>
        </Section>

        <Section
          title="Line Items"
          eyebrow="Step 2"
          description="One row per service. Enter what the client is paying against each; the scholarship is the rest."
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
                  onUnits={setIn('units')}
                  onPayment={setIn('payments')}
                  onRate={setRate}
                />
                <tr className="group-row">
                  <td colSpan={columns.length}>OPS — OPWM, PHP, IOP &amp; Outpatient Services</td>
                </tr>
                <LineRows
                  lines={outpatient}
                  form={form}
                  onUnits={setIn('units')}
                  onPayment={setIn('payments')}
                  onRate={setRate}
                />
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Totals</td>
                  <td className="num strong">{formatMoney(result.grossCost)}</td>
                  <td className="num strong">{formatMoney(result.totalPayment)}</td>
                  <td className="num strong">{formatMoney(result.totalScholarship)}</td>
                  <td className="num">{formatPercent(result.scholarshipPercent, 0)}</td>
                  <td className="num">{formatMoney(result.blendedDailyRate, { decimals: 0 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>
      </div>

    </div>
  )
}
