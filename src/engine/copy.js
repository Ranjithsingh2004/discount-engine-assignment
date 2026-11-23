/**
 * copy.js
 *
 * Customer-facing wording. Kept in one place so every screen (results table,
 * cart offer row, rule confirmation) describes an offer the same way.
 */

export function formatRs(amount) {
  const rounded = Math.round(amount * 100) / 100
  return `Rs.${rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/** "15% off" / "Rs.150 off" */
export function offerText(rule) {
  return rule.type === 'percentage' ? `${rule.value}% off` : `${formatRs(rule.value)} off`
}

/** Who is giving the offer, in words a shopper understands. */
export function offerSource(rule) {
  if (rule.scope === 'cart') return 'Cart offer'
  return `${rule.appliesTo} offer`
}

/** "Amazon India offer: 15% off" / "Cart offer: 10% off" */
export function offerLabel(rule) {
  return `${offerSource(rule)}: ${offerText(rule)}`
}

/** One-line plain-English readback of a rule, generated from the parsed fields (not by the LLM). */
export function describeRule(rule) {
  const amount = offerText(rule)
  let what
  if (rule.scope === 'brand') what = `${amount} every ${rule.appliesTo} item`
  else if (rule.scope === 'platform') what = `${amount} every item bought on ${rule.appliesTo}`
  else if (rule.minCartValue > 0) {
    what = `${amount} the whole cart once the cart total (after item offers) is at least ${formatRs(rule.minCartValue)}`
  } else what = `${amount} the whole cart, with no minimum`

  const how = rule.stackable
    ? 'Stacks on top of the best non-stackable offer.'
    : 'Competes with other non-stackable offers; the customer gets whichever saves more.'
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}. ${how}`
}

export const STATUS_LABELS = {
  max_discount: 'Max discount',
  stacked: 'Stacked',
  applied: 'Discount applied',
  none: 'No offer',
}
