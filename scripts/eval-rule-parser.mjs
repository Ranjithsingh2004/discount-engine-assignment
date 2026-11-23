/**
 * Live check of the natural-language rule parser against Claude.
 * Sends each phrasing through the real server handler and the browser-side
 * validator, then compares the outcome with what we expect.
 *
 *   npm run eval:rules        (reads ANTHROPIC_API_KEY from .env or the environment)
 *
 * Costs a few cents per run.
 */

import { readFileSync, existsSync } from 'node:fs'
import { handleParseRule } from '../server/parseRule.js'
import { interpretRuleParse } from '../src/inputs/naturalLanguage.js'

const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const context = {
  brands: ['Natura Casa', 'LivSpace Pro', 'Nordic Basics'],
  platforms: ['Amazon India', 'Flipkart', 'Noon'],
}

// expect: 'clarify' | 'unsupported' | partial rule fields for a 'ready' outcome
const CASES = [
  ['20% off for Natura Casa brand, stackable with other offers', { scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true }],
  ['Rs.100 flat discount on all Flipkart items', { scope: 'platform', appliesTo: 'Flipkart', type: 'flat', value: 100, stackable: false }],
  ['10% off if cart value is more than Rs.5,000', { scope: 'cart', type: 'percentage', value: 10, minCartValue: 5000 }],
  ['Give a discount for big orders', 'clarify'],
  ['Rs.200 off Nordic Basics, can be combined with other offers', { scope: 'brand', appliesTo: 'Nordic Basics', type: 'flat', value: 200, stackable: true }],
  ['flipkart 5 percent', { scope: 'platform', appliesTo: 'Flipkart', type: 'percentage', value: 5, stackable: false }],
  ['natura kasa 12% off', { scope: 'brand', appliesTo: 'Natura Casa', value: 12 }],
  ['15% off on all orders above 3k', { scope: 'cart', value: 15, minCartValue: 3000 }],
  ['Buy 2 cushion covers, get 1 free', 'unsupported'],
  ['10% off Flipkart every weekend', 'unsupported'],
  ['A discount on Noon', 'clarify'],
]

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY (in .env or the environment) to run the live eval.')
  process.exit(1)
}

let passed = 0
for (const [text, expected] of CASES) {
  const started = Date.now()
  const { status, body } = await handleParseRule({ text, ...context }, process.env)
  const ms = Date.now() - started

  let outcome
  let ok = false
  if (status !== 200) {
    outcome = `HTTP ${status}: ${body.message}`
  } else {
    const out = interpretRuleParse(body.result, { text, rules: [], cartItems: [] })
    outcome = out.kind === 'ready' ? JSON.stringify(out.rule) : `${out.kind}: ${out.message}`
    if (typeof expected === 'string') ok = out.kind === expected
    else ok = out.kind === 'ready' && Object.entries(expected).every(([k, v]) => out.rule[k] === v)
  }
  if (ok) passed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(ms).padStart(5)}ms  "${text}"\n        → ${outcome}`)
}

console.log(`\n${passed}/${CASES.length} passed`)
process.exit(passed === CASES.length ? 0 : 1)
