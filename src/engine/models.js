/**
 * models.js
 *
 * The contract between the outside world and the discount engine.
 *
 * Every input path (CSV upload, PDF upload, natural-language rule, anything
 * added later) produces loosely-typed "raw" objects and passes them through
 * normalizeRule / normalizeCartItem. Only what comes out of these two functions
 * is allowed to reach discountEngine.js. That is what lets a new input mode be
 * added without touching the calculator.
 *
 * DiscountRule {
 *   ruleId:       string                       e.g. "RULE-01"
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string | null                brand / platform name; null for cart rules
 *   type:         "percentage" | "flat"
 *   value:        number                       15 = 15%; flat values are rupees
 *   stackable:    boolean
 *   minCartValue: number | null                cart rules only (0 = no threshold)
 * }
 *
 * CartItem {
 *   itemId:    string
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number                          whole rupees
 * }
 */

export const SCOPES = ['brand', 'platform', 'cart']
export const RULE_TYPES = ['percentage', 'flat']

const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''

/**
 * Parses a rupee amount written by a human or a document:
 *   1299, "1299", "1,299", "Rs.1,299", "Rs 1,299.00", "₹1,299", "INR 1299"
 * Returns NaN for anything else. Deliberately stricter than parseFloat,
 * which would silently read "12abc" as 12.
 */
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value !== 'string') return NaN
  const cleaned = value
    .trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, '')
    .replace(/[,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN
  return parseFloat(cleaned)
}

/** "true"/"yes"/"1"/true → true, "false"/"no"/"0"/false → false, anything else → null. */
export function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (isBlank(value)) return null
  const s = String(value).trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'no', 'n', '0'].includes(s)) return false
  return null
}

/**
 * Validates and normalises one rule.
 * Returns { rule, errors }. rule is null whenever errors is non-empty.
 */
export function normalizeRule(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') {
    return { rule: null, errors: ['rule is empty'] }
  }

  const ruleId = isBlank(raw.ruleId) ? '' : String(raw.ruleId).trim()
  if (!ruleId) errors.push('missing rule id')

  const scope = isBlank(raw.scope) ? '' : String(raw.scope).trim().toLowerCase()
  if (!SCOPES.includes(scope)) {
    errors.push(`scope must be one of ${SCOPES.join(', ')} (got "${raw.scope ?? ''}")`)
  }

  const type = isBlank(raw.type) ? '' : String(raw.type).trim().toLowerCase()
  if (!RULE_TYPES.includes(type)) {
    errors.push(`type must be "percentage" or "flat" (got "${raw.type ?? ''}")`)
  }

  const value = parseMoney(typeof raw.value === 'string' ? raw.value.replace(/%$/, '') : raw.value)
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`value must be a positive number (got "${raw.value ?? ''}")`)
  } else if (type === 'percentage' && value > 100) {
    errors.push(`a percentage discount cannot exceed 100% (got ${value}%)`)
  }

  const stackable = parseBoolean(raw.stackable)
  if (stackable === null) {
    errors.push(`stackable must be true or false (got "${raw.stackable ?? ''}")`)
  }

  let appliesTo = null
  let minCartValue = null

  if (scope === 'brand' || scope === 'platform') {
    if (isBlank(raw.appliesTo)) {
      errors.push(`a ${scope} rule needs the ${scope} name it applies to`)
    } else {
      appliesTo = String(raw.appliesTo).trim()
    }
    // An item rule with a cart condition is something the engine cannot express.
    // Rejecting it beats silently dropping the condition and over-discounting.
    if (!isBlank(raw.minCartValue)) {
      errors.push('a minimum cart value only works on cart-scope rules')
    }
  }

  if (scope === 'cart') {
    if (isBlank(raw.minCartValue)) {
      minCartValue = 0
    } else {
      minCartValue = parseMoney(raw.minCartValue)
      if (!Number.isFinite(minCartValue) || minCartValue < 0) {
        errors.push(`min cart value must be zero or a positive amount (got "${raw.minCartValue}")`)
      }
    }
  }

  if (errors.length > 0) return { rule: null, errors }

  return {
    rule: { ruleId, scope, appliesTo, type, value, stackable, minCartValue },
    errors: [],
  }
}

/**
 * Validates and normalises one cart item.
 * Returns { item, errors }. item is null whenever errors is non-empty.
 */
export function normalizeCartItem(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object') {
    return { item: null, errors: ['item is empty'] }
  }

  const missing = ['itemId', 'product', 'brand', 'platform'].filter((k) => isBlank(raw[k]))
  if (isBlank(raw.basePrice)) missing.push('base price')
  if (missing.length > 0) errors.push(`missing ${missing.join(', ')}`)

  let basePrice = NaN
  if (!isBlank(raw.basePrice)) {
    basePrice = parseMoney(raw.basePrice)
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      errors.push(`base price must be a positive amount (got "${raw.basePrice}")`)
    }
  }

  if (errors.length > 0) return { item: null, errors }

  return {
    item: {
      itemId: String(raw.itemId).trim(),
      product: String(raw.product).trim(),
      brand: String(raw.brand).trim(),
      platform: String(raw.platform).trim(),
      basePrice: Math.round(basePrice),
    },
    errors: [],
  }
}

/** Next free id in the RULE-NN sequence, e.g. RULE-05 after RULE-01..RULE-04. */
export function nextRuleId(rules) {
  const used = new Set(rules.map((r) => r.ruleId.toUpperCase()))
  let n = rules.reduce((max, r) => {
    const m = /^RULE-(\d+)$/i.exec(r.ruleId)
    return m ? Math.max(max, parseInt(m[1], 10)) : max
  }, 0)
  let id
  do {
    n += 1
    id = `RULE-${String(n).padStart(2, '0')}`
  } while (used.has(id))
  return id
}

/** ITEM-01, ITEM-02 ... for sources (like PDFs) that carry no item ids. */
export function itemIdFor(index) {
  return `ITEM-${String(index + 1).padStart(2, '0')}`
}
