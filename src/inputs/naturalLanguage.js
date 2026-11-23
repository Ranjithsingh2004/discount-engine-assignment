/**
 * naturalLanguage.js — natural-language rule input adapter (browser side)
 *
 * Flow:  text ──► POST /api/parse-rule (LLM, structured output)
 *             ──► interpretRuleParse(): validate with normalizeRule(), add warnings
 *             ──► confirmation card in the UI ──► user confirms ──► rule list
 *
 * The LLM output is treated as untrusted input: it must pass the same
 * validation as a CSV row, and the user sees the result before it is used.
 */

import { normalizeRule, nextRuleId } from '../engine/models.js'
import { describeRule, formatRs } from '../engine/copy.js'

export class RuleParseError extends Error {
  constructor(message, code) {
    super(message)
    this.code = code
  }
}

/** Calls the server-side parser. Resolves to the raw LLM result; throws RuleParseError on transport problems. */
export async function requestRuleParse(text, { brands = [], platforms = [] } = {}, { fetchImpl = fetch, signal } = {}) {
  let response
  try {
    response = await fetchImpl('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, brands, platforms }),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new RuleParseError('Could not reach the rule parser. Check your connection and try again.', 'network')
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // fall through: a non-JSON body (e.g. a platform error page) is handled below
  }

  if (!response.ok) {
    throw new RuleParseError(body?.message || `The rule parser failed (HTTP ${response.status}).`, body?.error || 'http')
  }
  if (!body || typeof body.result !== 'object' || body.result === null) {
    throw new RuleParseError('The rule parser returned an empty response. Try again.', 'empty')
  }
  return body.result
}

/** All numbers written in the text, with "5k" read as 5000 and "1,299" as 1299. */
export function numbersInText(text) {
  const found = []
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh)?\b/gi)) {
    let n = parseFloat(m[1].replace(/,/g, ''))
    const unit = (m[2] || '').toLowerCase()
    if (unit === 'k' || unit === 'thousand') n *= 1000
    if (unit === 'lakh') n *= 100000
    if (Number.isFinite(n)) found.push(n)
  }
  return found
}

/**
 * Turns the raw LLM result into one of:
 *   { kind: 'ready',       rule, readback, assumptions, warnings }
 *   { kind: 'clarify',     message, missing }
 *   { kind: 'unsupported', message }
 *   { kind: 'invalid',     message, errors }
 *
 * @param result      raw object from requestRuleParse()
 * @param context     { text, rules, cartItems } — current state, used for warnings
 */
export function interpretRuleParse(result, { text = '', rules = [], cartItems = [] } = {}) {
  const status = result?.status

  if (status === 'needs_clarification') {
    const missing = Array.isArray(result.missing) ? result.missing : []
    return {
      kind: 'clarify',
      missing,
      message:
        nonEmpty(result.message) ||
        `That rule is missing ${missing.length ? missing.join(', ').replace(/_/g, ' ') : 'some details'}. Try something like "10% off if the cart total is above Rs.5,000".`,
    }
  }

  if (status === 'unsupported') {
    return {
      kind: 'unsupported',
      message: nonEmpty(result.message) || 'This engine supports brand, platform and cart-total discounts only.',
    }
  }

  if (status !== 'ok' || !result.rule || typeof result.rule !== 'object') {
    return invalid(['the AI did not return a rule'])
  }

  const raw = result.rule
  const { rule, errors } = normalizeRule({
    ruleId: nextRuleId(rules),
    scope: raw.scope,
    appliesTo: raw.applies_to,
    type: raw.type,
    value: raw.value,
    stackable: raw.stackable,
    minCartValue: raw.min_cart_value, // a threshold on a non-cart rule is rejected, never silently dropped
  })
  if (!rule) return invalid(errors)

  return {
    kind: 'ready',
    rule,
    readback: describeRule(rule),
    assumptions: Array.isArray(result.assumptions) ? result.assumptions.filter(nonEmpty) : [],
    warnings: ruleWarnings(rule, { text, rules, cartItems }),
  }
}

/** Checks that don't make a rule invalid but that the user should see before confirming. */
export function ruleWarnings(rule, { text = '', rules = [], cartItems = [] }) {
  const warnings = []
  const numbers = numbersInText(text)

  // Hallucination guard: every number in the rule should come from the user's text.
  if (rule.type === 'flat' || !/half/i.test(text)) {
    if (!numbers.includes(rule.value)) {
      const shown = rule.type === 'percentage' ? `${rule.value}%` : formatRs(rule.value)
      warnings.push(`The value ${shown} is not written in your text. Check it before adding the rule.`)
    }
  }
  if (rule.scope === 'cart' && rule.minCartValue > 0 && !numbers.includes(rule.minCartValue)) {
    warnings.push(`The minimum cart value ${formatRs(rule.minCartValue)} is not written in your text. Check it before adding the rule.`)
  }

  if (rule.scope !== 'cart' && cartItems.length > 0) {
    const field = rule.scope === 'brand' ? 'brand' : 'platform'
    const target = rule.appliesTo.trim().toLowerCase()
    if (!cartItems.some((item) => item[field].trim().toLowerCase() === target)) {
      warnings.push(`No item in the current cart has ${field} "${rule.appliesTo}". The rule will be added but won't change any price until such items are in the cart.`)
    }
  }

  const duplicate = rules.find(
    (r) =>
      r.scope === rule.scope &&
      (r.appliesTo ?? '').toLowerCase() === (rule.appliesTo ?? '').toLowerCase() &&
      r.type === rule.type &&
      r.value === rule.value &&
      r.stackable === rule.stackable &&
      (r.minCartValue ?? null) === (rule.minCartValue ?? null)
  )
  if (duplicate) warnings.push(`This is the same as ${duplicate.ruleId}, which is already active.`)

  return warnings
}

const nonEmpty = (s) => (typeof s === 'string' && s.trim() ? s.trim() : '')

function invalid(errors) {
  return {
    kind: 'invalid',
    errors,
    message: 'The AI returned a rule that the engine cannot use, so nothing was added. Try rephrasing.',
  }
}
