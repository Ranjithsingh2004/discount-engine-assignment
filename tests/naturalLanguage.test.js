import { describe, it, expect, vi } from 'vitest'
import { interpretRuleParse, requestRuleParse, numbersInText, RuleParseError } from '../src/inputs/naturalLanguage.js'
import { handleParseRule, buildUserMessage } from '../server/parseRule.js'
import { calculateCart } from '../src/engine/discountEngine.js'

const cartItems = [
  { itemId: 'ITEM-01', product: 'Cushion Cover', brand: 'Natura Casa', platform: 'Amazon India', basePrice: 1299 },
  { itemId: 'ITEM-02', product: 'Bed Sheet Set', brand: 'Natura Casa', platform: 'Flipkart', basePrice: 849 },
  { itemId: 'ITEM-06', product: 'Desk Organiser', brand: 'Nordic Basics', platform: 'Flipkart', basePrice: 899 },
]
const rules = [
  { ruleId: 'RULE-01', scope: 'platform', appliesTo: 'Amazon India', type: 'percentage', value: 15, stackable: false, minCartValue: null },
  { ruleId: 'RULE-02', scope: 'brand', appliesTo: 'Natura Casa', type: 'flat', value: 150, stackable: false, minCartValue: null },
  { ruleId: 'RULE-03', scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 10, stackable: true, minCartValue: null },
  { ruleId: 'RULE-04', scope: 'cart', appliesTo: null, type: 'percentage', value: 10, stackable: false, minCartValue: 4000 },
]

const ok = (rule, assumptions = []) => ({ status: 'ok', rule, missing: [], assumptions, message: '' })

// The four examples from the brief, as a well-behaved model would return them.
describe('interpretRuleParse — brief examples', () => {
  it('"20% off for Natura Casa brand, stackable with other offers"', () => {
    const text = '20% off for Natura Casa brand, stackable with other offers'
    const out = interpretRuleParse(
      ok({ scope: 'brand', applies_to: 'Natura Casa', type: 'percentage', value: 20, stackable: true, min_cart_value: null }),
      { text, rules, cartItems }
    )
    expect(out.kind).toBe('ready')
    expect(out.rule).toEqual({ ruleId: 'RULE-05', scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null })
    expect(out.warnings).toEqual([])
  })

  it('"Rs.100 flat discount on all Flipkart items"', () => {
    const out = interpretRuleParse(
      ok({ scope: 'platform', applies_to: 'Flipkart', type: 'flat', value: 100, stackable: false, min_cart_value: null }, ['Stackable not mentioned, so set to No']),
      { text: 'Rs.100 flat discount on all Flipkart items', rules, cartItems }
    )
    expect(out.kind).toBe('ready')
    expect(out.rule).toMatchObject({ scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false })
    expect(out.assumptions).toEqual(['Stackable not mentioned, so set to No'])
  })

  it('"10% off if cart value is more than Rs.5,000"', () => {
    const out = interpretRuleParse(
      ok({ scope: 'cart', applies_to: null, type: 'percentage', value: 10, stackable: false, min_cart_value: 5000 }),
      { text: '10% off if cart value is more than Rs.5,000', rules, cartItems }
    )
    expect(out.kind).toBe('ready')
    expect(out.rule).toMatchObject({ scope: 'cart', appliesTo: null, minCartValue: 5000 })
    expect(out.readback).toMatch(/at least Rs\.5,000/)
  })

  it('"Give a discount for big orders" surfaces a question instead of a rule', () => {
    const out = interpretRuleParse(
      { status: 'needs_clarification', rule: null, missing: ['value', 'min_cart_value'], assumptions: [], message: 'How much off, and from what cart total? e.g. "10% off orders above Rs.5,000"' },
      { text: 'Give a discount for big orders', rules, cartItems }
    )
    expect(out).toEqual({ kind: 'clarify', missing: ['value', 'min_cart_value'], message: expect.stringMatching(/How much off/) })
  })
})

describe('interpretRuleParse — defending against bad LLM output', () => {
  it('rejects a percentage above 100 with a readable reason', () => {
    const out = interpretRuleParse(ok({ scope: 'brand', applies_to: 'Natura Casa', type: 'percentage', value: 150, stackable: false, min_cart_value: null }))
    expect(out.kind).toBe('invalid')
    expect(out.errors[0]).toMatch(/cannot exceed 100%/)
  })

  it('rejects a brand rule with no brand name', () => {
    const out = interpretRuleParse(ok({ scope: 'brand', applies_to: null, type: 'flat', value: 50, stackable: false, min_cart_value: null }))
    expect(out.kind).toBe('invalid')
  })

  it('rejects status "ok" without a rule, and unknown statuses', () => {
    expect(interpretRuleParse({ status: 'ok', rule: null }).kind).toBe('invalid')
    expect(interpretRuleParse({ status: 'maybe' }).kind).toBe('invalid')
    expect(interpretRuleParse(null).kind).toBe('invalid')
  })

  it('rejects a cart threshold attached to a platform rule instead of silently dropping it', () => {
    const out = interpretRuleParse(ok({ scope: 'platform', applies_to: 'Flipkart', type: 'flat', value: 100, stackable: false, min_cart_value: 2000 }))
    expect(out.kind).toBe('invalid')
    expect(out.errors[0]).toMatch(/only works on cart-scope/)
  })

  it('warns when a number in the rule is not in the text (possible hallucination)', () => {
    const out = interpretRuleParse(
      ok({ scope: 'cart', applies_to: null, type: 'percentage', value: 10, stackable: false, min_cart_value: 5000 }),
      { text: 'Give a discount for big orders', rules, cartItems }
    )
    expect(out.kind).toBe('ready')
    expect(out.warnings).toHaveLength(2)
  })

  it('warns when no cart item matches the brand or platform', () => {
    const out = interpretRuleParse(
      ok({ scope: 'platform', applies_to: 'Myntra', type: 'percentage', value: 5, stackable: false, min_cart_value: null }),
      { text: '5% off Myntra', rules, cartItems }
    )
    expect(out.warnings[0]).toMatch(/No item in the current cart has platform "Myntra"/)
  })

  it('warns about a duplicate of an active rule', () => {
    const out = interpretRuleParse(
      ok({ scope: 'platform', applies_to: 'amazon india', type: 'percentage', value: 15, stackable: false, min_cart_value: null }),
      { text: '15% off Amazon India', rules, cartItems }
    )
    expect(out.warnings).toContain('This is the same as RULE-01, which is already active.')
  })
})

