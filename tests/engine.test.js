import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv.js'
import { calculateCart, applyDiscounts, applyCartOffers } from '../src/engine/discountEngine.js'

const rulesCsv = readFileSync(new URL('../sample-data/rules.csv', import.meta.url), 'utf8')
const cartCsv = readFileSync(new URL('../sample-data/cart.csv', import.meta.url), 'utf8')

const sampleRules = () => parseRulesCSV(rulesCsv).data
const sampleCart = () => parseCartCSV(cartCsv).data

const item = (overrides = {}) => ({
  itemId: 'ITEM-X',
  product: 'Thing',
  brand: 'Brand A',
  platform: 'Shop A',
  basePrice: 1000,
  ...overrides,
})
const rule = (overrides) => ({
  ruleId: 'R',
  scope: 'platform',
  appliesTo: 'Shop A',
  type: 'percentage',
  value: 10,
  stackable: false,
  minCartValue: null,
  ...overrides,
})

describe('sample data — expected results from the brief', () => {
  it('parses both sample files without errors', () => {
    expect(parseRulesCSV(rulesCsv).errors).toEqual([])
    expect(parseCartCSV(cartCsv).errors).toEqual([])
    expect(sampleRules()).toHaveLength(4)
  })

  it('matches the expected results table exactly', () => {
    const result = calculateCart(sampleCart(), sampleRules())
    const rows = result.items.map((r) => [r.itemId, r.finalPrice, r.appliedRules, r.statusLabel])
    expect(rows).toEqual([
      ['ITEM-01', 1104, ['RULE-01'], 'Max discount'],
      ['ITEM-02', 629, ['RULE-02', 'RULE-03'], 'Stacked'],
      ['ITEM-03', 509, ['RULE-01'], 'Discount applied'],
      ['ITEM-04', 2499, [], 'No offer'],
      ['ITEM-05', 382, ['RULE-01'], 'Discount applied'],
      ['ITEM-06', 809, ['RULE-03'], 'Discount applied'],
    ])
    expect(result.subtotal).toBe(5932)
    expect(result.cartOffer.discount).toBe(593)
    expect(result.cartOffer.label).toBe('Cart offer: 10% off — Rs.593 saved')
    expect(result.total).toBe(5339)
  })

  it('explains each price in customer language', () => {
    const [i1, i2, , i4] = calculateCart(sampleCart(), sampleRules()).items
    expect(i1.reasoning).toBe('Amazon India offer: 15% off — better than Natura Casa offer: Rs.150 off')
    expect(i1.skippedRules).toEqual(['RULE-02'])
    expect(i2.reasoning).toBe('Natura Casa offer: Rs.150 off + Flipkart offer: 10% off (stacked)')
    expect(i4.reasoning).toBe('No offers available — no current offers on LivSpace Pro or Noon')
  })
})

describe('item-level selection', () => {
  it('picks the largest rupee saving regardless of scope', () => {
    const r = applyDiscounts(item({ basePrice: 900 }), [
      rule({ ruleId: 'PCT', value: 15 }), // Rs.135
      rule({ ruleId: 'FLAT', scope: 'brand', appliesTo: 'Brand A', type: 'flat', value: 150 }),
    ])
    expect(r.appliedRules).toEqual(['FLAT'])
    expect(r.finalPrice).toBe(750)
  })

  it('breaks ties in favour of the rule listed first', () => {
    const r = applyDiscounts(item(), [
      rule({ ruleId: 'FIRST', type: 'flat', value: 100 }),
      rule({ ruleId: 'SECOND', value: 10 }),
    ])
    expect(r.appliedRules).toEqual(['FIRST'])
  })

  it('applies a stackable rule on its own when no non-stackable rule matches', () => {
    const r = applyDiscounts(item(), [rule({ stackable: true })])
    expect(r.finalPrice).toBe(900)
    expect(r.status).toBe('applied')
  })

  it('never takes a price below zero with a large flat discount', () => {
    const r = applyDiscounts(item({ basePrice: 80 }), [rule({ type: 'flat', value: 100 })])
    expect(r.finalPrice).toBe(0)
    expect(r.totalDiscount).toBe(80)
  })

  it('applies percentage stackables before flat stackables (larger saving)', () => {
    const r = applyDiscounts(item(), [
      rule({ ruleId: 'FLAT', type: 'flat', value: 100, stackable: true }),
      rule({ ruleId: 'PCT', value: 10, stackable: true }),
    ])
    // 1000 -10% = 900, -100 = 800 (the other order would give 810)
    expect(r.appliedRules).toEqual(['PCT', 'FLAT'])
    expect(r.finalPrice).toBe(800)
  })

  it('matches brand and platform names case- and space-insensitively', () => {
    const r = applyDiscounts(item(), [rule({ appliesTo: '  shop a ' })])
    expect(r.finalPrice).toBe(900)
  })

  it('ignores cart rules at item level', () => {
    const r = applyDiscounts(item(), [rule({ scope: 'cart', appliesTo: null, minCartValue: 0 })])
    expect(r.status).toBe('none')
  })
})

