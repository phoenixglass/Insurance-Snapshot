// Shared form and display primitives. Every tool in the app is built from
// these, so a control behaves and reads the same way wherever it appears.

import { useState } from 'react'
import { formatMoney } from './estimate.js'

// A segmented control for short, mutually exclusive answers. A radio group
// underneath, but it reads as one control rather than a row of loose dots,
// which is what a Yes/No question is.
export function SegmentedControl({ name, options, value, onChange }) {
  const items = options.map((opt) => (typeof opt === 'string' ? { value: opt, label: opt } : opt))
  return (
    <div className="segmented" role="radiogroup" aria-label={name}>
      {items.map((opt) => (
        <label
          key={opt.value}
          className={`segmented-option${value === opt.value ? ' segmented-option-active' : ''}`}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

export function CurrencyInput({ id, value, onChange, placeholder = '0.00', disabled = false, size }) {
  return (
    <div className={`currency-input-wrapper${size === 'sm' ? ' input-sm' : ''}`}>
      <span className="currency-symbol">$</span>
      <input
        id={id}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        className="currency-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  )
}

export function NumberInput({ id, value, onChange, min = 0, step = 1, suffix, disabled = false }) {
  return (
    <div className="number-input-wrapper">
      <input
        id={id}
        type="number"
        min={min}
        step={step}
        inputMode="numeric"
        className="number-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {suffix && <span className="number-suffix">{suffix}</span>}
    </div>
  )
}

export function PercentInput({ id, value, onChange, disabled = false }) {
  return (
    <div className="percent-input-wrapper">
      <input
        id={id}
        type="number"
        min="0"
        max="100"
        step="0.1"
        inputMode="decimal"
        className="percent-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        disabled={disabled}
      />
      <span className="percent-symbol">%</span>
    </div>
  )
}

export function Select({ id, value, onChange, options, placeholder = 'Select…' }) {
  return (
    <div className="select-wrapper">
      <select id={id} className="select-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((opt) => {
          const o = typeof opt === 'string' ? { value: opt, label: opt } : opt
          return (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          )
        })}
      </select>
    </div>
  )
}

// `badge` marks where a field's value came from when the field has somewhere to
// inherit it from — a level of care reading the plan's answer rather than
// stating its own. A control showing an inherited value looks exactly like one
// showing a chosen value, and on a form where both are on screen at once that
// is the difference between "the plan says no" and "I said no".
export function Field({ label, htmlFor, hint, required, optional, badge, children }) {
  return (
    <div className="field-group">
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="required-star"> *</span>}
          {optional && <span className="optional-hint"> — optional</span>}
          {badge && (
            <span className={`field-badge${badge.tone ? ` field-badge-${badge.tone}` : ''}`}>
              {badge.label}
            </span>
          )}
        </label>
      )}
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

// A step of the form. The header is one row — step chip, title, whatever badge
// the step is carrying, and the controls — because on a screen meant to be read
// without scrolling, a heading that costs three lines is a heading that costs a
// section.
//
// The prose that explains a step is real, but it is reference: it answers a
// question asked once, and then sits there taking up the room the fields need.
// So it lives behind the ⓘ, and a step that is an exception rather than the
// normal path (`defaultOpen={false}`) starts closed with a badge saying what it
// is holding, so nothing is hidden without being announced.
export function Section({
  title,
  eyebrow,
  description,
  actions,
  badge,
  wide,
  collapsible = true,
  defaultOpen = true,
  children,
}) {
  const [open, setOpen] = useState(collapsible ? defaultOpen : true)
  const [showInfo, setShowInfo] = useState(false)

  const heading = (
    <>
      {eyebrow && <span className="section-eyebrow">{eyebrow}</span>}
      <span className="section-name">{title}</span>
    </>
  )

  return (
    <section
      className={`form-section${wide ? ' section-wide' : ''}${open ? '' : ' form-section-closed'}`}
    >
      <div className="section-head">
        <h2 className="section-title">
          {collapsible ? (
            <button
              type="button"
              className="section-toggle"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="section-chevron" aria-hidden="true">
                ▸
              </span>
              {heading}
            </button>
          ) : (
            <span className="section-toggle section-toggle-static">{heading}</span>
          )}
        </h2>

        {badge && (
          <span className={`section-badge${badge.tone ? ` section-badge-${badge.tone}` : ''}`}>
            {badge.label}
          </span>
        )}

        <div className="section-head-actions">
          {description && (
            <button
              type="button"
              className={`section-info${showInfo ? ' section-info-on' : ''}`}
              aria-expanded={showInfo}
              aria-label={showInfo ? `Hide the note on ${title}` : `What ${title} is for`}
              title={showInfo ? 'Hide the note' : 'What this step is for'}
              onClick={() => {
                // Opening the note on a closed section would put it nowhere.
                setShowInfo((v) => !v)
                setOpen(true)
              }}
            >
              i
            </button>
          )}
          {actions}
        </div>
      </div>

      {open && (
        <div className="section-body">
          {showInfo && description && <p className="section-description">{description}</p>}
          {children}
        </div>
      )}
    </section>
  )
}

export function Banner({ tone = 'info', children }) {
  const icon = { info: 'ℹ', warn: '⚠', danger: '⚠', success: '✓' }[tone] || 'ℹ'
  return (
    <div className={`banner banner-${tone}`}>
      <span className="banner-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="banner-body">{children}</div>
    </div>
  )
}

// The one number a screen leads with.
export function HeroFigure({ label, value, caption, tone = 'accent' }) {
  return (
    <div className={`hero-figure hero-${tone}`}>
      <span className="hero-label">{label}</span>
      <span className="hero-value">{value}</span>
      {caption && <span className="hero-caption">{caption}</span>}
    </div>
  )
}

export function StatTile({ label, value, caption, tone }) {
  return (
    <div className={`stat-tile${tone ? ` stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {caption && <span className="stat-caption">{caption}</span>}
    </div>
  )
}

export function StatRow({ children }) {
  return <div className="stat-row">{children}</div>
}

// A single ratio against its limit — a scholarship against the program cost, a
// deductible against what is left of it.
export function Meter({ label, value, total, valueText, totalText, tone = 'accent' }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="meter">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">
          {valueText ?? formatMoney(value)}
          {totalText !== null && <span className="meter-total"> of {totalText ?? formatMoney(total)}</span>}
        </span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill meter-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// A part-to-whole bar. Segments carry identity by hue, and every one of them is
// direct-labeled in the legend below with its own value — the hues are never
// the only thing telling them apart.
export function SegmentBar({ segments, total }) {
  const sum = total ?? segments.reduce((acc, s) => acc + s.value, 0)
  const visible = segments.filter((s) => s.value > 0)
  return (
    <div className="segment-bar-block">
      <div className="segment-bar" role="img" aria-label={visible.map((s) => `${s.label} ${formatMoney(s.value)}`).join(', ')}>
        {sum > 0 ? (
          visible.map((s) => (
            <div
              key={s.label}
              className="segment"
              style={{ width: `${(s.value / sum) * 100}%`, background: `var(--series-${s.series})` }}
              title={`${s.label}: ${formatMoney(s.value)}`}
            />
          ))
        ) : (
          <div className="segment segment-empty" />
        )}
      </div>
      <ul className="segment-legend">
        {segments.map((s) => (
          <li key={s.label} className={s.value > 0 ? '' : 'segment-legend-zero'}>
            <span className="segment-chip" style={{ background: `var(--series-${s.series})` }} aria-hidden="true" />
            <span className="segment-legend-label">{s.label}</span>
            <span className="segment-legend-value">{formatMoney(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// The step-by-step arithmetic behind a total. Rendered as rows rather than a
// chart because the reader's job here is to check a number, not to compare
// magnitudes at a glance.
export function Waterfall({ rows }) {
  return (
    <div className="waterfall">
      {rows.map((row) => (
        <div
          key={row.label}
          className={[
            'waterfall-row',
            row.emphasis ? 'waterfall-row-total' : '',
            row.muted ? 'waterfall-row-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="waterfall-label">
            {row.label}
            {row.note && <span className="waterfall-note">{row.note}</span>}
          </span>
          <span className="waterfall-value">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy' }) {
  return (
    <button
      type="button"
      className="btn-copy"
      onClick={async (e) => {
        const btn = e.currentTarget
        try {
          await navigator.clipboard.writeText(text)
          const original = btn.textContent
          btn.textContent = '✓ Copied'
          setTimeout(() => {
            btn.textContent = original
          }, 1800)
        } catch {
          /* Clipboard unavailable — the text is on screen to select by hand. */
        }
      }}
    >
      ⧉ {label}
    </button>
  )
}

export function BlockerList({ blockers, title = 'Resolve before quoting' }) {
  if (blockers.length === 0) return null
  return (
    <div className="submit-blockers">
      <div className="submit-blockers-title">{title}</div>
      <ul>
        {blockers.map((msg) => (
          <li key={msg}>{msg}</li>
        ))}
      </ul>
    </div>
  )
}
