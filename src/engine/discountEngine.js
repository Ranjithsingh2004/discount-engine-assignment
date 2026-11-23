/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects, no knowledge of
 * where rules or cart items came from (see models.js for the input contract).
 *
 * Data shapes: DiscountRule and CartItem are defined in models.js.
 *
 * DiscountResult {
 *   itemId, product, brand, platform: string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]       rule ids, in the order they were applied
 *   skippedRules:  string[]       matching non-stackable rules that lost to the winner
 *   steps:         Step[]         { ruleId, label, amount, priceAfter }
 *   passedOver:    Offer[]        { ruleId, label, amount } (what the losers would have saved)
 *   status:        "max_discount" | "stacked" | "applied" | "none"
 *   statusLabel:   string
 *   reasoning:     string         customer-readable explanation
 * }
 *
 * CartResult {
 *   items:         DiscountResult[]
 *   subtotal:      number         sum of final item prices (cart total before cart offer)
 *   cartOffer:     CartOffer | null
 *   nextCartOffer: { ruleId, label, minCartValue, shortfall } | null
 *   total:         number         final amount the customer pays
 *   itemSavings, cartSavings, totalSavings: number
 * }
 */

import { offerLabel, formatRs, STATUS_LABELS } from './copy.js'

const normalise = (s) => String(s ?? '').trim().toLowerCase()

/**
 * Returns true if an item-level rule applies to this cart item.
 * Cart-scope rules never match an individual item.
 */
export function ruleMatchesItem(item, rule) {
  if (rule.scope === 'brand') return normalise(item.brand) === normalise(rule.appliesTo)
  if (rule.scope === 'platform') return normalise(item.platform) === normalise(rule.appliesTo)
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * A flat discount is capped at the price, so nothing is ever sold below Rs.0.
 */
export function calculateDiscountAmount(price, rule) {
  if (price <= 0) return 0
  if (rule.type === 'percentage') return Math.min(price, Math.round((price * rule.value) / 100))
  if (rule.type === 'flat') return Math.min(price, rule.value)
  return 0
}

/**
 * Core selection logic, shared by item-level and cart-level offers:
 *   1. Among non-stackable rules, the one with the largest rupee saving on the
 *      starting price wins. Ties go to the rule listed first.
 *   2. Stackable rules apply on top of the winner (or on their own if there is
 *      no winner). Percentage stackables go before flat ones: for a given set of
 *      offers that order always leaves the customer with the lower price.
 */
function selectAndApply(startPrice, rules) {
  const ranked = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => !rule.stackable)
    .map((entry) => ({ ...entry, amount: calculateDiscountAmount(startPrice, entry.rule) }))
    .sort((a, b) => b.amount - a.amount || a.index - b.index)

  const stackable = rules
    .filter((rule) => rule.stackable)
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'percentage' ? -1 : 1))

  const winner = ranked[0]?.rule ?? null
  const passedOver = ranked.slice(1).map(({ rule, amount }) => ({
    ruleId: rule.ruleId,
    label: offerLabel(rule),
    amount,
  }))

  let price = startPrice
  const steps = []
  for (const rule of winner ? [winner, ...stackable] : stackable) {
    const amount = calculateDiscountAmount(price, rule)
    price -= amount
    steps.push({ ruleId: rule.ruleId, label: offerLabel(rule), amount, priceAfter: price })
  }

  return { finalPrice: price, steps, passedOver }
}

function itemStatus(steps, passedOver) {
  if (steps.length === 0) return 'none'
  if (steps.length > 1) return 'stacked'
  if (passedOver.length > 0) return 'max_discount'
  return 'applied'
}

function itemReasoning(item, steps, passedOver) {
  if (steps.length === 0) {
    return `No offers available — no current offers on ${item.brand} or ${item.platform}`
  }
  let text = steps.map((s) => s.label).join(' + ')
  if (steps.length > 1) text += ' (stacked)'
  if (passedOver.length > 0) {
    text += ` — better than ${passedOver.map((p) => p.label).join(', ')}`
  }
  return text
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))
  const { finalPrice, steps, passedOver } = selectAndApply(item.basePrice, matchingRules)
  const status = itemStatus(steps, passedOver)

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules: steps.map((s) => s.ruleId),
    skippedRules: passedOver.map((p) => p.ruleId),
    steps,
    passedOver,
    status,
    statusLabel: STATUS_LABELS[status],
    reasoning: itemReasoning(item, steps, passedOver),
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Applies cart-scope rules to the cart total (the sum of final item prices).
 * A rule qualifies when subtotal >= minCartValue. Qualifying rules go through
 * the same max-saving / stacking logic as item rules.
 *
 * Also returns the nearest threshold not yet reached, but only if reaching it
 * would actually save the customer more than they save today.
 */
export function applyCartOffers(subtotal, cartRules) {
  const threshold = (r) => r.minCartValue ?? 0
  const qualifying = cartRules.filter((r) => subtotal >= threshold(r))
  const { finalPrice, steps, passedOver } = selectAndApply(subtotal, qualifying)
  const discount = subtotal - finalPrice

  const cartOffer =
    steps.length === 0
      ? null
      : {
          appliedRules: steps.map((s) => s.ruleId),
          steps,
          passedOver,
          discount,
          label: `${steps.map((s) => s.label).join(' + ')} — ${formatRs(discount)} saved`,
          condition: qualifying
            .filter((r) => steps.some((s) => s.ruleId === r.ruleId))
            .map((r) =>
              threshold(r) > 0
                ? `Cart total ${formatRs(subtotal)} ≥ ${formatRs(threshold(r))}`
                : 'No minimum cart value'
            )
            .join('; '),
        }

  const nextCartOffer =
    cartRules
      .filter((r) => subtotal < threshold(r))
      .sort((a, b) => threshold(a) - threshold(b))
      .filter((r) => calculateDiscountAmount(threshold(r), r) > discount)
      .map((r) => ({
        ruleId: r.ruleId,
        label: offerLabel(r),
        minCartValue: threshold(r),
        shortfall: threshold(r) - subtotal,
      }))[0] ?? null

  return { cartOffer, nextCartOffer, total: finalPrice }
}

/**
 * Full checkout calculation: item-level offers first, then cart-level offers
 * on the resulting total. Returns a CartResult.
 */
export function calculateCart(cartItems, rules) {
  const itemRules = rules.filter((r) => r.scope !== 'cart')
  const cartRules = rules.filter((r) => r.scope === 'cart')

  const items = processCart(cartItems, itemRules)
  const subtotal = cartTotal(items)
  const { cartOffer, nextCartOffer, total } = applyCartOffers(subtotal, cartRules)

  const itemSavings = items.reduce((sum, r) => sum + r.totalDiscount, 0)
  const cartSavings = cartOffer ? cartOffer.discount : 0

  return {
    items,
    subtotal,
    cartOffer,
    nextCartOffer,
    total,
    itemSavings,
    cartSavings,
    totalSavings: itemSavings + cartSavings,
  }
}
