/**
 * App.jsx
 *
 * Top-level component. Holds the session state (rules, cart, import reports)
 * and wires input adapters → engine → display:
 *
 *   rules:  rules.csv (inputs/csv.js)  |  plain English (inputs/naturalLanguage.js)
 *   cart:   cart.csv or cart.pdf (inputs/cartSources.js)
 *   engine: calculateCart() — results are derived from state, never stored,
 *           so they can't go stale when a rule is added or the cart replaced.
 */

import { useMemo, useState } from 'react'
import FileUploader from './components/FileUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import NaturalLanguageRule from './components/NaturalLanguageRule.jsx'
import CheckoutSummary from './components/CheckoutSummary.jsx'
import { C, S } from './components/theme.js'
import { parseRulesCSV, parseCartCSV } from './inputs/csv.js'
import { importCartFile, CART_ACCEPT } from './inputs/cartSources.js'
import { calculateCart } from './engine/discountEngine.js'
import { nextRuleId } from './engine/models.js'
import { formatRs, offerText } from './engine/copy.js'

import sampleRulesCsv from '../sample-data/rules.csv?raw'
import sampleCartCsv from '../sample-data/cart.csv?raw'
import cartPdfUrl from '../sample-data/cart.pdf?url'
import belowThresholdPdfUrl from '../sample-data/cart-below-threshold.pdf?url'
import badRowsPdfUrl from '../sample-data/cart-with-bad-rows.pdf?url'
import plainTextPdfUrl from '../sample-data/cart-plain-text.pdf?url'

const SAMPLE_PDFS = [
  { url: cartPdfUrl, name: 'cart.pdf', note: 'same cart as the CSV' },
  { url: belowThresholdPdfUrl, name: 'cart-below-threshold.pdf', note: 'no Ceramic Vase → under Rs.4,000' },
  { url: badRowsPdfUrl, name: 'cart-with-bad-rows.pdf', note: '3 malformed rows' },
  { url: plainTextPdfUrl, name: 'cart-plain-text.pdf', note: 'monospace printout' },
]

const capitalise = (v) => v.charAt(0).toUpperCase() + v.slice(1)

const CART_COLUMNS = [
  { key: 'itemId', label: 'Item', nowrap: true },
  { key: 'product', label: 'Product' },
  { key: 'brand', label: 'Brand' },
  { key: 'platform', label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => formatRs(v), nowrap: true },
]