describe('re-running the engine with a confirmed rule', () => {
  it('stacks a new 20% Natura Casa rule and keeps reasoning accurate', () => {
    const newRule = { ruleId: 'RULE-05', scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true, minCartValue: null }
    const [i1, i2] = calculateCart(cartItems, [...rules, newRule]).items
    // ITEM-01: 1299 -15% (195) = 1104, then -20% (221) = 883
    expect(i1.finalPrice).toBe(883)
    expect(i1.reasoning).toBe('Amazon India offer: 15% off + Natura Casa offer: 20% off (stacked) — better than Natura Casa offer: Rs.150 off')
    // ITEM-02: 849 -150 = 699, then stackables percentage-first: -10% (70) = 629, -20% (126) = 503
    expect(i2.finalPrice).toBe(503)
    expect(i2.appliedRules).toEqual(['RULE-02', 'RULE-03', 'RULE-05'])
  })
})

describe('numbersInText', () => {
  it('reads rupee amounts, percentages and k-suffixes', () => {
    expect(numbersInText('10% off if cart value is more than Rs.5,000')).toEqual([10, 5000])
    expect(numbersInText('Rs.100 off over 5k')).toEqual([100, 5000])
  })
})

describe('requestRuleParse', () => {
  const respond = (status, body) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body })

  it('returns the result on success', async () => {
    const fetchImpl = respond(200, { result: { status: 'ok' } })
    await expect(requestRuleParse('x', {}, { fetchImpl })).resolves.toEqual({ status: 'ok' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ text: 'x', brands: [], platforms: [] })
  })

  it('surfaces the server message on an error status', async () => {
    const fetchImpl = respond(503, { error: 'llm_not_configured', message: 'not configured' })
    await expect(requestRuleParse('x', {}, { fetchImpl })).rejects.toMatchObject({ code: 'llm_not_configured', message: 'not configured' })
  })

  it('handles a network failure and a non-JSON body', async () => {
    await expect(requestRuleParse('x', {}, { fetchImpl: vi.fn().mockRejectedValue(new TypeError('fail')) })).rejects.toBeInstanceOf(RuleParseError)
    const html = vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => { throw new SyntaxError() } })
    await expect(requestRuleParse('x', {}, { fetchImpl: html })).rejects.toThrow(/HTTP 504/)
  })
})

describe('handleParseRule (server)', () => {
  const fakeClient = (response) => ({ beta: { messages: { parse: vi.fn().mockResolvedValue(response) } } })

  it('validates input length before calling the model', async () => {
    expect((await handleParseRule({ text: ' ' }, {})).status).toBe(400)
    expect((await handleParseRule({ text: 'x'.repeat(301) }, {})).status).toBe(400)
  })

  it('reports a missing API key clearly', async () => {
    const out = await handleParseRule({ text: '10% off Flipkart' }, {})
    expect(out).toMatchObject({ status: 503, body: { error: 'llm_not_configured' } })
  })

  it('returns the parsed output and sends known names to the model', async () => {
    const parsed = ok({ scope: 'platform', applies_to: 'Flipkart', type: 'percentage', value: 10, stackable: false, min_cart_value: null })
    const client = fakeClient({ stop_reason: 'end_turn', parsed_output: parsed, model: 'claude-opus-5-5' })
    const out = await handleParseRule({ text: '10% off flipkart', brands: ['Natura Casa'], platforms: ['Flipkart', 'Flipkart'] }, {}, { client })
    expect(out).toEqual({ status: 200, body: { result: parsed, model: 'claude-opus-5-5' } })
    const request = client.beta.messages.parse.mock.calls[0][0]
    expect(request.model).toBe('claude-opus-5-5')
    expect(request.messages[0].content).toBe(buildUserMessage('10% off flipkart', ['Natura Casa'], ['Flipkart']))
  })

  it('maps a refusal and an unparseable response to errors, not crashes', async () => {
    expect((await handleParseRule({ text: 'abc' }, {}, { client: fakeClient({ stop_reason: 'refusal', parsed_output: null }) })).status).toBe(422)
    expect((await handleParseRule({ text: 'abc' }, {}, { client: fakeClient({ stop_reason: 'end_turn', parsed_output: null }) })).status).toBe(502)
    const throwing = { beta: { messages: { parse: vi.fn().mockRejectedValue(new SyntaxError('bad json')) } } }
    expect((await handleParseRule({ text: 'abc' }, {}, { client: throwing })).body.error).toBe('llm_bad_output')
  })
})
