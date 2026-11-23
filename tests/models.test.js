import { describe, it, expect } from 'vitest'
import { normalizeRule, normalizeCartItem, parseMoney, nextRuleId } from '../src/engine/models.js'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv.js'

describe('parseMoney', () => {
  it.each([
    [1299, 1299],
    ['1299', 1299],
    ['1,299', 1299],
    ['Rs.1,299', 1299],
    ['Rs 1,299.00', 1299],
    ['₹1,299', 1299],
    ['INR 2499', 2499],
  ])('reads %s as %s', (input, expected) => expect(parseMoney(input)).toBe(expected))

  it.each(['', 'abc', '12abc', 'Rs.', '-50', '1.2.3'])('rejects %s', (input) => {
    expect(parseMoney(input)).toBeNaN()
  })
})

describe('normalizeRule', () => {
  const base = { ruleId: 'R1', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150, stackable: false }

  it('accepts a valid rule and lower-cases enums', () => {
    const { rule, errors } = normalizeRule({ ...base, scope: 'Brand', type: 'FLAT', stackable: 'yes' })
    expect(errors).toEqual([])
    expect(rule).toEqual({ ...base, stackable: true, minCartValue: null })
  })

  it('rejects percentages above 100', () => {
    expect(normalizeRule({ ...base, type: 'percentage', value: 150 }).errors[0]).toMatch(/cannot exceed 100%/)
  })

  it('rejects an unreadable stackable flag instead of defaulting to false', () => {
    expect(normalizeRule({ ...base, stackable: 'maybe' }).errors[0]).toMatch(/stackable must be true or false/)
  })

  it('requires a name for brand/platform rules', () => {
    expect(normalizeRule({ ...base, appliesTo: ' ' }).errors[0]).toMatch(/needs the brand name/)
  })

  it('refuses a cart condition on an item rule rather than dropping it', () => {
    expect(normalizeRule({ ...base, minCartValue: 2000 }).errors[0]).toMatch(/only works on cart-scope/)
  })

  it('accepts a cart rule without applies_to and defaults the threshold to 0', () => {
    const { rule } = normalizeRule({ ruleId: 'C', scope: 'cart', type: 'percentage', value: 5, stackable: false })
    expect(rule).toMatchObject({ scope: 'cart', appliesTo: null, minCartValue: 0 })
  })

  it('reports every problem at once', () => {
    const { rule, errors } = normalizeRule({ scope: 'category', type: 'bogo', value: -1, stackable: '' })
    expect(rule).toBeNull()
    expect(errors).toHaveLength(5)
  })
})

describe('normalizeCartItem', () => {
  it('rounds prices to whole rupees and trims fields', () => {
    const { item } = normalizeCartItem({ itemId: ' I1 ', product: 'Vase ', brand: 'B', platform: 'P', basePrice: 'Rs.1,299.40' })
    expect(item).toEqual({ itemId: 'I1', product: 'Vase', brand: 'B', platform: 'P', basePrice: 1299 })
  })

  it('names every missing field', () => {
    expect(normalizeCartItem({ itemId: 'I1', product: 'Vase' }).errors[0]).toBe('missing brand, platform, base price')
  })
})

describe('CSV adapter', () => {
  it('reports bad rows by row number and keeps the good ones', () => {
    const csv = [
      'rule_id,scope,applies_to,type,value,stackable,min_cart_value',
      'R1,platform,Amazon India,percentage,15,false,',
      'R2,category,Kitchen,percentage,15,false,',
      'R1,brand,Natura Casa,flat,150,false,',
    ].join('\n')
    const { data, errors } = parseRulesCSV(csv)
    expect(data.map((r) => r.ruleId)).toEqual(['R1'])
    expect(errors).toEqual([
      'Row 3: scope must be one of brand, platform, cart (got "category")',
      'Row 4: duplicate rule id R1 — row skipped',
    ])
  })

  it('still reads the original rules.csv format (no min_cart_value column)', () => {
    const csv = 'rule_id,scope,applies_to,type,value,stackable\nR1,platform,Flipkart,percentage,10,true'
    expect(parseRulesCSV(csv).data).toHaveLength(1)
  })

  it('flags a missing column up front', () => {
    expect(parseCartCSV('item_id,product,brand,base_price\nI1,Vase,B,100').errors).toEqual(['Missing column(s): platform'])
  })
})

describe('nextRuleId', () => {
  it('continues the RULE-NN sequence', () => {
    expect(nextRuleId([{ ruleId: 'RULE-01' }, { ruleId: 'RULE-04' }])).toBe('RULE-05')
    expect(nextRuleId([])).toBe('RULE-01')
    expect(nextRuleId([{ ruleId: 'PROMO-X' }])).toBe('RULE-01')
  })
})
