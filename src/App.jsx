// The shell. Three tools that share one rate sheet and one visual system:
//
//   Estimator  — prices an episode against the plan into a deposit, and writes
//                the cost note read to the client
//   Self-Pay   — prices the same episode without insurance, against a scholarship
//   Rates      — the carrier rate sheet, searchable
//
// Each keeps its own state for the life of the session, so switching tabs to
// check a rate never costs you a half-filled form.

import { useEffect, useRef, useState } from 'react'
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
  // Clearing a tool remounts it, so every field it holds — including any added
  // later — goes back to its initial value without each tool having to
  // maintain a reset of its own. Per tool, because a half-filled estimate is
  // not something to throw away because someone cleared the rate search.
  const [generation, setGeneration] = useState({ estimator: 0, selfpay: 0, rates: 0 })
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmTimer = useRef(null)
  const tool = TOOLS.find((t) => t.key === active) || TOOLS[0]

  // Clearing is one click away and cannot be undone, so it asks first. The
  // question expires rather than sitting armed behind whatever the user went on
  // to do.
  useEffect(() => {
    if (!confirmClear) return undefined
    confirmTimer.current = setTimeout(() => setConfirmClear(false), 5000)
    return () => clearTimeout(confirmTimer.current)
  }, [confirmClear])

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    setGeneration((prev) => ({ ...prev, [active]: prev[active] + 1 }))
  }

  const selectTool = (key) => {
    setActive(key)
    setConfirmClear(false)
  }

  // Every tool stays mounted so its form state survives a tab switch. Only the
  // active one is visible.
  const panels = {
    estimator: <EstimatorTool key={generation.estimator} />,
    selfpay: <SelfPayTool key={generation.selfpay} />,
    rates: <RateLookupTool key={generation.rates} />,
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
                title={t.blurb}
                className={`tool-tab${t.key === active ? ' tool-tab-active' : ''}`}
                onClick={() => selectTool(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="app-actions">
            <button
              type="button"
              className={`btn-clear${confirmClear ? ' btn-clear-armed' : ''}`}
              onClick={handleClear}
              title={`Clear every entry in ${tool.title} and start a new calculation`}
            >
              {confirmClear ? 'Clear everything?' : '↺ Clear'}
            </button>
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
        </div>
      </header>

      <div className={`app-body app-body-${tool.width}`}>
        {/* The tab bar already names the tool on screen; the heading is here for
            anyone navigating by headings rather than by eye. */}
        <h1 className="sr-only">{tool.title}</h1>

        {TOOLS.map((t) => (
          <div key={t.key} role="tabpanel" hidden={t.key !== active}>
            {panels[t.key]}
          </div>
        ))}
      </div>
    </div>
  )
}
