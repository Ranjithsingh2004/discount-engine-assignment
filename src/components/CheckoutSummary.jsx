/**
 * CheckoutSummary.jsx — what the customer sees at checkout.
 * Each item's final price and the offer behind it, then the cart offer row
 * (only when triggered) and the final cart total.
 */

import DataTable from './DataTable.jsx'
import StatusBadge from './StatusBadge.jsx'
import { formatRs } from '../engine/copy.js'
import { C, S } from './theme.js'

/** "Rs.849 − Rs.150 − Rs.70 = Rs.629" */
function priceMath(row) {
  if (row.steps.length === 0) return null
  return `${formatRs(row.basePrice)} ${row.steps.map((s) => `− ${formatRs(s.amount)}`).join(' ')} = ${formatRs(row.finalPrice)}`
}

const COLUMNS = [
  { key: 'itemId', label: 'Item', nowrap: true },
  { key: 'product', label: 'Product' },
  { key: 'basePrice', label: 'Base Price', render: (v) => formatRs(v), nowrap: true },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v, row) => (
      <div style={{ minWidth: 200 }}>
        <div style={{ color: row.status === 'none' ? C.muted : C.navy, fontStyle: row.status === 'none' ? 'italic' : 'normal' }}>{v}</div>
        {priceMath(row) && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{priceMath(row)}</div>}
      </div>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) => (v > 0 ? <span style={{ color: C.green, fontWeight: 600 }}>{formatRs(v)}</span> : <span style={{ color: C.muted }}>—</span>),
  },
  {
    key: 'finalPrice',
    label: 'Final Price',
    nowrap: true,
    render: (v, row) => <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? C.green : C.navy }}>{formatRs(v)}</span>,
  },
  { key: 'statusLabel', label: 'Status', render: (v, row) => <StatusBadge status={row.status} label={v} /> },
]

const row = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: '0.25rem 1rem',
  alignItems: 'center',
  padding: '0.55rem 0.2rem',
  borderBottom: '1px solid #ececf0',
  fontSize: 13,
  color: C.navy,
}

export default function CheckoutSummary({ result }) {
  const { items, subtotal, cartOffer, nextCartOffer, total, totalSavings, itemSavings, cartSavings } = result

  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>Cart Summary</div>
      <div style={{ ...S.hint, marginBottom: 8 }}>Prices update automatically when the rules or the cart change.</div>
      <DataTable columns={COLUMNS} rows={items} />

      <div style={{ maxWidth: 520, marginLeft: 'auto', marginTop: '0.9rem' }} aria-label="Cart totals">
        {cartOffer && (
          <>
            <div style={row}>
              <span>Cart total before offer</span>
              <span style={{ fontWeight: 700 }}>{formatRs(subtotal)}</span>
            </div>
            <div style={{ ...row, background: '#fffbea' }} data-testid="cart-offer-row">
              <span>
                <strong>{cartOffer.label}</strong>{' '}
                <StatusBadge status="cart" label="Cart offer" />
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  {cartOffer.appliedRules.join(' + ')} · {cartOffer.condition}
                  {cartOffer.passedOver.length > 0 && ` · better than ${cartOffer.passedOver.map((p) => p.label).join(', ')}`}
                </div>
              </span>
              <span style={{ fontWeight: 700, color: C.green }}>−{formatRs(cartOffer.discount)}</span>
            </div>
          </>
        )}
        <div style={{ ...row, borderBottom: 'none', borderTop: `2px solid ${C.navy}`, background: '#eef7f0', marginTop: cartOffer ? 0 : 4 }}>
          <span style={{ fontWeight: 700 }}>Final Cart Total</span>
          <span style={{ fontWeight: 700, fontSize: 18 }} data-testid="final-total">
            {formatRs(total)}
          </span>
        </div>

        {totalSavings > 0 && (
          <div style={{ textAlign: 'right', fontSize: 12, color: C.green, marginTop: 6 }}>
            You save <strong>{formatRs(totalSavings)}</strong> on this order
            {cartSavings > 0 && itemSavings > 0 && ` (${formatRs(itemSavings)} on items + ${formatRs(cartSavings)} cart offer)`}
          </div>
        )}

        {nextCartOffer && (
          <div
            data-testid="cart-nudge"
            style={{ marginTop: 8, background: C.blueBg, color: C.blue, borderRadius: 4, padding: '6px 10px', fontSize: 12, textAlign: 'right' }}
          >
            Add <strong>{formatRs(nextCartOffer.shortfall)}</strong> more to unlock {nextCartOffer.label} (cart total of{' '}
            {formatRs(nextCartOffer.minCartValue)} or more)
          </div>
        )}
      </div>
    </div>
  )
}
