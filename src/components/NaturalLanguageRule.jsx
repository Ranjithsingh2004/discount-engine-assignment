/**
 * NaturalLanguageRule.jsx — Task 2 UI
 *
 * Plain-English text → parsed rule → confirmation step → onConfirm(rule).
 * Nothing reaches the rule list until the user confirms the parsed fields.
 */

import { useRef, useState } from 'react'
import { requestRuleParse, interpretRuleParse } from '../inputs/naturalLanguage.js'
import { calculateCart } from '../engine/discountEngine.js'
import { formatRs, offerText } from '../engine/copy.js'
import { C, S } from './theme.js'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

const uniq = (values) => [...new Set(values)]

export default function NaturalLanguageRule({ rules, cartItems, onConfirm }) {
  const [text, setText] = useState('')
  const [state, setState] = useState({ phase: 'idle' })
  const controller = useRef(null)

  async function parse(e) {
    e?.preventDefault()
    const input = text.trim()
    if (!input || state.phase === 'loading') return

    controller.current?.abort()
    controller.current = new AbortController()
    setState({ phase: 'loading' })

    try {
      const result = await requestRuleParse(
        input,
        {
          brands: uniq([...cartItems.map((i) => i.brand), ...rules.filter((r) => r.scope === 'brand').map((r) => r.appliesTo)]),
          platforms: uniq([...cartItems.map((i) => i.platform), ...rules.filter((r) => r.scope === 'platform').map((r) => r.appliesTo)]),
        },
        { signal: controller.current.signal }
      )
      setState({ phase: 'done', text: input, ...interpretRuleParse(result, { text: input, rules, cartItems }) })
    } catch (error) {
      if (error?.name === 'AbortError') return
      setState({ phase: 'done', kind: 'error', text: input, message: error.message })
    }
  }

  function reset() {
    setState({ phase: 'idle' })
  }

  return (
    <div>
      <div style={S.subTitle}>Add a rule in plain English</div>
      <form onSubmit={parse} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label="Describe a discount rule"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder='e.g. "15% off all Nordic Basics items"'
          style={{
            flex: '1 1 220px',
            minWidth: 0,
            border: `1px solid ${C.line}`,
            borderRadius: 4,
            padding: '0.55rem 0.7rem',
            fontSize: 13,
            color: C.navy,
          }}
        />
        <button type="submit" style={{ ...S.btn, opacity: text.trim() ? 1 : 0.5 }} disabled={!text.trim() || state.phase === 'loading'}>
          {state.phase === 'loading' ? 'Reading…' : 'Parse rule'}
        </button>
      </form>
      <div style={{ ...S.hint, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setText(ex)
              reset()
            }}
            style={{
              border: `1px solid ${C.line}`,
              background: '#fff',
              borderRadius: 20,
              padding: '2px 8px',
              fontSize: 11,
              color: C.navy,
              cursor: 'pointer',
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {state.phase === 'loading' && <div style={{ ...S.hint, marginTop: 10 }}>Reading your rule with AI…</div>}

      {state.phase === 'done' && state.kind === 'ready' && (
        <ConfirmCard
          parsed={state}
          rules={rules}
          cartItems={cartItems}
          onConfirm={() => {
            onConfirm(state.rule, state.text)
            setText('')
            reset()
          }}
          onDiscard={reset}
        />
      )}

      {state.phase === 'done' && state.kind === 'clarify' && (
        <Card tone="amber" title="Need a bit more detail — nothing was added">
          <p style={{ margin: '0 0 6px' }}>{state.message}</p>
          {state.missing.length > 0 && (
            <div style={S.hint}>Missing: {state.missing.map((m) => m.replace(/_/g, ' ')).join(', ')}</div>
          )}
          <div style={{ ...S.hint, marginTop: 6 }}>Edit your text above and parse it again.</div>
        </Card>
      )}

      {state.phase === 'done' && state.kind === 'unsupported' && (
        <Card tone="amber" title="This engine can't express that rule — nothing was added">
          <p style={{ margin: 0 }}>{state.message}</p>
        </Card>
      )}

      {state.phase === 'done' && state.kind === 'invalid' && (
        <Card tone="red" title="The parsed rule failed validation — nothing was added">
          <p style={{ margin: '0 0 6px' }}>{state.message}</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {state.errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </Card>
      )}

      {state.phase === 'done' && state.kind === 'error' && (
        <Card tone="red" title="Couldn't parse the rule">
          <p style={{ margin: '0 0 8px' }}>{state.message}</p>
          <button type="button" style={S.btnGhost} onClick={parse}>
            Try again
          </button>
        </Card>
      )}
    </div>
  )
}

function Card({ tone, title, children }) {
  const tones = {
    amber: [C.amberBg, C.amberLine, C.amber],
    red: [C.redBg, '#e57373', C.red],
    navy: ['#f6f7fc', '#c9cde6', C.navy],
  }
  const [bg, border, color] = tones[tone]
  return (
    <div style={{ marginTop: 10, background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: '0.8rem 1rem', fontSize: 12, color }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 4, padding: '4px 8px' }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{value}</div>
    </div>
  )
}

function ConfirmCard({ parsed, rules, cartItems, onConfirm, onDiscard }) {
  const { rule, readback, assumptions, warnings, text } = parsed
  const scope = rule.scope.charAt(0).toUpperCase() + rule.scope.slice(1)

  // Dry run: what would change in the current cart if this rule were added?
  let impact = null
  if (cartItems.length > 0) {
    const before = calculateCart(cartItems, rules)
    const after = calculateCart(cartItems, [...rules, rule])
    impact = {
      changed: after.items
        .map((item, i) => ({ item, before: before.items[i] }))
        .filter(({ item, before }) => item.finalPrice !== before.finalPrice),
      totalBefore: before.total,
      totalAfter: after.total,
      cartOfferChanged: (before.cartOffer?.label ?? '') !== (after.cartOffer?.label ?? ''),
      cartOfferAfter: after.cartOffer,
    }
  }

  return (
    <Card tone="navy" title={`Check this rule before adding it (${rule.ruleId})`}>
      <div style={{ ...S.hint, marginBottom: 8 }}>You wrote: “{text}”</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
        <Field label="Scope" value={scope} />
        <Field label="Applies to" value={rule.scope === 'cart' ? 'Entire cart' : rule.appliesTo} />
        <Field label="Type" value={rule.type === 'percentage' ? 'Percentage' : 'Flat'} />
        <Field label="Value" value={offerText(rule).replace(' off', '')} />
        <Field label="Stackable" value={rule.stackable ? 'Yes' : 'No'} />
        <Field label="Min cart value" value={rule.scope === 'cart' ? (rule.minCartValue > 0 ? formatRs(rule.minCartValue) : 'None') : '—'} />
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 12 }}>
        <strong>The engine will apply:</strong> {readback}
      </p>

      {assumptions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 700 }}>How your words were read</div>
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ marginTop: 8, background: C.amberBg, border: `1px solid ${C.amberLine}`, borderRadius: 4, padding: '6px 8px', color: C.amber }}>
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 700 }}>Effect on the current cart</div>
        {!impact && <div style={S.hint}>Load a cart to preview the effect.</div>}
        {impact && impact.changed.length === 0 && !impact.cartOfferChanged && (
          <div style={S.hint}>No price in the current cart changes: no item matches, or an existing offer already saves more.</div>
        )}
        {impact && (impact.changed.length > 0 || impact.cartOfferChanged) && (
          <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
            {impact.changed.map(({ item, before }) => (
              <li key={item.itemId}>
                {item.itemId} {item.product}: {formatRs(before.finalPrice)} → <strong>{formatRs(item.finalPrice)}</strong>
              </li>
            ))}
            {impact.cartOfferChanged && <li>{impact.cartOfferAfter ? impact.cartOfferAfter.label : 'Cart offer no longer applies'}</li>}
            <li>
              Final cart total: {formatRs(impact.totalBefore)} → <strong>{formatRs(impact.totalAfter)}</strong>
            </li>
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" style={S.btn} onClick={onConfirm}>
          Add rule
        </button>
        <button type="button" style={S.btnGhost} onClick={onDiscard}>
          Discard
        </button>
      </div>
    </Card>
  )
}
