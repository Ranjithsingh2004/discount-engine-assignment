/**
 * csv.js — CSV input adapter
 *
 * Turns raw CSV text into DiscountRule / CartItem objects. Column mapping only;
 * all validation lives in engine/models.js so every input path follows the
 * same rules.
 *
 * rules.csv columns: rule_id, scope, applies_to, type, value, stackable, min_cart_value
 *   (applies_to is empty for cart rules; min_cart_value is empty for brand/platform rules,
 *    and the column may be left out entirely for files without cart rules)
 *
 * cart.csv columns: item_id, product, brand, platform, base_price
 *
 * Both parsers return { data, errors }: valid rows in data, one message per skipped row in errors.
 */

import Papa from 'papaparse'
import { normalizeRule, normalizeCartItem } from '../engine/models.js'

function readCsv(csvText, requiredColumns) {
  const { data: rows, errors: parseErrors, meta } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (parseErrors.length > 0) {
    return { rows: [], errors: parseErrors.map((e) => (e.row !== undefined ? `Row ${e.row + 2}: ${e.message}` : e.message)) }
  }

  const missingColumns = requiredColumns.filter((c) => !meta.fields?.includes(c))
  if (missingColumns.length > 0) {
    return { rows: [], errors: [`Missing column(s): ${missingColumns.join(', ')}`] }
  }

  return { rows, errors: [] }
}

/**
 * Parses the raw text of rules.csv into an array of DiscountRule objects.
 */
export function parseRulesCSV(csvText) {
  const { rows, errors } = readCsv(csvText, ['rule_id', 'scope', 'type', 'value', 'stackable'])
  const data = []
  const seenIds = new Set()

  rows.forEach((row, i) => {
    const rowNum = i + 2 // account for header row
    const { rule, errors: rowErrors } = normalizeRule({
      ruleId: row.rule_id,
      scope: row.scope,
      appliesTo: row.applies_to,
      type: row.type,
      value: row.value,
      stackable: row.stackable,
      minCartValue: row.min_cart_value,
    })

    if (!rule) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`)
      return
    }
    if (seenIds.has(rule.ruleId.toUpperCase())) {
      errors.push(`Row ${rowNum}: duplicate rule id ${rule.ruleId} — row skipped`)
      return
    }
    seenIds.add(rule.ruleId.toUpperCase())
    data.push(rule)
  })

  return { data, errors }
}

/**
 * Parses the raw text of cart.csv into an array of CartItem objects.
 */
export function parseCartCSV(csvText) {
  const { rows, errors } = readCsv(csvText, ['item_id', 'product', 'brand', 'platform', 'base_price'])
  const data = []

  rows.forEach((row, i) => {
    const rowNum = i + 2
    const { item, errors: rowErrors } = normalizeCartItem({
      itemId: row.item_id,
      product: row.product,
      brand: row.brand,
      platform: row.platform,
      basePrice: row.base_price,
    })

    if (!item) {
      errors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`)
      return
    }
    data.push(item)
  })

  return { data, errors }
}
