/**
 * Vercel serverless function: POST /api/parse-rule
 * Body: { text: string, brands?: string[], platforms?: string[] }
 *
 * Thin HTTP wrapper; the logic lives in server/parseRule.js so the Vite dev
 * server can run exactly the same code locally.
 */

import { handleParseRule } from '../server/parseRule.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' })
  }

  let payload = req.body
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return res.status(400).json({ error: 'bad_json', message: 'Request body must be JSON.' })
    }
  }

  const { status, body } = await handleParseRule(payload, process.env)
  return res.status(status).json(body)
}