export default function App() {
  const [rules, setRules] = useState([])
  const [rulesReport, setRulesReport] = useState(null) // { fileName, errors, replaced }

  const [cartItems, setCartItems] = useState([])
  const [cartReport, setCartReport] = useState(null) // { fileName, sourceLabel, title, errors, notes, replaced }
  const [cartBusy, setCartBusy] = useState(false)

  const [calculated, setCalculated] = useState(false)

  const result = useMemo(
    () => (calculated && cartItems.length > 0 ? calculateCart(cartItems, rules) : null),
    [calculated, cartItems, rules]
  )

  // ── Rules ──

  function loadRules(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    // An import that yields nothing usable never wipes out the current rules.
    if (data.length > 0) setRules(data.map((r) => ({ ...r, origin: 'csv' })))
    setRulesReport({ fileName, errors, replaced: data.length > 0 })
  }

  function addParsedRule(rule, sourceText) {
    setRules((current) => [...current, { ...rule, ruleId: nextRuleId(current), origin: 'ai', sourceText }])
    if (cartItems.length > 0) setCalculated(true)
  }

  function removeRule(ruleId) {
    setRules((current) => current.filter((r) => r.ruleId !== ruleId))
  }

  // ── Cart ──

  function applyCartImport(result, fileName) {
    const replaced = result.data.length > 0
    if (replaced) {
      setCartItems(result.data)
      // A new cart from a PDF (or any file) re-runs the engine straight away.
      if (result.source?.id !== 'csv' || calculated) setCalculated(true)
    }
    setCartReport({
      fileName,
      sourceLabel: result.source?.label ?? '',
      title: result.title ?? '',
      errors: result.errors ?? [],
      notes: result.notes ?? [],
      replaced,
      count: result.data.length,
    })
  }

  async function handleCartFile(file) {
    setCartBusy(true)
    try {
      applyCartImport(await importCartFile(file), file.name)
    } finally {
      setCartBusy(false)
    }
  }

  function loadSampleData() {
    loadRules(sampleRulesCsv, 'rules.csv (sample)')
    applyCartImport({ ...parseCartCSV(sampleCartCsv), source: { id: 'csv', label: 'CSV' } }, 'cart.csv (sample)')
    setCalculated(true)
  }

  // ── Render ──

  const rulesColumns = [
    { key: 'ruleId', label: 'Rule', nowrap: true },
    {
      key: 'appliesTo',
      label: 'Applies To',
      render: (v, row) => (
        <>
          <div>{v ?? 'Entire cart'}</div>
          <div style={{ fontSize: 10, color: C.muted }}>{capitalise(row.scope)}</div>
        </>
      ),
    },
    {
      key: 'value',
      label: 'Offer',
      render: (v, row) => (
        <>
          <div style={{ whiteSpace: 'nowrap' }}>{offerText(row)}</div>
          {row.scope === 'cart' && row.minCartValue > 0 && (
            <div style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>if cart ≥ {formatRs(row.minCartValue)}</div>
          )}
        </>
      ),
    },
    { key: 'stackable', label: 'Stacks', render: (v) => (v ? 'Yes' : 'No') },
    {
      key: 'origin',
      label: 'Source',
      nowrap: true,
      render: (v, row) => (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span
            title={row.sourceText ? `Parsed from: “${row.sourceText}”` : 'From rules.csv'}
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 20,
              background: v === 'ai' ? C.blueBg : '#ececf0',
              color: v === 'ai' ? C.blue : '#5f5f68',
            }}
          >
            {v === 'ai' ? 'AI' : 'CSV'}
          </span>
          <button type="button" style={S.link} onClick={() => removeRule(row.ruleId)} aria-label={`Remove ${row.ruleId}`}>
            Remove
          </button>
        </span>
      ),
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: 'Arial, sans-serif' }}>
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
            O<span style={{ color: C.orange }}>pp</span>tra
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Discount Engine
          </div>
        </div>
        <button type="button" onClick={loadSampleData} className="header-btn">
          Load sample data
        </button>
      </header>

      <main className="app-main">
        <div className="grid-2">
          {/* Rules */}
          <section style={S.section} aria-labelledby="rules-title">
            <div style={S.sectionTitle} id="rules-title">
              Discount Rules
            </div>
            <FileUploader
              label="rules.csv"
              description="Upload a rules CSV (replaces the current rules)"
              accept=".csv"
              onFile={async (file) => loadRules(await file.text(), file.name)}
              hasData={rules.length > 0}
              fileName={rulesReport?.fileName}
            />
            {rulesReport && (
              <ErrorBanner
                errors={rulesReport.errors}
                variant={rulesReport.replaced ? 'warning' : 'error'}
                title={
                  rulesReport.replaced
                    ? `${rulesReport.errors.length} row${rulesReport.errors.length > 1 ? 's' : ''} skipped`
                    : 'No valid rules in this file — current rules kept'
                }
              />
            )}

            <NaturalLanguageRule rules={rules} cartItems={cartItems} onConfirm={addParsedRule} />

            {rules.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ ...S.hint, marginBottom: 4 }}>
                  {rules.length} active rule{rules.length > 1 ? 's' : ''}
                </div>
                <DataTable columns={rulesColumns} rows={rules} />
              </div>
            )}
          </section>

          {/* Cart */}
          <section style={S.section} aria-labelledby="cart-title">
            <div style={S.sectionTitle} id="cart-title">
              Cart Items
            </div>
            <FileUploader
              label="cart.csv or cart.pdf"
              description="Upload a cart as CSV or PDF (replaces the current cart)"
              accept={CART_ACCEPT}
              onFile={handleCartFile}
              hasData={cartItems.length > 0}
              fileName={cartReport?.replaced ? cartReport.fileName : undefined}
              busy={cartBusy}
            />
            <div style={{ ...S.hint, marginTop: 6 }}>
              Sample PDFs:{' '}
              {SAMPLE_PDFS.map((pdf, i) => (
                <span key={pdf.name}>
                  {i > 0 && ' · '}
                  <a href={pdf.url} download={pdf.name} style={{ color: C.orange }} title={pdf.note}>
                    {pdf.name}
                  </a>
                </span>
              ))}
            </div>

            {cartReport && (
              <>
                {cartReport.replaced && (
                  <div style={{ ...S.hint, marginTop: 8, color: C.green }}>
                    Loaded {cartReport.count} item{cartReport.count > 1 ? 's' : ''} from {cartReport.sourceLabel}
                    {cartReport.title ? ` — ${cartReport.title}` : ''}
                  </div>
                )}
                <ErrorBanner
                  errors={cartReport.errors}
                  variant={cartReport.replaced ? 'warning' : 'error'}
                  title={
                    cartReport.replaced
                      ? `${cartReport.errors.length} row${cartReport.errors.length > 1 ? 's' : ''} skipped — check the cart below before relying on the total`
                      : 'Cart not replaced'
                  }
                />
                {cartReport.notes.length > 0 && <div style={{ ...S.hint, marginTop: 6 }}>{cartReport.notes.join(' · ')}</div>}
              </>
            )}

            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ ...S.hint, marginBottom: 4 }}>
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} in cart
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </section>
        </div>

        {!calculated && (
          <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
            <button
              type="button"
              style={{ ...S.btn, padding: '0.65rem 2rem', fontSize: 13, ...(cartItems.length === 0 ? { background: C.line, cursor: 'not-allowed' } : {}) }}
              onClick={() => setCalculated(true)}
              disabled={cartItems.length === 0}
            >
              Calculate Discounts
            </button>
            <div style={{ ...S.hint, marginTop: 6 }}>
              {cartItems.length === 0 ? 'Upload a cart (and rules) to calculate, or load the sample data' : 'Ready to calculate'}
            </div>
          </div>
        )}

        {result && <CheckoutSummary result={result} />}
      </main>
    </div>
  )
}