describe('cart-level offers', () => {
  const cartRule = (overrides) => rule({ ruleId: 'CART', scope: 'cart', appliesTo: null, minCartValue: 4000, ...overrides })

  it('applies when the cart total equals the threshold exactly', () => {
    const { cartOffer, total } = applyCartOffers(4000, [cartRule()])
    expect(cartOffer.discount).toBe(400)
    expect(total).toBe(3600)
  })

  it('does not apply one rupee below the threshold, and says how much more is needed', () => {
    const { cartOffer, nextCartOffer, total } = applyCartOffers(3999, [cartRule()])
    expect(cartOffer).toBeNull()
    expect(total).toBe(3999)
    expect(nextCartOffer).toMatchObject({ ruleId: 'CART', shortfall: 1 })
  })

  it('checks the threshold against prices after item discounts, not base prices', () => {
    // Base prices sum to 4,100 but the item offer brings the cart to 3,690.
    const cart = [item({ basePrice: 4100 })]
    const result = calculateCart(cart, [rule({ value: 10 }), cartRule()])
    expect(result.subtotal).toBe(3690)
    expect(result.cartOffer).toBeNull()
    expect(result.nextCartOffer.shortfall).toBe(310)
  })

  it('picks the best of several qualifying cart rules', () => {
    const { cartOffer } = applyCartOffers(6000, [
      cartRule({ ruleId: 'C10', value: 10 }),
      cartRule({ ruleId: 'C500', type: 'flat', value: 500, minCartValue: 5000 }),
    ])
    expect(cartOffer.appliedRules).toEqual(['C10'])
    expect(cartOffer.passedOver.map((p) => p.ruleId)).toEqual(['C500'])
  })

  it('only nudges toward a threshold that would beat the current saving', () => {
    const rules = [cartRule({ ruleId: 'C10', value: 10 }), cartRule({ ruleId: 'C5', value: 5, minCartValue: 8000 })]
    expect(applyCartOffers(5000, rules).nextCartOffer).toBeNull()
    const better = [cartRule({ ruleId: 'C10', value: 10 }), cartRule({ ruleId: 'C20', value: 20, minCartValue: 8000 })]
    expect(applyCartOffers(5000, better).nextCartOffer).toMatchObject({ ruleId: 'C20', shortfall: 3000 })
  })

  it('documents the trade-off of evaluating item offers before cart offers (see README)', () => {
    // One Rs.4,100 item; a Rs.150 brand offer and a Rs.100 platform offer compete; 10% cart offer at Rs.4,000.
    const cart = [item({ basePrice: 4100 })]
    const rules = [
      rule({ ruleId: 'BRAND150', scope: 'brand', appliesTo: 'Brand A', type: 'flat', value: 150 }),
      rule({ ruleId: 'PLAT100', type: 'flat', value: 100 }),
      cartRule(),
    ]
    // As specified: the bigger item saving wins (Rs.150), the cart drops to 3,950 and misses the cart offer.
    expect(calculateCart(cart, rules).total).toBe(3950)
    // Taking the smaller item offer would keep the cart at 4,000 and unlock 10%: the customer would pay 3,600.
    expect(calculateCart(cart, rules.filter((r) => r.ruleId !== 'BRAND150')).total).toBe(3600)
  })

  it('reports total savings across item and cart offers', () => {
    const result = calculateCart(sampleCart(), sampleRules())
    expect(result.itemSavings).toBe(662)
    expect(result.cartSavings).toBe(593)
    expect(result.totalSavings).toBe(1255)
  })
})
