import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serves POST /api/parse-rule from `npm run dev` and `npm run preview`, using
 * the same handler as the Vercel function, so local development needs no
 * extra tooling: put ANTHROPIC_API_KEY in .env and run the usual commands.
 */
function localApi(env) {
  const mount = (middlewares) => {
    middlewares.use('/api/parse-rule', async (req, res) => {
      const send = (status, body) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(body))
      }
      if (req.method !== 'POST') return send(405, { error: 'method_not_allowed', message: 'Use POST.' })

      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      let payload
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        return send(400, { error: 'bad_json', message: 'Request body must be JSON.' })
      }

      const { handleParseRule } = await import('./server/parseRule.js')
      const { status, body } = await handleParseRule(payload, env)
      send(status, body)
    })
  }
  return {
    name: 'local-api',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  }
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [react(), localApi(env)],
    build: {
      // keep the sample PDFs as real downloadable files rather than inlined data: URLs
      assetsInlineLimit: (filePath) => (filePath.endsWith('.pdf') ? false : undefined),
    },
    test: {
      include: ['tests/**/*.test.js'],
    },
  }
})
