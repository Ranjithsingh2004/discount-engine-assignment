// Regenerates the sample cart PDFs in sample-data/.  Usage: npm run samples
import { writeFile } from 'node:fs/promises'
import { buildCartPdf, SAMPLE_FILES } from './samplePdfs.js'

for (const [name, options] of Object.entries(SAMPLE_FILES)) {
  const bytes = await buildCartPdf(options)
  await writeFile(new URL(`../sample-data/${name}`, import.meta.url), bytes)
  console.log(`sample-data/${name}  (${bytes.length} bytes)`)
}
