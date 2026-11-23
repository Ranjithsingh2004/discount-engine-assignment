/**
 * ErrorBanner.jsx
 * Displays a list of parse or validation problems.
 * variant "error" (red) = nothing was loaded; "warning" (amber) = loaded, but some rows were skipped.
 */

import { C } from './theme.js'

const VARIANTS = {
  error: { bg: C.redBg, border: '#e57373', accent: '#c0392b', title: C.red, text: '#5a1010' },
  warning: { bg: C.amberBg, border: C.amberLine, accent: '#d08a00', title: C.amber, text: '#5a3a00' },
}

export default function ErrorBanner({ errors, variant = 'error', title }) {
  if (!errors || errors.length === 0) return null
  const v = VARIANTS[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      style={{
        background: v.bg,
        border: `1px solid ${v.border}`,
        borderLeft: `3px solid ${v.accent}`,
        borderRadius: 4,
        padding: '0.6rem 0.9rem',
        marginTop: '0.5rem',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, color: v.title, marginBottom: 4 }}>
        {title ?? `${errors.length} issue${errors.length > 1 ? 's' : ''} found`}
      </div>
      {errors.map((e, i) => (
        <div key={i} style={{ fontSize: 12, color: v.text, marginTop: 2, overflowWrap: 'anywhere' }}>
          {e}
        </div>
      ))}
    </div>
  )
}
