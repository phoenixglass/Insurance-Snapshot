// CPT / HCPCS rate lookup — the workbook's lookup widget in the corner of the
// calculator sheet.
//
// The workbook makes you declare up front whether you are searching by code or
// by description, because a spreadsheet dropdown cannot do both at once. That
// constraint is not real here, so one field matches either, and the result
// carries what the workbook's four cells carried: the code, the description,
// the allowed amount, and the rate after the deductible.

import { Fragment, useMemo, useState } from 'react'
import {
  carrierNetwork,
  carriersWithRate,
  formatMoney,
  searchCodes,
  toNumber,
} from './estimate.js'
import { CARRIERS } from './data/rates.js'
import { Banner, Field, PercentInput, Section, Select } from './ui.jsx'

export default function RateLookupTool() {
  const [carrier, setCarrier] = useState('')
  const [query, setQuery] = useState('')
  const [coinsurance, setCoinsurance] = useState('20')
  const [expanded, setExpanded] = useState(null)

  const network = carrierNetwork(carrier)
  const coins = toNumber(coinsurance) / 100
  const results = useMemo(() => searchCodes(query, carrier, { limit: 60 }), [query, carrier])

  const onFileCount = results.filter((r) => r.onFile).length

  return (
    <div className="lookup-layout">
      <Section
        title="CPT / HCPCS Rate Lookup"
        eyebrow="Reference"
        description="Search by code or by service description — one field matches either. Rates are the contracted or allowed amount for the selected carrier."
      >
        <div className="field-row">
          <Field label="Carrier" htmlFor="lookupCarrier" required>
            <Select
              id="lookupCarrier"
              value={carrier}
              onChange={setCarrier}
              options={CARRIERS.map((c) => ({ value: c.name, label: `${c.name} — ${c.network}` }))}
              placeholder="Select a carrier…"
            />
          </Field>
          <Field label="Coinsurance" htmlFor="lookupCoins" hint="Sets the after-deductible column.">
            <PercentInput id="lookupCoins" value={coinsurance} onChange={setCoinsurance} />
          </Field>
        </div>

        <Field label="Search" htmlFor="lookupQuery">
          <div className="search-input-wrapper">
            <span className="search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              id="lookupQuery"
              type="search"
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={'90853, H0015, "group", "psychiatric"…'}
            />
          </div>
        </Field>

        {carrier && (
          <div className="lookup-meta">
            <span className={`network-pill network-${network.toLowerCase().replace(/\s+/g, '-')}`}>
              {network}
            </span>
            <span className="lookup-count">
              {onFileCount} of {results.length} shown have a rate on file
            </span>
          </div>
        )}
      </Section>

      {!carrier ? (
        <Banner tone="info">Select a carrier to see its rates.</Banner>
      ) : (
        <div className="line-table-scroll">
          <table className="line-table lookup-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Service description</th>
                <th className="num">Allowed / before deductible</th>
                <th className="num">After deductible</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <Fragment key={r.code}>
                  <tr
                    className={`lookup-row${r.onFile ? '' : ' row-inactive'}`}
                    onClick={() => setExpanded(expanded === r.code ? null : r.code)}
                  >
                    <td className="mono">{r.code}</td>
                    <td>{r.description}</td>
                    <td className="num strong">
                      {r.onFile ? (
                        formatMoney(r.rate)
                      ) : (
                        <span className="rate-tag rate-tag-missing">not on file</span>
                      )}
                    </td>
                    <td className="num muted">{r.onFile ? formatMoney(r.rate * coins) : '—'}</td>
                  </tr>
                  {expanded === r.code && (
                    <tr className="lookup-detail-row">
                      <td colSpan={4}>
                        <div className="lookup-detail">
                          {r.benchmark !== null && (
                            <div>
                              <span className="lookup-detail-label">Average across all carriers</span>
                              <span className="strong">{formatMoney(r.benchmark)}</span>
                            </div>
                          )}
                          <div className="lookup-comparables">
                            <span className="lookup-detail-label">
                              {r.onFile ? 'Other carriers' : 'Comparable plans to estimate from'}
                            </span>
                            <ul>
                              {carriersWithRate(r.code, { limit: 10 }).map((c) => (
                                <li key={c.name}>
                                  <span className="comparable-name">{c.name}</span>
                                  <span className="comparable-net">{c.network}</span>
                                  <span className="comparable-rate">{formatMoney(c.rate)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {results.length === 0 && (
                <tr>
                  <td colSpan={4} className="empty-cell">
                    No code or description matches “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
