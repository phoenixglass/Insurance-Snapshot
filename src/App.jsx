// The shell. Three tools that share one rate sheet and one visual system:
//
//   Estimator  — prices an episode against the plan into a deposit, and writes
//                the cost note read to the client
//   Self-Pay   — prices the same episode without insurance, against a scholarship
//   Rates      — the carrier rate sheet, searchable
//
// Each keeps its own state for the life of the session, so switching tabs to
// check a rate never costs you a half-filled form.

import { useEffect, useState } from 'react'
import './App.css'
import EstimatorTool from './EstimatorTool.jsx'
import RateLookupTool from './RateLookupTool.jsx'
import SelfPayTool from './SelfPayTool.jsx'

const TOOLS = [
  {
    key: 'estimator',
    label: 'Deposit Estimator',
    title: 'Deposit Estimator',
    blurb: 'Price a treatment sequence against the plan into a deposit, and generate the cost note.',
    width: 'wide',
  },
  {
    key: 'selfpay',
    label: 'Self-Pay',
    title: 'Self-Pay & Scholarship',
    blurb: 'Price the same episode without insurance, and split it between the client and a scholarship.',
    width: 'wide',
  },
  {
    key: 'rates',
    label: 'Rates',
    title: 'Rate Sheet',
    blurb: 'Every contracted rate, by carrier and code.',
    width: 'medium',
  },
]

const THEME_KEY = 'insurance-snapshot-theme'

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) || 'system'
    } catch {
      return 'system'
    }
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* Storage can be unavailable; the theme still applies for this session. */
    }
  }, [theme])

  return [theme, setTheme]
}

export default function App() {
  const [active, setActive] = useState('estimator')
  const [theme, setTheme] = useTheme()
  const tool = TOOLS.find((t) => t.key === active) || TOOLS[0]

  // Every tool stays mounted so its form state survives a tab switch. Only the
  // active one is visible.
  const panels = {
    estimator: <EstimatorTool />,
    selfpay: <SelfPayTool />,
    rates: <RateLookupTool />,
  }

  return (
    <div className="app-shell">
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Insurance Snapshot</span>
          </div>

          <nav className="tool-nav" role="tablist" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === active}
                className={`tool-tab${t.key === active ? ' tool-tab-active' : ''}`}
                onClick={() => setActive(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <div className={`app-body app-body-${tool.width}`}>
        <div className="page-head">
          <h1>{tool.title}</h1>
          <p>{tool.blurb}</p>
        </div>

        {TOOLS.map((t) => (
          <div key={t.key} role="tabpanel" hidden={t.key !== active}>
            {panels[t.key]}
          </div>
        ))}
      </div>
    </div>
  )
}
